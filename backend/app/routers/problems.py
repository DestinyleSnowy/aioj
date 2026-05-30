import json
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin
from app.services.judge_admin import normalize_tags
from app.services.problems import latest_problem_version
from app.services.problem_versions import (
    activate_problem_version,
    list_problem_versions,
    run_problem_version_self_test,
    set_problem_version_status,
)
from app.settings import settings
from app.storage import S3_BUCKET_PROBLEMS, get_text, put_bytes
from app.uploads import parse_yaml, safe_extract_zip_bytes, safe_slug, validate_problem_archive

router = APIRouter()


@router.get("/api/problems")
def list_problems():
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select id, slug, title, metric, higher_is_better, time_limit_sec,
                       memory_limit_mb, cpu_count, status, created_at
                from problems
                where status = 'PUBLIC'
                  and active_version_id is not null
                order by created_at desc, id desc
                """
            )
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/api/problems/{slug}")
def get_problem(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    data = dict(row)
    data.pop("test_input_object_key", None)
    data.pop("label_object_key", None)
    data.pop("sample_submission_object_key", None)
    data.pop("scorer_object_key", None)
    data.pop("self_test_result", None)
    return data


@router.get("/api/problems/{slug}/sample-submission")
def get_problem_sample_submission(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        row = latest_problem_version(conn, slug, public_only=True)

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")

    content = get_text(S3_BUCKET_PROBLEMS, row["sample_submission_object_key"])
    return {
        "slug": slug,
        "filename": "sample_submission.csv",
        "content_type": "text/csv",
        "content": content,
    }


@router.get("/api/problems/{slug}/leaderboard")
def leaderboard(slug: str):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        problem = conn.execute(text("select id from problems where slug = :slug"), {"slug": slug}).mappings().first()
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")

        rows = conn.execute(
            text(
                """
                select row_number() over (
                          order by le.public_score desc nulls last, le.updated_at asc
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
            {"problem_id": problem["id"]},
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

    if not row:
        raise HTTPException(status_code=404, detail="Problem not found")
    return {"ok": True, **dict(row)}


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
        statement = root / "statement.md"
        private_test = root / "private" / "test.csv"
        private_labels = root / "private" / "labels.csv"
        sample_submission = root / "public" / "sample_submission.csv"
        scorer = root / "scorer.py"

        required = [problem_yaml, statement, private_test, private_labels, sample_submission]
        missing = [str(path.relative_to(root)) for path in required if not path.exists()]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing files: {', '.join(missing)}")

        cfg = parse_yaml(problem_yaml.read_bytes())
        slug = safe_slug(str(cfg.get("slug") or ""))
        title = str(cfg.get("title") or slug)
        metric = str(cfg.get("metric") or "accuracy")
        higher_is_better = bool(cfg.get("higher_is_better", True))
        time_limit_sec = int(cfg.get("time_limit_sec", 60))
        memory_limit_mb = int(cfg.get("memory_limit_mb", 2048))
        cpu_count = int(cfg.get("cpu_count", 2))
        output_limit_mb = int(cfg.get("output_limit_mb", 64))
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

        statement_md = statement.read_text(encoding="utf-8", errors="replace")
        status = str(cfg.get("status") or "PUBLIC").upper()
        if status not in {"PUBLIC", "DRAFT", "ARCHIVED"}:
            status = "DRAFT"
        requested_version_status = str(cfg.get("version_status") or "DRAFT").upper()
        if requested_version_status not in {"DRAFT", "ACTIVE", "ARCHIVED"}:
            requested_version_status = "DRAFT"
        activate_after_import = bool(cfg.get("activate_on_import", False)) or requested_version_status == "ACTIVE"
        initial_version_status = "ARCHIVED" if requested_version_status == "ARCHIVED" else "DRAFT"

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
            test_key = f"{prefix}/private/test.csv"
            label_key = f"{prefix}/private/labels.csv"
            sample_key = f"{prefix}/public/sample_submission.csv"
            scorer_key = f"{prefix}/scorer.py" if scorer.exists() else None

            put_bytes(S3_BUCKET_PROBLEMS, test_key, private_test.read_bytes(), "text/csv")
            put_bytes(S3_BUCKET_PROBLEMS, label_key, private_labels.read_bytes(), "text/csv")
            put_bytes(S3_BUCKET_PROBLEMS, sample_key, sample_submission.read_bytes(), "text/csv")
            if scorer.exists():
                put_bytes(S3_BUCKET_PROBLEMS, scorer_key, scorer.read_bytes(), "text/x-python")

            pv = conn.execute(
                text(
                    """
                    insert into problem_versions (
                        problem_id, version, statement_md, test_input_object_key,
                        label_object_key, sample_submission_object_key, scorer_object_key,
                        runner_image, run_command, required_tags, status
                    )
                    values (
                        :problem_id, :version, :statement_md, :test_input_object_key,
                        :label_object_key, :sample_submission_object_key, :scorer_object_key,
                        :runner_image, cast(:run_command as jsonb), :required_tags, :status
                    )
                    returning id
                    """
                ),
                {
                    "problem_id": problem_id,
                    "version": version,
                    "statement_md": statement_md,
                    "test_input_object_key": test_key,
                    "label_object_key": label_key,
                    "sample_submission_object_key": sample_key,
                    "scorer_object_key": scorer_key,
                    "runner_image": runner_image,
                    "run_command": json.dumps(run_command),
                    "required_tags": required_tags,
                    "status": initial_version_status,
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
    return {"ok": True, "version": version}
