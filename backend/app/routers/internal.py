from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.security import require_internal_token
from app.services.evaluation import evaluate_submission, rebuild_leaderboard
from app.services.judge_admin import evaluation_failed_submission_status, failed_submission_status, normalize_run_spec
from app.settings import settings

router = APIRouter()


@router.post("/api/internal/judge/claim")
def internal_judge_claim(_: None = Depends(require_internal_token)):
    node_name = settings.judge_node_name

    with engine.begin() as conn:
        node = conn.execute(
            text(
                """
                insert into judge_nodes(name, token_hash, status, last_heartbeat_at)
                values (:name, '', 'ONLINE', now())
                on conflict (name)
                do update set status='ONLINE', last_heartbeat_at=now()
                returning id
                """
            ),
            {"name": node_name},
        ).mappings().first()

        job = conn.execute(
            text(
                """
                select id from judge_jobs
                where status = 'PENDING'
                order by id asc
                for update skip locked
                limit 1
                """
            )
        ).mappings().first()

        if not job:
            return {"ok": True, "job": None}

        row = conn.execute(
            text(
                """
                update judge_jobs
                set status = 'CLAIMED',
                    attempt = attempt + 1,
                    claimed_by = :node_id,
                    claimed_at = now(),
                    started_at = now()
                where id = :job_id
                returning *
                """
            ),
            {"node_id": node["id"], "job_id": job["id"]},
        ).mappings().first()

        conn.execute(
            text("update submissions set status = 'RUNNING' where id = :submission_id"),
            {"submission_id": row["submission_id"]},
        )

    return {"ok": True, "job": dict(row)}


@router.post("/api/internal/judge/finish")
def internal_judge_finish(payload: dict, _: None = Depends(require_internal_token)):
    job_id = payload.get("job_id")
    run_status = payload.get("status")
    runtime_ms = payload.get("runtime_ms")
    memory_peak_mb = payload.get("memory_peak_mb")
    error_message = payload.get("error_message")

    if job_id is None:
        raise HTTPException(status_code=400, detail="Missing job_id")

    with engine.begin() as conn:
        job = conn.execute(
            text("select * from judge_jobs where id = :id for update"),
            {"id": job_id},
        ).mappings().first()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        submission_id = job["submission_id"]
        spec = normalize_run_spec(job["run_spec"])
        is_test_run = spec.get("is_test_run", False)
        submission = conn.execute(
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
        if not submission:
            raise HTTPException(status_code=404, detail="Submission not found")

        if job["status"] != "CLAIMED":
            return {
                "ok": True,
                "ignored": True,
                "job_id": job_id,
                "submission_id": submission_id,
                "status": job["status"],
            }

        if run_status == "RUN_FINISHED":
            conn.execute(
                text(
                    """
                    update judge_jobs
                    set status = 'SUCCEEDED',
                        finished_at = now()
                    where id = :id
                    """
                ),
                {"id": job_id},
            )
            conn.execute(
                text(
                    """
                    update submissions
                    set status = 'RUN_FINISHED',
                        runtime_ms = :runtime_ms,
                        memory_peak_mb = :memory_peak_mb,
                        error_message = null
                    where id = :submission_id
                    """
                ),
                {
                    "submission_id": submission_id,
                    "runtime_ms": runtime_ms,
                    "memory_peak_mb": memory_peak_mb,
                },
            )

            try:
                evaluate_submission(conn, submission_id)
            except Exception as exc:
                err_status = evaluation_failed_submission_status(spec)
                conn.execute(
                    text(
                        """
                        update submissions
                        set status = :status,
                            public_score = null,
                            private_score = null,
                            metrics = null,
                            error_message = :error_message,
                            runtime_ms = coalesce(:runtime_ms, runtime_ms),
                            memory_peak_mb = coalesce(:memory_peak_mb, memory_peak_mb),
                            judged_at = now()
                        where id = :submission_id
                        """
                    ),
                    {
                        "status": err_status,
                        "submission_id": submission_id,
                        "error_message": str(exc),
                        "runtime_ms": runtime_ms,
                        "memory_peak_mb": memory_peak_mb,
                    },
                )
                if not is_test_run:
                    rebuild_leaderboard(conn, submission["problem_id"])
                return {
                    "ok": True,
                    "submission_id": submission_id,
                    "status": err_status,
                    "error_message": str(exc),
                }

            final_status = "TEST_ACCEPTED" if is_test_run else "ACCEPTED"
            return {"ok": True, "submission_id": submission_id, "status": final_status}

        conn.execute(
            text(
                """
                update judge_jobs
                set status = 'FAILED',
                    finished_at = now()
                where id = :id
                """
            ),
            {"id": job_id},
        )
        fail_status = failed_submission_status(spec)
        conn.execute(
            text(
                """
                update submissions
                set status = :status,
                    public_score = null,
                    private_score = null,
                    metrics = null,
                    error_message = :error_message,
                    runtime_ms = :runtime_ms,
                    memory_peak_mb = :memory_peak_mb,
                    judged_at = now()
                where id = :submission_id
                """
            ),
            {
                "status": fail_status,
                "submission_id": submission_id,
                "error_message": error_message or "Run failed",
                "runtime_ms": runtime_ms,
                "memory_peak_mb": memory_peak_mb,
            },
        )
        if not is_test_run:
            rebuild_leaderboard(conn, submission["problem_id"])
        return {"ok": True, "submission_id": submission_id, "status": fail_status}


@router.post("/api/internal/evaluate/{submission_id}")
def internal_evaluate(submission_id: int, _: None = Depends(require_internal_token)):
    with engine.begin() as conn:
        evaluate_submission(conn, submission_id)
    return {"ok": True, "submission_id": submission_id}


@router.get("/api/internal/status")
def internal_status(_: None = Depends(require_internal_token)):
    with engine.connect() as conn:
        pending = conn.execute(text("select count(*) as c from judge_jobs where status = 'PENDING'")).scalar()
        running = conn.execute(
            text("select count(*) as c from judge_jobs where status in ('CLAIMED','RUNNING')")
        ).scalar()
    return {"ok": True, "pending_jobs": pending, "running_jobs": running}
