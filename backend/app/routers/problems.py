import io
import json
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin
from app.services.audit import audit_log
from app.services.judge_admin import normalize_tags
from app.services.problem_assets import (
    guess_content_type,
    has_artifact_mode,
    normalize_output_files,
    parse_statement_assets,
    sanitize_statement_assets_for_api,
    zip_directory_bytes,
    zip_path_bytes,
)
from app.services.problems import latest_problem_version
from app.services.problem_versions import (
    activate_problem_version,
    list_problem_versions,
    run_problem_version_self_test,
    set_problem_version_status,
)
from app.settings import settings
from app.storage import S3_BUCKET_PROBLEMS, get_bytes, get_text, put_bytes
from app.uploads import parse_yaml, safe_extract_zip_bytes, safe_slug, validate_problem_archive

router = APIRouter()


def _bounded_int(value, *, field: str, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{field} must be an integer") from exc
    if parsed < minimum or parsed > maximum:
        raise HTTPException(status_code=400, detail=f"{field} must be between {minimum} and {maximum}")
    return parsed


def _parse_jsonish(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return fallback
    return value


def _problem_api_payload(row) -> dict:
    data = dict(row)
    statement_assets = parse_statement_assets(_parse_jsonish(data.get("statement_assets_json"), {}))
    if not statement_assets["markdowns"] and str(data.get("statement_md") or "").strip():
        statement_assets["markdowns"].append(
            {
                "id": "default",
                "language": statement_assets["default_language"],
                "label": "Default",
                "filename": "statement.md",
                "content": str(data.get("statement_md") or ""),
            }
        )
    data["statement_assets"] = sanitize_statement_assets_for_api(statement_assets, data["slug"])
    data["output_files"] = normalize_output_files(_parse_jsonish(data.get("output_files"), ["submission.csv"]))
    data["has_public_resources"] = bool(data.get("public_bundle_object_key"))
    data["sample_submission_filename"] = str(
        data.get("sample_bundle_filename")
        or f"{data['slug']}_sample_submission.csv"
    )
    for key in (
        "test_input_object_key",
        "test_input_bundle_object_key",
        "label_object_key",
        "sample_submission_object_key",
        "scorer_object_key",
        "statement_assets_json",
        "self_test_result",
        "public_bundle_object_key",
        "private_bundle_object_key",
        "sample_bundle_object_key",
    ):
        data.pop(key, None)
    return data


@router.get("/api/problems")
def list_problems(q: str | None = None, metric: str | None = None):
    params = {}
    filters = ["status = 'PUBLIC'", "active_version_id is not null"]
    if q:
        params["q"] = f"%{q.strip()}%"
        filters.append("(title ilike :q or slug ilike :q)")
    if metric:
        params["metric"] = metric.strip()
        filters.append("metric = :metric")
    where_sql = " and ".join(filters)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select id, slug, title, metric, higher_is_better, time_limit_sec,
                       memory_limit_mb, cpu_count, status, created_at
                from problems
                where {where_sql}
                order by created_at desc, id desc
                """
            ),
            params,
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/api/problems/{slug}")
def get_problem(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    return _problem_api_payload(row)


@router.get("/api/problems/{slug}/sample-submission")
def get_problem_sample_submission(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    filename = str(row.get("sample_bundle_filename") or f"{slug}_sample_submission.csv")
    if row.get("sample_bundle_object_key"):
        content = get_bytes(S3_BUCKET_PROBLEMS, row["sample_bundle_object_key"])
        return Response(
            content=content,
            media_type=guess_content_type(filename, "application/zip"),
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    content = get_text(S3_BUCKET_PROBLEMS, row["sample_submission_object_key"])
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/problems/{slug}/resources")
def get_problem_resources(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")
    if not row.get("public_bundle_object_key"):
        raise HTTPException(status_code=404, detail="Problem has no public resource bundle")

    content = get_bytes(S3_BUCKET_PROBLEMS, row["public_bundle_object_key"])
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{slug}_resources.zip"'},
    )


@router.get("/api/problems/{slug}/resource-files/{asset_path:path}")
def get_problem_resource_file(slug: str, asset_path: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")
    if not row.get("public_bundle_object_key"):
        raise HTTPException(status_code=404, detail="Problem has no public resource bundle")

    filename, content = _read_public_bundle_file(
        get_bytes(S3_BUCKET_PROBLEMS, row["public_bundle_object_key"]),
        asset_path,
    )
    return Response(
        content=content,
        media_type=guess_content_type(filename, "application/octet-stream"),
        headers={"Content-Disposition": f'inline; filename="{Path(filename).name}"'},
    )


@router.get("/api/problems/{slug}/statement-pdfs/{asset_id}")
def get_problem_statement_pdf(slug: str, asset_id: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    statement_assets = parse_statement_assets(_parse_jsonish(row.get("statement_assets_json"), {}))
    match = next((item for item in statement_assets["pdfs"] if str(item.get("id") or "") == asset_id), None)
    if not match or not match.get("object_key"):
        raise HTTPException(status_code=404, detail="Statement PDF not found")

    filename = str(match.get("filename") or f"{asset_id}.pdf")
    content = get_bytes(S3_BUCKET_PROBLEMS, match["object_key"])
    return Response(
        content=content,
        media_type=guess_content_type(filename, "application/pdf"),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/problems/{slug}/leaderboard")
def leaderboard(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        problem = conn.execute(
            text("select id, higher_is_better from problems where slug = :slug"),
            {"slug": slug},
        ).mappings().first()
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")

        rows = conn.execute(
            text(
                """
                select row_number() over (
                          order by
                            case when :higher_is_better then le.public_score end desc nulls last,
                            case when not :higher_is_better then le.public_score end asc nulls last,
                            le.updated_at asc
                       ) as rank,
                       le.user_id,
                       le.username,
                       le.best_submission_id,
                       le.public_score,
                       le.private_score,
                       le.updated_at
                from leaderboard_entries le
                where le.problem_id = :problem_id
                order by rank
                limit 100
                """
            ),
            {"problem_id": problem["id"], "higher_is_better": bool(problem["higher_is_better"])},
        ).mappings().all()

    return {"problem_slug": slug, "items": [dict(r) for r in rows]}


@router.get("/api/admin/problems")
def admin_problems(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select p.id, p.slug, p.title, p.status, p.active_version_id,
                       count(pv.id) as versions,
                       count(*) filter (where pv.status = 'DRAFT') as draft_versions,
                       max(pv.created_at) as latest_version_at,
                       max(case when pv.id = p.active_version_id then pv.version else null end) as active_version
                from problems p
                left join problem_versions pv on pv.problem_id = p.id
                group by p.id
                order by p.created_at desc, p.id desc
                """
            )
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.post("/api/admin/problems/{slug}/status")
def admin_problem_status(slug: str, payload: dict, user=Depends(require_admin)):
    slug = safe_slug(slug)
    status = payload.get("status")
    if status not in {"PUBLIC", "DRAFT", "ARCHIVED"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update problems
                set status = :status, updated_at = now()
                where slug = :slug
                returning slug, status
                """
            ),
            {"slug": slug, "status": status},
        ).mappings().first()
        if row:
            audit_log(
                conn,
                user_id=user["id"],
                action="admin.problem.status",
                resource_type="problem",
                resource_id=slug,
                metadata={"status": status},
            )

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")
    return {"ok": True, **dict(row)}


def _statement_label(language: str, labels: dict) -> str:
    value = labels.get(language)
    if isinstance(value, dict):
        return str(value.get("label") or language)
    if value is not None:
        return str(value)
    return language or "Default"


def _collect_statement_assets(root: Path, cfg: dict) -> tuple[str, dict, list[tuple[dict, Path]]]:
    labels = cfg.get("statement_languages") if isinstance(cfg.get("statement_languages"), dict) else {}
    default_language = str(cfg.get("default_statement_language") or cfg.get("statement_language") or "default")
    markdowns: list[dict] = []
    pdfs: list[tuple[dict, Path]] = []

    statement_md = root / "statement.md"
    if statement_md.exists():
        markdowns.append(
            {
                "id": default_language,
                "language": default_language,
                "label": _statement_label(default_language, labels),
                "filename": "statement.md",
                "content": statement_md.read_text(encoding="utf-8", errors="replace"),
            }
        )

    statements_dir = root / "statements"
    if statements_dir.exists():
        for path in sorted(statements_dir.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(statements_dir)
            language = relative.parts[0] if len(relative.parts) > 1 else path.stem
            if path.suffix.lower() == ".md":
                markdowns.append(
                    {
                        "id": language,
                        "language": language,
                        "label": _statement_label(language, labels),
                        "filename": relative.as_posix(),
                        "content": path.read_text(encoding="utf-8", errors="replace"),
                    }
                )
            elif path.suffix.lower() == ".pdf":
                pdfs.append(
                    (
                        {
                            "id": language if len(relative.parts) > 1 else path.stem,
                            "language": language,
                            "label": _statement_label(language, labels),
                            "filename": relative.name,
                        },
                        path,
                    )
                )

    if not markdowns and not pdfs:
        raise HTTPException(status_code=400, detail="Missing statement.md, statements/*.md, or statements/*.pdf")

    default_entry = next((item for item in markdowns if item["language"] == default_language), markdowns[0]) if markdowns else None
    return (default_entry["content"] if default_entry else ""), {"default_language": default_language, "markdowns": markdowns, "pdfs": []}, pdfs


def _resolve_sample_submission_path(public_dir: Path, cfg: dict) -> Path:
    configured = str(cfg.get("sample_submission") or "").strip().replace("\\", "/")
    if configured:
        candidate = (public_dir / configured).resolve()
        try:
            candidate.relative_to(public_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid sample_submission path: {configured}") from exc
        if not candidate.exists():
            raise HTTPException(status_code=400, detail=f"Missing sample submission path: public/{configured}")
        return candidate

    preferred = [
        public_dir / "sample_submission.csv",
        public_dir / "sample_submission.zip",
        public_dir / "sample_submission.npz",
        public_dir / "sample_submission.npy",
        public_dir / "submission.zip",
        public_dir / "sample_submission.jsonl",
    ]
    for candidate in preferred:
        if candidate.exists():
            return candidate

    for candidate in sorted(public_dir.rglob("*")):
        if candidate.is_file() and candidate.name.lower().startswith("sample_submission"):
            return candidate

    raise HTTPException(status_code=400, detail="Missing sample submission in public/")


def _read_public_bundle_file(bundle_bytes: bytes, asset_path: str) -> tuple[str, bytes]:
    normalized = PurePosixPath(str(asset_path or "").replace("\\", "/").strip("/"))
    if not normalized.parts or normalized.is_absolute() or ".." in normalized.parts:
        raise HTTPException(status_code=400, detail="Invalid resource path")

    target = normalized.as_posix()
    with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            candidate = PurePosixPath(str(info.filename).replace("\\", "/").lstrip("./"))
            if candidate.as_posix() == target:
                return target, archive.read(info)

    raise HTTPException(status_code=404, detail="Resource file not found")


@router.post("/api/admin/problems/import")
async def import_problem(file: UploadFile = File(...), user=Depends(require_admin)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload problem.zip")

    data = await file.read()
    validate_problem_archive(data)

    with tempfile.TemporaryDirectory(prefix="aioj_problem_") as td:
        root = Path(td)
        safe_extract_zip_bytes(
            data,
            root,
            max_files=settings.max_problem_files,
            max_uncompressed_bytes=settings.max_problem_uncompressed_bytes,
        )

        problem_yaml = root / "problem.yaml"
        public_dir = root / "public"
        private_dir = root / "private"
        scorer = root / "scorer.py"

        required = [problem_yaml, public_dir, private_dir]
        missing = [str(path.relative_to(root)) for path in required if not path.exists()]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing files: {', '.join(missing)}")

        cfg = parse_yaml(problem_yaml.read_bytes())
        statement_md, statement_assets, statement_pdfs = _collect_statement_assets(root, cfg)
        sample_submission_path = _resolve_sample_submission_path(public_dir, cfg)
        private_test = private_dir / "test.csv"
        private_labels = private_dir / "labels.csv"
        private_input_dir = private_dir / "input"
        private_scoring_dir = private_dir / "scoring"
        legacy_csv_mode = private_test.exists() and private_labels.exists()
        slug = safe_slug(str(cfg.get("slug") or ""))
        title = str(cfg.get("title") or slug)
        metric = str(cfg.get("metric") or "accuracy")
        higher_is_better = bool(cfg.get("higher_is_better", True))
        time_limit_sec = _bounded_int(
            cfg.get("time_limit_sec", 60), field="time_limit_sec", default=60, minimum=1, maximum=3600
        )
        memory_limit_mb = _bounded_int(
            cfg.get("memory_limit_mb", 2048), field="memory_limit_mb", default=2048, minimum=128, maximum=65536
        )
        cpu_count = _bounded_int(cfg.get("cpu_count", 2), field="cpu_count", default=2, minimum=1, maximum=32)
        output_limit_mb = _bounded_int(
            cfg.get("output_limit_mb", 64), field="output_limit_mb", default=64, minimum=1, maximum=1024
        )
        runner_image = str(cfg.get("runner_image") or "aioj-python-basic:latest")
        run_command = cfg.get("run_command") or [
            "python",
            "/workspace/predict.py",
            "--input",
            "/input/test.csv",
            "--output",
            "/output/submission.csv",
        ]
        if not isinstance(run_command, list) or not all(isinstance(item, str) for item in run_command):
            raise HTTPException(status_code=400, detail="run_command must be a list of strings")
        try:
            required_tags = normalize_tags(cfg.get("required_tags", cfg.get("runner_tags")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            output_files = normalize_output_files(cfg.get("output_files"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        status = str(cfg.get("status") or "PUBLIC").upper()
        if status not in {"PUBLIC", "DRAFT", "ARCHIVED"}:
            status = "DRAFT"
        requested_version_status = str(cfg.get("version_status") or "DRAFT").upper()
        if requested_version_status not in {"DRAFT", "ACTIVE", "ARCHIVED"}:
            requested_version_status = "DRAFT"
        activate_after_import = bool(cfg.get("activate_on_import", False)) or requested_version_status == "ACTIVE"
        initial_version_status = "ARCHIVED" if requested_version_status == "ARCHIVED" else "DRAFT"

        public_files = [path for path in public_dir.rglob("*") if path.is_file()]
        private_files = [path for path in private_dir.rglob("*") if path.is_file()]
        public_has_extra = any(path != sample_submission_path for path in public_files)
        private_has_extra = any(path not in {private_test, private_labels} for path in private_files)
        sample_needs_bundle = sample_submission_path.is_dir() or output_files != ["submission.csv"] or sample_submission_path.suffix.lower() != ".csv"
        artifact_mode = (
            output_files != ["submission.csv"]
            or public_has_extra
            or private_has_extra
            or sample_needs_bundle
            or not legacy_csv_mode
        )
        if artifact_mode and not scorer.exists():
            raise HTTPException(status_code=400, detail="Artifact-style problem packages must include scorer.py")
        if artifact_mode and not private_input_dir.is_dir():
            raise HTTPException(status_code=400, detail="Artifact-style problem packages must include private/input/")
        if artifact_mode and not private_scoring_dir.is_dir():
            raise HTTPException(status_code=400, detail="Artifact-style problem packages must include private/scoring/")

        with engine.begin() as conn:
            existing = conn.execute(text("select id from problems where slug = :slug"), {"slug": slug}).mappings().first()
            if existing:
                problem_id = existing["id"]
                conn.execute(
                    text(
                        """
                        update problems
                        set title = :title,
                            statement_md = :statement_md,
                            metric = :metric,
                            higher_is_better = :higher_is_better,
                            time_limit_sec = :time_limit_sec,
                            memory_limit_mb = :memory_limit_mb,
                            cpu_count = :cpu_count,
                            output_limit_mb = :output_limit_mb,
                            status = :status,
                            updated_at = now()
                        where id = :id
                        """
                    ),
                    {
                        "id": problem_id,
                        "title": title,
                        "statement_md": statement_md,
                        "metric": metric,
                        "higher_is_better": higher_is_better,
                        "time_limit_sec": time_limit_sec,
                        "memory_limit_mb": memory_limit_mb,
                        "cpu_count": cpu_count,
                        "output_limit_mb": output_limit_mb,
                        "status": status,
                    },
                )
            else:
                row = conn.execute(
                    text(
                        """
                        insert into problems(
                            slug, title, statement_md, metric, higher_is_better,
                            time_limit_sec, memory_limit_mb, cpu_count, output_limit_mb, status
                        )
                        values (
                            :slug, :title, :statement_md, :metric, :higher_is_better,
                            :time_limit_sec, :memory_limit_mb, :cpu_count, :output_limit_mb, :status
                        )
                        returning id
                        """
                    ),
                    {
                        "slug": slug,
                        "title": title,
                        "statement_md": statement_md,
                        "metric": metric,
                        "higher_is_better": higher_is_better,
                        "time_limit_sec": time_limit_sec,
                        "memory_limit_mb": memory_limit_mb,
                        "cpu_count": cpu_count,
                        "output_limit_mb": output_limit_mb,
                        "status": status,
                    },
                ).mappings().first()
                problem_id = row["id"]

            next_num = conn.execute(
                text("select count(*) + 1 as n from problem_versions where problem_id = :problem_id"),
                {"problem_id": problem_id},
            ).mappings().first()["n"]
            version = str(cfg.get("version") or f"v{next_num}")

            prefix = f"problems/{slug}/{version}"
            test_key = f"{prefix}/private/test.csv" if private_test.exists() else None
            test_input_bundle_key = f"{prefix}/private/input.zip" if artifact_mode else None
            label_key = f"{prefix}/private/labels.csv" if private_labels.exists() else None
            sample_key = f"{prefix}/public/sample_submission.csv" if legacy_csv_mode and sample_submission_path == public_dir / "sample_submission.csv" else None
            public_bundle_key = f"{prefix}/public/resources.zip" if public_has_extra else None
            private_bundle_key = f"{prefix}/private/scoring.zip" if artifact_mode else None
            sample_bundle_key = f"{prefix}/public/sample/{sample_submission_path.name if sample_submission_path.is_file() else sample_submission_path.name + '.zip'}" if sample_needs_bundle else None
            scorer_key = f"{prefix}/scorer.py" if scorer.exists() else None

            if test_key:
                put_bytes(S3_BUCKET_PROBLEMS, test_key, private_test.read_bytes(), "text/csv")
            if test_input_bundle_key:
                put_bytes(S3_BUCKET_PROBLEMS, test_input_bundle_key, zip_directory_bytes(private_input_dir), "application/zip")
            if label_key:
                put_bytes(S3_BUCKET_PROBLEMS, label_key, private_labels.read_bytes(), "text/csv")
            if sample_key:
                put_bytes(S3_BUCKET_PROBLEMS, sample_key, sample_submission_path.read_bytes(), "text/csv")
            if public_bundle_key:
                put_bytes(S3_BUCKET_PROBLEMS, public_bundle_key, zip_directory_bytes(public_dir), "application/zip")
            if private_bundle_key:
                put_bytes(S3_BUCKET_PROBLEMS, private_bundle_key, zip_directory_bytes(private_scoring_dir), "application/zip")
            if sample_bundle_key:
                sample_bundle_bytes = (
                    zip_path_bytes(sample_submission_path)
                    if sample_submission_path.is_dir()
                    else sample_submission_path.read_bytes()
                )
                put_bytes(
                    S3_BUCKET_PROBLEMS,
                    sample_bundle_key,
                    sample_bundle_bytes,
                    guess_content_type(sample_submission_path.name, "application/zip" if sample_submission_path.is_dir() else "application/octet-stream"),
                )
            if scorer.exists():
                put_bytes(S3_BUCKET_PROBLEMS, scorer_key, scorer.read_bytes(), "text/x-python")
            for pdf_entry, pdf_path in statement_pdfs:
                pdf_key = f"{prefix}/statements/{pdf_entry['id']}/{pdf_path.name}"
                put_bytes(S3_BUCKET_PROBLEMS, pdf_key, pdf_path.read_bytes(), guess_content_type(pdf_path.name, "application/pdf"))
                statement_assets["pdfs"].append({**pdf_entry, "object_key": pdf_key})

            pv = conn.execute(
                text(
                    """
                    insert into problem_versions (
                        problem_id, version, statement_md, test_input_object_key, test_input_bundle_object_key,
                        label_object_key, sample_submission_object_key, public_bundle_object_key,
                        private_bundle_object_key, sample_bundle_object_key, sample_bundle_filename,
                        scorer_object_key, runner_image, run_command, required_tags, status,
                        statement_assets_json, output_files
                    )
                    values (
                        :problem_id, :version, :statement_md, :test_input_object_key, :test_input_bundle_object_key,
                        :label_object_key, :sample_submission_object_key, :public_bundle_object_key,
                        :private_bundle_object_key, :sample_bundle_object_key, :sample_bundle_filename,
                        :scorer_object_key, :runner_image, cast(:run_command as jsonb), :required_tags, :status,
                        cast(:statement_assets_json as jsonb), cast(:output_files as jsonb)
                    )
                    returning id
                    """
                ),
                {
                    "problem_id": problem_id,
                    "version": version,
                    "statement_md": statement_md,
                    "test_input_object_key": test_key,
                    "test_input_bundle_object_key": test_input_bundle_key,
                    "label_object_key": label_key,
                    "sample_submission_object_key": sample_key,
                    "public_bundle_object_key": public_bundle_key,
                    "private_bundle_object_key": private_bundle_key,
                    "sample_bundle_object_key": sample_bundle_key,
                    "sample_bundle_filename": sample_submission_path.name if sample_submission_path.is_file() else f"{sample_submission_path.name}.zip",
                    "scorer_object_key": scorer_key,
                    "runner_image": runner_image,
                    "run_command": json.dumps(run_command),
                    "required_tags": required_tags,
                    "status": initial_version_status,
                    "statement_assets_json": json.dumps(statement_assets),
                    "output_files": json.dumps(output_files),
                },
            ).mappings().first()

            self_test = run_problem_version_self_test(conn, slug, pv["id"])
            activated = False
            activation_error = None
            if activate_after_import:
                if self_test["ok"]:
                    activate_problem_version(conn, slug, pv["id"])
                    activated = True
                else:
                    activation_error = "Version self-test failed; import completed but version was not activated"
            audit_log(
                conn,
                user_id=user["id"],
                action="admin.problem.import",
                resource_type="problem",
                resource_id=slug,
                metadata={"version": version, "version_id": pv["id"], "activated": activated},
            )

    return {
        "ok": True,
        "slug": slug,
        "status": status,
        "version": version,
        "problem_version_id": pv["id"],
        "custom_scorer": bool(scorer_key),
        "version_status": "ACTIVE" if activated else initial_version_status,
        "self_test_status": self_test["self_test_status"],
        "self_test_result": self_test,
        "activated": activated,
        "activation_error": activation_error,
    }


@router.get("/api/admin/problems/{slug}/versions")
def admin_problem_versions(slug: str, user=Depends(require_admin)):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        items = list_problem_versions(conn, slug)
    if not items:
        raise HTTPException(status_code=404, detail="Problem not found")
    return {"slug": slug, "items": items}


@router.post("/api/admin/problems/{slug}/versions/{version_id}/self-test")
def admin_problem_version_self_test(slug: str, version_id: int, user=Depends(require_admin)):
    slug = safe_slug(slug)
    with engine.begin() as conn:
        try:
            result = run_problem_version_self_test(conn, slug, version_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        audit_log(
            conn,
            user_id=user["id"],
            action="admin.problem_version.self_test",
            resource_type="problem_version",
            resource_id=version_id,
            metadata={"slug": slug, "self_test_status": result.get("self_test_status")},
        )
    return {"ok": True, "result": result}


@router.post("/api/admin/problems/{slug}/versions/{version_id}/activate")
def admin_activate_problem_version(slug: str, version_id: int, payload: dict | None = None, user=Depends(require_admin)):
    slug = safe_slug(slug)
    force = bool((payload or {}).get("force", False))
    with engine.begin() as conn:
        try:
            version = activate_problem_version(conn, slug, version_id, force=force)
        except ValueError as exc:
            detail = str(exc)
            status_code = 409 if "self-test" in detail else 404 if "not found" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from exc
        audit_log(
            conn,
            user_id=user["id"],
            action="admin.problem_version.activate",
            resource_type="problem_version",
            resource_id=version_id,
            metadata={"slug": slug, "force": force},
        )
    return {"ok": True, "version": version}


@router.post("/api/admin/problems/{slug}/versions/{version_id}/status")
def admin_set_problem_version_status(
    slug: str,
    version_id: int,
    payload: dict,
    user=Depends(require_admin),
):
    slug = safe_slug(slug)
    with engine.begin() as conn:
        try:
            version = set_problem_version_status(conn, slug, version_id, payload.get("status"))
        except ValueError as exc:
            detail = str(exc)
            status_code = 404 if "not found" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=detail) from exc
        audit_log(
            conn,
            user_id=user["id"],
            action="admin.problem_version.status",
            resource_type="problem_version",
            resource_id=version_id,
            metadata={"slug": slug, "status": payload.get("status")},
        )
    return {"ok": True, "version": version}
