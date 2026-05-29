import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import text

from app.db import engine
from app.dependencies import get_optional_user, require_admin, require_user
from app.services.problems import latest_problem_version
from app.storage import S3_BUCKET_LOGS, S3_BUCKET_PROBLEMS, S3_BUCKET_SUBMISSIONS, get_text, put_bytes
from app.uploads import safe_slug, validate_submission_archive

router = APIRouter()


def _get_submission_detail(submission_id: int, user=None):
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select s.*, p.slug as problem_slug, coalesce(u.username, 'anonymous') as username
                from submissions s
                join problems p on p.id = s.problem_id
                left join users u on u.id = s.user_id
                where s.id = :id
                """
            ),
            {"id": submission_id},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    data = dict(row)
    if data["user_id"] is not None and (not user or (user["role"] != "ADMIN" and user["id"] != data["user_id"])):
        raise HTTPException(status_code=403, detail="Forbidden")
    return data


@router.post("/api/problems/{slug}/submissions")
async def create_submission(
    slug: str,
    file: UploadFile = File(...),
    contest_slug: str | None = Form(None),
    user=Depends(get_optional_user),
):
    contest_id = None
    if contest_slug:
        with engine.connect() as conn:
            contest = conn.execute(
                text("select * from contests where slug = :slug and status = 'PUBLIC'"),
                {"slug": contest_slug},
            ).mappings().first()

            if not contest:
                raise HTTPException(status_code=404, detail="Contest not found")

            now = datetime.now(timezone.utc)
            if contest["start_at"] and now < contest["start_at"]:
                raise HTTPException(status_code=403, detail="Contest has not started")
            if contest["end_at"] and now > contest["end_at"]:
                raise HTTPException(status_code=403, detail="Contest has ended")

            member = conn.execute(
                text(
                    """
                    select 1
                    from contest_problems cp
                    join problems p on p.id = cp.problem_id
                    where cp.contest_id = :contest_id and p.slug = :problem_slug
                    """
                ),
                {"contest_id": contest["id"], "problem_slug": slug},
            ).first()
            if not member:
                raise HTTPException(status_code=400, detail="Problem is not in this contest")

            if not user:
                raise HTTPException(status_code=401, detail="Login required to submit in contest")

            participant = conn.execute(
                text(
                    """
                    select 1
                    from contest_participants
                    where contest_id = :contest_id and user_id = :user_id
                      and coalesce(status, 'ACCEPTED') = 'ACCEPTED'
                    """
                ),
                {"contest_id": contest["id"], "user_id": user["id"]},
            ).first()
            if not participant:
                raise HTTPException(status_code=403, detail="Join contest before submitting")

            contest_id = contest["id"]

    slug = safe_slug(slug)
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload source.zip")

    data = await file.read()
    validate_submission_archive(data)

    with engine.begin() as conn:
        pv = latest_problem_version(conn, slug, public_only=True)
        if not pv:
            raise HTTPException(status_code=404, detail="Problem not found")

        source_key = "pending/source.zip"
        output_key = "pending/output/submission.csv"
        log_key = "pending/logs/run.log"

        submission = conn.execute(
            text(
                """
                insert into submissions (
                    user_id, problem_id, problem_version_id, status,
                    source_object_key, output_object_key, log_object_key
                )
                values (
                    :user_id, :problem_id, :problem_version_id, 'QUEUED',
                    :source_object_key, :output_object_key, :log_object_key
                )
                returning id
                """
            ),
            {
                "user_id": user["id"] if user else None,
                "problem_id": pv["problem_id"],
                "problem_version_id": pv["problem_version_id"],
                "source_object_key": source_key,
                "output_object_key": output_key,
                "log_object_key": log_key,
            },
        ).mappings().first()

        submission_id = submission["id"]
        source_key = f"submissions/{submission_id}/source/source.zip"
        output_key = f"submissions/{submission_id}/output/submission.csv"
        log_key = f"submissions/{submission_id}/logs/run.log"

        put_bytes(S3_BUCKET_SUBMISSIONS, source_key, data, "application/zip")

        conn.execute(
            text(
                """
                update submissions
                set source_object_key = :source_object_key,
                    output_object_key = :output_object_key,
                    log_object_key = :log_object_key
                where id = :id
                """
            ),
            {
                "id": submission_id,
                "source_object_key": source_key,
                "output_object_key": output_key,
                "log_object_key": log_key,
            },
        )

        run_spec = {
            "submission_id": submission_id,
            "problem_slug": pv["slug"],
            "problem_version": pv["version"],
            "runner_image": pv["runner_image"],
            "run_command": pv["run_command"],
            "limits": {
                "cpu_count": pv["cpu_count"],
                "time_limit_sec": pv["time_limit_sec"],
                "memory_limit_mb": pv["memory_limit_mb"],
                "output_limit_mb": pv["output_limit_mb"],
            },
            "source_bucket": S3_BUCKET_SUBMISSIONS,
            "source_object_key": source_key,
            "output_bucket": S3_BUCKET_SUBMISSIONS,
            "output_object_key": output_key,
            "log_bucket": S3_BUCKET_LOGS,
            "log_object_key": log_key,
            "test_input_bucket": S3_BUCKET_PROBLEMS,
            "test_input_object_key": pv["test_input_object_key"],
        }

        job = conn.execute(
            text(
                """
                insert into judge_jobs(submission_id, problem_id, status, run_spec)
                values (:submission_id, :problem_id, 'PENDING', cast(:run_spec as jsonb))
                returning id
                """
            ),
            {
                "submission_id": submission_id,
                "problem_id": pv["problem_id"],
                "run_spec": json.dumps(run_spec),
            },
        ).mappings().first()

        if contest_id is not None:
            conn.execute(
                text("update submissions set contest_id = :contest_id where id = :submission_id"),
                {"contest_id": contest_id, "submission_id": submission_id},
            )

    return {"ok": True, "submission_id": submission_id, "judge_job_id": job["id"], "status": "QUEUED"}


@router.get("/api/submissions/{submission_id}")
def get_submission(submission_id: int, user=Depends(get_optional_user)):
    return _get_submission_detail(submission_id, user)


@router.get("/api/problems/{slug}/submissions")
def list_problem_submissions(slug: str, user=Depends(get_optional_user)):
    slug = safe_slug(slug)
    with engine.connect() as conn:
        problem = conn.execute(text("select id from problems where slug = :slug"), {"slug": slug}).mappings().first()
        if not problem:
            raise HTTPException(status_code=404, detail="Problem not found")

        if user and user["role"] == "ADMIN":
            where = "s.problem_id = :problem_id"
            params = {"problem_id": problem["id"]}
        elif user:
            where = "s.problem_id = :problem_id and s.user_id = :user_id"
            params = {"problem_id": problem["id"], "user_id": user["id"]}
        else:
            where = "s.problem_id = :problem_id and s.user_id is null"
            params = {"problem_id": problem["id"]}

        rows = conn.execute(
            text(
                f"""
                select s.id, p.slug as problem_slug, coalesce(u.username, 'anonymous') as username,
                       s.status, s.public_score, s.private_score, s.error_message,
                       s.runtime_ms, s.memory_peak_mb, s.created_at, s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                left join users u on u.id = s.user_id
                where {where}
                order by s.created_at desc, s.id desc
                limit 100
                """
            ),
            params,
        ).mappings().all()

    return {"items": [dict(r) for r in rows]}


@router.get("/api/my/submissions")
def my_submissions(user=Depends(require_user)):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select s.id, p.slug as problem_slug, u.username,
                       s.status, s.public_score, s.private_score, s.error_message,
                       s.runtime_ms, s.memory_peak_mb, s.created_at, s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                join users u on u.id = s.user_id
                where s.user_id = :user_id
                order by s.created_at desc, s.id desc
                limit 100
                """
            ),
            {"user_id": user["id"]},
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/api/admin/submissions/recent")
def admin_recent_submissions(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select s.id, p.slug as problem_slug, coalesce(u.username, 'anonymous') as username,
                       s.status, s.public_score, s.private_score, s.error_message,
                       s.runtime_ms, s.memory_peak_mb, s.created_at, s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                left join users u on u.id = s.user_id
                order by s.created_at desc, s.id desc
                limit 100
                """
            )
        ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/api/submissions/{submission_id}/log")
def submission_log(submission_id: int, user=Depends(get_optional_user)):
    submission = _get_submission_detail(submission_id, user)
    try:
        log = get_text(S3_BUCKET_LOGS, submission["log_object_key"])
    except Exception:
        log = ""
    return {"submission": submission, "log": log}


@router.get("/api/submissions/{submission_id}/output")
def submission_output(submission_id: int, user=Depends(get_optional_user)):
    submission = _get_submission_detail(submission_id, user)
    if not submission.get("output_object_key"):
        raise HTTPException(status_code=404, detail="Submission has no output file")
    try:
        content = get_text(S3_BUCKET_SUBMISSIONS, submission["output_object_key"])
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Output file not found: {exc}") from exc

    return {
        "submission": submission,
        "filename": "submission.csv",
        "content_type": "text/csv",
        "content": content,
    }
