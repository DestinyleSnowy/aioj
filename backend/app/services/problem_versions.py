import json
from typing import Any

from sqlalchemy import text

from app.services.problem_assets import normalize_output_files, parse_statement_assets
from app.services.evaluation import default_accuracy_score, run_custom_scorer
from app.storage import S3_BUCKET_PROBLEMS, get_bytes, get_text

VERSION_STATUSES = {"DRAFT", "ACTIVE", "ARCHIVED"}
SELF_TEST_STATUSES = {"PENDING", "PASSED", "FAILED"}


def parse_jsonish(value: Any, fallback):
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return fallback
    return value


def problem_row(conn, slug: str):
    return conn.execute(
        text(
            """
            select id, slug, title, status, active_version_id
            from problems
            where slug = :slug
            """
        ),
        {"slug": slug},
    ).mappings().first()


def problem_version_row(conn, slug: str, version_id: int):
    return conn.execute(
        text(
            """
            select
                p.id as problem_id,
                p.slug,
                p.title,
                p.status as problem_status,
                p.active_version_id,
                pv.*
            from problems p
            join problem_versions pv on pv.problem_id = p.id
            where p.slug = :slug and pv.id = :version_id
            """
        ),
        {"slug": slug, "version_id": version_id},
    ).mappings().first()


def latest_problem_draft_row(conn, slug: str):
    return conn.execute(
        text(
            """
            select
                p.id as problem_id,
                p.slug,
                p.title,
                p.status as problem_status,
                p.active_version_id,
                pv.*
            from problems p
            join problem_versions pv on pv.problem_id = p.id
            where p.slug = :slug
              and pv.status = 'DRAFT'
            order by pv.created_at desc, pv.id desc
            limit 1
            """
        ),
        {"slug": slug},
    ).mappings().first()


def problem_version_summary(row) -> dict[str, Any]:
    data = dict(row)
    data["run_command"] = parse_jsonish(data.get("run_command"), [])
    data["required_tags"] = list(data.get("required_tags") or [])
    data["self_test_result"] = parse_jsonish(data.get("self_test_result"), None)
    data["statement_assets_json"] = parse_statement_assets(parse_jsonish(data.get("statement_assets_json"), {}))
    data["output_files"] = normalize_output_files(parse_jsonish(data.get("output_files"), ["submission.csv"]))
    data["is_active"] = data.get("active_version_id") == data.get("id")
    return data


def list_problem_versions(conn, slug: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        text(
            """
            select
                p.id as problem_id,
                p.slug,
                p.title,
                p.status as problem_status,
                p.active_version_id,
                pv.*
            from problems p
            join problem_versions pv on pv.problem_id = p.id
            where p.slug = :slug
            order by pv.created_at desc, pv.id desc
            """
        ),
        {"slug": slug},
    ).mappings().all()
    return [problem_version_summary(row) for row in rows]


def next_problem_version_name(conn, problem_id: int) -> str:
    rows = conn.execute(
        text("select version from problem_versions where problem_id = :problem_id"),
        {"problem_id": problem_id},
    ).mappings().all()
    existing = {str(row.get("version") or "").strip() for row in rows}
    number = max(1, len(existing) + 1)
    candidate = f"v{number}"
    while candidate in existing:
        number += 1
        candidate = f"v{number}"
    return candidate


def create_problem_draft(conn, slug: str, source_version_id: int | None = None) -> dict[str, Any]:
    draft = latest_problem_draft_row(conn, slug)
    if draft and source_version_id is None:
        return problem_version_summary(draft)

    problem = problem_row(conn, slug)
    if not problem:
        raise ValueError("Problem not found")

    if source_version_id is not None:
        source = problem_version_row(conn, slug, source_version_id)
    elif problem.get("active_version_id"):
        source = problem_version_row(conn, slug, int(problem["active_version_id"]))
    else:
        versions = list_problem_versions(conn, slug)
        source = versions[0] if versions else None

    if not source:
        raise ValueError("Problem has no source version to clone")

    source_summary = problem_version_summary(source)
    new_version = next_problem_version_name(conn, int(problem["id"]))
    inserted = conn.execute(
        text(
            """
            insert into problem_versions (
                problem_id,
                version,
                statement_md,
                statement_assets_json,
                test_input_object_key,
                test_input_bundle_object_key,
                label_object_key,
                sample_submission_object_key,
                public_bundle_object_key,
                private_bundle_object_key,
                sample_bundle_object_key,
                sample_bundle_filename,
                output_files,
                scorer_object_key,
                runner_image,
                run_command,
                required_tags,
                status,
                self_test_status,
                self_test_result,
                last_self_tested_at
            )
            values (
                :problem_id,
                :version,
                :statement_md,
                cast(:statement_assets_json as jsonb),
                :test_input_object_key,
                :test_input_bundle_object_key,
                :label_object_key,
                :sample_submission_object_key,
                :public_bundle_object_key,
                :private_bundle_object_key,
                :sample_bundle_object_key,
                :sample_bundle_filename,
                cast(:output_files as jsonb),
                :scorer_object_key,
                :runner_image,
                cast(:run_command as jsonb),
                :required_tags,
                'DRAFT',
                :self_test_status,
                cast(:self_test_result as jsonb),
                :last_self_tested_at
            )
            returning id
            """
        ),
        {
            "problem_id": problem["id"],
            "version": new_version,
            "statement_md": str(source_summary.get("statement_md") or ""),
            "statement_assets_json": json.dumps(source_summary.get("statement_assets_json") or {}),
            "test_input_object_key": source_summary.get("test_input_object_key"),
            "test_input_bundle_object_key": source_summary.get("test_input_bundle_object_key"),
            "label_object_key": source_summary.get("label_object_key"),
            "sample_submission_object_key": source_summary.get("sample_submission_object_key"),
            "public_bundle_object_key": source_summary.get("public_bundle_object_key"),
            "private_bundle_object_key": source_summary.get("private_bundle_object_key"),
            "sample_bundle_object_key": source_summary.get("sample_bundle_object_key"),
            "sample_bundle_filename": source_summary.get("sample_bundle_filename"),
            "output_files": json.dumps(source_summary.get("output_files") or ["submission.csv"]),
            "scorer_object_key": source_summary.get("scorer_object_key"),
            "runner_image": source_summary.get("runner_image"),
            "run_command": json.dumps(source_summary.get("run_command") or []),
            "required_tags": source_summary.get("required_tags") or [],
            "self_test_status": source_summary.get("self_test_status") or "PENDING",
            "self_test_result": json.dumps(source_summary.get("self_test_result")) if source_summary.get("self_test_result") is not None else None,
            "last_self_tested_at": source_summary.get("last_self_tested_at"),
        },
    ).mappings().first()

    if not inserted:
        raise ValueError("Failed to create draft version")

    created = problem_version_row(conn, slug, int(inserted["id"]))
    return problem_version_summary(created)


def run_problem_version_self_test(conn, slug: str, version_id: int) -> dict[str, Any]:
    row = problem_version_row(conn, slug, version_id)
    if not row:
        raise ValueError("Problem version not found")

    run_command = parse_jsonish(row.get("run_command"), [])
    required_tags = list(row.get("required_tags") or [])
    checks = {
        "runner_image_configured": bool(str(row.get("runner_image") or "").strip()),
        "run_command_configured": isinstance(run_command, list) and bool(run_command) and all(
            isinstance(item, str) and item.strip() for item in run_command
        ),
        "required_tags": required_tags,
    }

    error_message = None
    metrics = {}
    public_score = None
    private_score = None

    try:
        output_files = normalize_output_files(parse_jsonish(row.get("output_files"), ["submission.csv"]))

        if row.get("sample_bundle_object_key"):
            sample_bundle = get_bytes(S3_BUCKET_PROBLEMS, row["sample_bundle_object_key"])
            private_bundle = get_bytes(S3_BUCKET_PROBLEMS, row["private_bundle_object_key"])
            public_bundle = (
                get_bytes(S3_BUCKET_PROBLEMS, row["public_bundle_object_key"])
                if row.get("public_bundle_object_key")
                else None
            )
            scorer_code = get_text(S3_BUCKET_PROBLEMS, row["scorer_object_key"])
            score_result = run_custom_scorer(
                scorer_code,
                submission_artifact=sample_bundle,
                private_bundle=private_bundle,
                public_bundle=public_bundle,
                output_files=output_files,
            )
            checks["scorer_mode"] = "custom_artifact"
        elif row.get("scorer_object_key"):
            sample_submission_csv = get_text(S3_BUCKET_PROBLEMS, row["sample_submission_object_key"])
            label_csv = get_text(S3_BUCKET_PROBLEMS, row["label_object_key"])
            scorer_code = get_text(S3_BUCKET_PROBLEMS, row["scorer_object_key"])
            score_result = run_custom_scorer(scorer_code, sample_submission_csv, label_csv)
            checks["scorer_mode"] = "custom"
        else:
            sample_submission_csv = get_text(S3_BUCKET_PROBLEMS, row["sample_submission_object_key"])
            label_csv = get_text(S3_BUCKET_PROBLEMS, row["label_object_key"])
            score_result = default_accuracy_score(sample_submission_csv, label_csv)
            checks["scorer_mode"] = "default_accuracy"

        public_score = score_result["public_score"]
        private_score = score_result["private_score"]
        metrics = score_result.get("metrics") or {}
    except Exception as exc:
        error_message = str(exc)

    if not checks["runner_image_configured"]:
        error_message = error_message or "runner_image is not configured"
    elif not checks["run_command_configured"]:
        error_message = error_message or "run_command is not configured correctly"

    self_test_status = "PASSED" if error_message is None else "FAILED"
    result = {
        "ok": self_test_status == "PASSED",
        "version_id": row["id"],
        "version": row["version"],
        "problem_slug": row["slug"],
        "problem_status": row["problem_status"],
        "checks": checks,
        "public_score": public_score,
        "private_score": private_score,
        "metrics": metrics,
        "error_message": error_message,
    }

    conn.execute(
        text(
            """
            update problem_versions
            set self_test_status = :self_test_status,
                self_test_result = cast(:self_test_result as jsonb),
                last_self_tested_at = now()
            where id = :version_id
            """
        ),
        {
            "version_id": version_id,
            "self_test_status": self_test_status,
            "self_test_result": json.dumps(result),
        },
    )

    result["self_test_status"] = self_test_status
    return result


def activate_problem_version(conn, slug: str, version_id: int, *, force: bool = False) -> dict[str, Any]:
    row = problem_version_row(conn, slug, version_id)
    if not row:
        raise ValueError("Problem version not found")

    self_test_status = str(row.get("self_test_status") or "PENDING").upper()
    if self_test_status != "PASSED" and not force:
        raise ValueError("Run and pass version self-test before activation, or retry with force=true")

    conn.execute(
        text(
            """
            update problem_versions
            set status = case when id = :version_id then 'ACTIVE' else 'ARCHIVED' end,
                activated_at = case when id = :version_id then now() else activated_at end
            where problem_id = :problem_id
              and (status = 'ACTIVE' or id = :version_id)
            """
        ),
        {"version_id": version_id, "problem_id": row["problem_id"]},
    )
    conn.execute(
        text(
            """
            update problems
            set active_version_id = :version_id,
                updated_at = now()
            where id = :problem_id
            """
        ),
        {"version_id": version_id, "problem_id": row["problem_id"]},
    )

    updated = problem_version_row(conn, slug, version_id)
    return problem_version_summary(updated)


def set_problem_version_status(conn, slug: str, version_id: int, status: str) -> dict[str, Any]:
    normalized_status = str(status or "").upper()
    if normalized_status not in {"DRAFT", "ARCHIVED"}:
        raise ValueError("Problem version status must be DRAFT or ARCHIVED")

    row = problem_version_row(conn, slug, version_id)
    if not row:
        raise ValueError("Problem version not found")

    conn.execute(
        text(
            """
            update problem_versions
            set status = :status
            where id = :version_id
            """
        ),
        {"status": normalized_status, "version_id": version_id},
    )

    if row.get("active_version_id") == version_id:
        conn.execute(
            text(
                """
                update problems
                set active_version_id = null,
                    updated_at = now()
                where id = :problem_id
                """
            ),
            {"problem_id": row["problem_id"]},
        )

    updated = problem_version_row(conn, slug, version_id)
    return problem_version_summary(updated)
