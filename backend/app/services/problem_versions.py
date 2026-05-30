import json
from typing import Any

from sqlalchemy import text

from app.services.evaluation import default_accuracy_score, run_custom_scorer
from app.storage import S3_BUCKET_PROBLEMS, get_text

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


def problem_version_summary(row) -> dict[str, Any]:
    data = dict(row)
    data["run_command"] = parse_jsonish(data.get("run_command"), [])
    data["required_tags"] = list(data.get("required_tags") or [])
    data["self_test_result"] = parse_jsonish(data.get("self_test_result"), None)
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
        sample_submission_csv = get_text(S3_BUCKET_PROBLEMS, row["sample_submission_object_key"])
        label_csv = get_text(S3_BUCKET_PROBLEMS, row["label_object_key"])

        if row.get("scorer_object_key"):
            scorer_code = get_text(S3_BUCKET_PROBLEMS, row["scorer_object_key"])
            score_result = run_custom_scorer(scorer_code, sample_submission_csv, label_csv)
            checks["scorer_mode"] = "custom"
        else:
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
