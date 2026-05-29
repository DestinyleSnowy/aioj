import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin
from app.services.judge_admin import (
    JOB_STALE_AFTER_SECONDS,
    NODE_HEARTBEAT_TTL_SECONDS,
    failed_submission_status,
    is_job_stale,
    is_node_online,
    normalize_run_spec,
    queue_submission_status,
)
from app.storage import S3_BUCKET_LOGS, S3_BUCKET_PROBLEMS, S3_BUCKET_SUBMISSIONS

router = APIRouter()


def _submission_row_for_update(conn, submission_id: int):
    row = conn.execute(
        text(
            """
            select id, problem_id, status
            from submissions
            where id = :submission_id
            for update
            """
        ),
        {"submission_id": submission_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")
    return row


def _ensure_no_active_job(conn, submission_id: int) -> None:
    active = conn.execute(
        text(
            """
            select id
            from judge_jobs
            where submission_id = :submission_id
              and status in ('PENDING', 'CLAIMED')
            order by id desc
            limit 1
            """
        ),
        {"submission_id": submission_id},
    ).mappings().first()
    if active:
        raise HTTPException(status_code=409, detail="Submission already has an active judge job")


def _enqueue_submission_job(conn, submission_id: int, problem_id: int, required_tags, run_spec) -> int:
    row = conn.execute(
        text(
            """
            insert into judge_jobs(submission_id, problem_id, required_tags, status, run_spec)
            values (
                :submission_id,
                :problem_id,
                :required_tags,
                'PENDING',
                cast(:run_spec as jsonb)
            )
            returning id
            """
        ),
        {
            "submission_id": submission_id,
            "problem_id": problem_id,
            "required_tags": list(required_tags or []),
            "run_spec": json.dumps(normalize_run_spec(run_spec)),
        },
    ).mappings().first()
    return int(row["id"])


def _reset_submission_for_queue(conn, submission_id: int, run_spec) -> str:
    queue_status = queue_submission_status(run_spec)
    conn.execute(
        text(
            """
            update submissions
            set status = :status,
                public_score = null,
                private_score = null,
                metrics = null,
                error_message = null,
                runtime_ms = null,
                memory_peak_mb = null,
                judged_at = null
            where id = :submission_id
            """
        ),
        {"submission_id": submission_id, "status": queue_status},
    )
    return queue_status


def _latest_job_payload(conn, submission_id: int):
    return conn.execute(
        text(
            """
            select id, problem_id, required_tags, run_spec
            from judge_jobs
            where submission_id = :submission_id
            order by id desc
            limit 1
            """
        ),
        {"submission_id": submission_id},
    ).mappings().first()


def _build_run_spec_from_submission(conn, submission_id: int) -> dict:
    row = conn.execute(
        text(
            """
            select
                s.id as submission_id,
                s.problem_id,
                s.source_object_key,
                s.output_object_key,
                s.log_object_key,
                s.status as submission_status,
                p.slug as problem_slug,
                p.time_limit_sec,
                p.memory_limit_mb,
                p.cpu_count,
                p.output_limit_mb,
                pv.version as problem_version,
                pv.runner_image,
                pv.run_command,
                pv.test_input_object_key
            from submissions s
            join problems p on p.id = s.problem_id
            join problem_versions pv on pv.id = s.problem_version_id
            where s.id = :submission_id
            """
        ),
        {"submission_id": submission_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    is_test_run = str(row["submission_status"] or "").startswith("TEST_")
    return {
        "submission_id": row["submission_id"],
        "problem_slug": row["problem_slug"],
        "problem_version": row["problem_version"],
        "runner_image": row["runner_image"],
        "run_command": row["run_command"],
        "limits": {
            "cpu_count": row["cpu_count"],
            "time_limit_sec": row["time_limit_sec"],
            "memory_limit_mb": row["memory_limit_mb"],
            "output_limit_mb": row["output_limit_mb"],
        },
        "source_bucket": S3_BUCKET_SUBMISSIONS,
        "source_object_key": row["source_object_key"],
        "output_bucket": S3_BUCKET_SUBMISSIONS,
        "output_object_key": row["output_object_key"],
        "log_bucket": S3_BUCKET_LOGS,
        "log_object_key": row["log_object_key"],
        "test_input_bucket": S3_BUCKET_PROBLEMS,
        "test_input_object_key": row["test_input_object_key"],
        "is_test_run": is_test_run,
    }


@router.get("/api/admin/judge/overview")
def admin_judge_overview(user=Depends(require_admin)):
    now = datetime.now(timezone.utc)
    with engine.connect() as conn:
        job_counts = conn.execute(
            text(
                """
                select
                    count(*) filter (where status = 'PENDING') as pending_jobs,
                    count(*) filter (where status = 'CLAIMED') as claimed_jobs,
                    count(*) filter (where status = 'SUCCEEDED') as succeeded_jobs,
                    count(*) filter (where status = 'FAILED') as failed_jobs,
                    count(*) filter (
                        where status = 'FAILED'
                          and coalesce(finished_at, created_at) >= now() - interval '24 hours'
                    ) as failed_jobs_24h
                from judge_jobs
                """
            )
        ).mappings().first()

        submission_counts = conn.execute(
            text(
                """
                select
                    count(*) filter (where status in ('QUEUED', 'TEST_QUEUED')) as queued_submissions,
                    count(*) filter (where status = 'RUNNING') as running_submissions,
                    count(*) filter (
                        where status in ('RUN_FAILED', 'TEST_FAILED', 'EVALUATION_FAILED', 'TEST_EVALUATION_FAILED')
                    ) as failed_submissions
                from submissions
                """
            )
        ).mappings().first()

        node_rows = conn.execute(
            text(
                """
                select
                    n.id,
                    n.name,
                    n.status,
                    n.max_parallel,
                    n.last_heartbeat_at,
                    count(j.id) filter (where j.status = 'CLAIMED') as active_jobs
                from judge_nodes n
                left join judge_jobs j on j.claimed_by = n.id
                group by n.id
                order by n.last_heartbeat_at desc nulls last, n.name asc
                """
            )
        ).mappings().all()

        recent_job_rows = conn.execute(
            text(
                """
                select
                    j.id,
                    j.submission_id,
                    j.problem_id,
                    j.status,
                    j.attempt,
                    j.claimed_by,
                    j.claimed_at,
                    j.started_at,
                    j.finished_at,
                    j.created_at,
                    coalesce((j.run_spec ->> 'is_test_run')::boolean, false) as is_test_run,
                    n.name as node_name,
                    s.status as submission_status,
                    s.error_message,
                    s.runtime_ms,
                    s.memory_peak_mb,
                    s.public_score,
                    s.private_score,
                    s.contest_id,
                    p.slug as problem_slug,
                    p.title as problem_title,
                    coalesce(u.username, 'anonymous') as username
                from judge_jobs j
                join submissions s on s.id = j.submission_id
                join problems p on p.id = s.problem_id
                left join users u on u.id = s.user_id
                left join judge_nodes n on n.id = j.claimed_by
                order by j.id desc
                limit 40
                """
            )
        ).mappings().all()

        claimed_job_rows = conn.execute(
            text(
                """
                select id, claimed_at
                from judge_jobs
                where status = 'CLAIMED'
                """
            )
        ).mappings().all()

    nodes = []
    online_nodes = 0
    for row in node_rows:
        data = dict(row)
        data["is_online"] = is_node_online(data.get("last_heartbeat_at"), now=now)
        if data["is_online"]:
            online_nodes += 1
        nodes.append(data)

    recent_jobs = []
    stale_jobs = 0
    for row in recent_job_rows:
        data = dict(row)
        data["is_stale"] = is_job_stale(data.get("status"), data.get("claimed_at"), now=now)
        recent_jobs.append(data)

    for row in claimed_job_rows:
        if is_job_stale("CLAIMED", row.get("claimed_at"), now=now):
            stale_jobs += 1

    return {
        "summary": {
            **dict(job_counts or {}),
            **dict(submission_counts or {}),
            "online_nodes": online_nodes,
            "total_nodes": len(nodes),
            "stale_jobs": stale_jobs,
        },
        "timing": {
            "node_heartbeat_ttl_seconds": NODE_HEARTBEAT_TTL_SECONDS,
            "job_stale_after_seconds": JOB_STALE_AFTER_SECONDS,
            "generated_at": now,
        },
        "nodes": nodes,
        "recent_jobs": recent_jobs,
    }


@router.post("/api/admin/judge/jobs/{job_id}/retry")
def admin_retry_judge_job(job_id: int, user=Depends(require_admin)):
    with engine.begin() as conn:
        job = conn.execute(
            text(
                """
                select id, submission_id, problem_id, status, required_tags, run_spec
                from judge_jobs
                where id = :job_id
                """
            ),
            {"job_id": job_id},
        ).mappings().first()
        if not job:
            raise HTTPException(status_code=404, detail="Judge job not found")
        if job["status"] != "FAILED":
            raise HTTPException(status_code=400, detail="Only failed judge jobs can be retried")

        _ensure_no_active_job(conn, job["submission_id"])
        _submission_row_for_update(conn, job["submission_id"])
        queue_status = _reset_submission_for_queue(conn, job["submission_id"], job["run_spec"])
        new_job_id = _enqueue_submission_job(
            conn,
            submission_id=job["submission_id"],
            problem_id=job["problem_id"],
            required_tags=job["required_tags"],
            run_spec=job["run_spec"],
        )

    return {
        "ok": True,
        "retried_from_job_id": job_id,
        "job_id": new_job_id,
        "submission_id": job["submission_id"],
        "submission_status": queue_status,
    }


@router.post("/api/admin/judge/submissions/{submission_id}/rejudge")
def admin_rejudge_submission(submission_id: int, user=Depends(require_admin)):
    with engine.begin() as conn:
        submission = _submission_row_for_update(conn, submission_id)
        _ensure_no_active_job(conn, submission_id)

        latest_job = _latest_job_payload(conn, submission_id)
        if latest_job:
            run_spec = latest_job["run_spec"]
            required_tags = latest_job["required_tags"]
            problem_id = latest_job["problem_id"]
        else:
            run_spec = _build_run_spec_from_submission(conn, submission_id)
            required_tags = []
            problem_id = submission["problem_id"]

        queue_status = _reset_submission_for_queue(conn, submission_id, run_spec)
        new_job_id = _enqueue_submission_job(
            conn,
            submission_id=submission_id,
            problem_id=problem_id,
            required_tags=required_tags,
            run_spec=run_spec,
        )

    return {
        "ok": True,
        "job_id": new_job_id,
        "submission_id": submission_id,
        "submission_status": queue_status,
    }


@router.post("/api/admin/judge/jobs/{job_id}/mark-failed")
def admin_mark_judge_job_failed(job_id: int, payload: dict | None = None, user=Depends(require_admin)):
    reason = str((payload or {}).get("reason") or "").strip() or "Marked failed by admin"
    with engine.begin() as conn:
        job = conn.execute(
            text(
                """
                select id, submission_id, status, run_spec
                from judge_jobs
                where id = :job_id
                """
            ),
            {"job_id": job_id},
        ).mappings().first()
        if not job:
            raise HTTPException(status_code=404, detail="Judge job not found")
        if job["status"] not in {"PENDING", "CLAIMED"}:
            raise HTTPException(status_code=400, detail="Only pending or claimed judge jobs can be marked failed")

        submission = _submission_row_for_update(conn, job["submission_id"])
        fail_status = failed_submission_status(job["run_spec"])

        conn.execute(
            text(
                """
                update judge_jobs
                set status = 'FAILED',
                    finished_at = now()
                where id = :job_id
                """
            ),
            {"job_id": job_id},
        )

        conn.execute(
            text(
                """
                update submissions
                set status = :status,
                    public_score = null,
                    private_score = null,
                    metrics = null,
                    error_message = :error_message,
                    judged_at = now()
                where id = :submission_id
                """
            ),
            {
                "status": fail_status,
                "submission_id": job["submission_id"],
                "error_message": reason,
            },
        )

        from app.services.evaluation import rebuild_leaderboard

        if fail_status == "RUN_FAILED":
            rebuild_leaderboard(conn, submission["problem_id"])

    return {
        "ok": True,
        "job_id": job_id,
        "submission_id": job["submission_id"],
        "submission_status": fail_status,
    }
