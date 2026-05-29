from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.security import require_internal_token
from app.services.evaluation import evaluate_submission, rebuild_leaderboard
from app.services.judge_admin import (
    evaluation_failed_submission_status,
    failed_submission_status,
    is_job_stale,
    is_node_online,
    node_heartbeat_ttl_seconds,
    normalize_max_parallel,
    normalize_run_spec,
    normalize_tags,
    queue_submission_status,
    should_retry_job,
    utc_now,
)
from app.settings import settings

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


def _node_registration_from_payload(payload: dict | None) -> tuple[str, list[str], int]:
    payload = payload or {}
    node_name = str(payload.get("node_name") or settings.judge_node_name).strip()
    if not node_name:
        raise HTTPException(status_code=400, detail="Missing node_name")

    try:
        tags = normalize_tags(payload.get("tags"))
        max_parallel = normalize_max_parallel(payload.get("max_parallel"), default=1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return node_name, tags, max_parallel


def _upsert_judge_node(conn, *, node_name: str, tags: list[str], max_parallel: int):
    return conn.execute(
        text(
            """
            insert into judge_nodes(name, token_hash, tags, max_parallel, status, last_heartbeat_at)
            values (:name, '', :tags, :max_parallel, 'ONLINE', now())
            on conflict (name)
            do update set
                tags = :tags,
                max_parallel = :max_parallel,
                status = 'ONLINE',
                last_heartbeat_at = now()
            returning id, name, tags, max_parallel, status, last_heartbeat_at
            """
        ),
        {
            "name": node_name,
            "tags": list(tags),
            "max_parallel": max_parallel,
        },
    ).mappings().first()


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


def _requeue_job(conn, job_id: int, submission_id: int, run_spec) -> str:
    conn.execute(
        text(
            """
            update judge_jobs
            set status = 'PENDING',
                claimed_by = null,
                claimed_at = null,
                started_at = null,
                finished_at = null
            where id = :job_id
            """
        ),
        {"job_id": job_id},
    )
    return _reset_submission_for_queue(conn, submission_id, run_spec)


def _finalize_job_failure(
    conn,
    *,
    job_id: int,
    submission,
    run_spec,
    submission_status: str,
    error_message: str,
    runtime_ms=None,
    memory_peak_mb=None,
) -> None:
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
                runtime_ms = :runtime_ms,
                memory_peak_mb = :memory_peak_mb,
                judged_at = now()
            where id = :submission_id
            """
        ),
        {
            "status": submission_status,
            "submission_id": submission["id"],
            "error_message": error_message,
            "runtime_ms": runtime_ms,
            "memory_peak_mb": memory_peak_mb,
        },
    )

    spec = normalize_run_spec(run_spec)
    if not spec.get("is_test_run"):
        rebuild_leaderboard(conn, submission["problem_id"])


def _mark_offline_nodes(conn, *, now) -> int:
    cutoff = now - timedelta(seconds=node_heartbeat_ttl_seconds())
    result = conn.execute(
        text(
            """
            update judge_nodes
            set status = 'OFFLINE'
            where status <> 'OFFLINE'
              and (last_heartbeat_at is null or last_heartbeat_at < :cutoff)
            """
        ),
        {"cutoff": cutoff},
    )
    return result.rowcount or 0


def _recover_stalled_jobs(conn, *, now) -> dict:
    rows = conn.execute(
        text(
            """
            select
                j.id,
                j.submission_id,
                j.status,
                j.attempt,
                j.run_spec,
                j.claimed_by,
                j.claimed_at,
                n.status as node_status,
                n.last_heartbeat_at
            from judge_jobs j
            left join judge_nodes n on n.id = j.claimed_by
            where j.status = 'CLAIMED'
            order by j.id asc
            for update skip locked
            """
        )
    ).mappings().all()

    recovered_jobs = 0
    failed_jobs = 0

    for job in rows:
        node_online = (
            job["claimed_by"] is not None
            and job["node_status"] == "ONLINE"
            and is_node_online(job["last_heartbeat_at"], now=now)
        )
        is_stale = is_job_stale(job["status"], job["claimed_at"], now=now)
        if not is_stale and node_online:
            continue

        submission = _submission_row_for_update(conn, int(job["submission_id"]))
        reasons = []
        if is_stale:
            reasons.append("claim timed out")
        if not node_online:
            reasons.append("judge node went offline")
        reason = "Recovered stale judge job: " + ", ".join(reasons)

        if should_retry_job(job["attempt"]):
            _requeue_job(conn, int(job["id"]), int(job["submission_id"]), job["run_spec"])
            recovered_jobs += 1
            continue

        _finalize_job_failure(
            conn,
            job_id=int(job["id"]),
            submission=submission,
            run_spec=job["run_spec"],
            submission_status=failed_submission_status(job["run_spec"]),
            error_message=reason,
        )
        failed_jobs += 1

    return {"recovered_jobs": recovered_jobs, "failed_jobs": failed_jobs}


def _run_scheduler_maintenance(conn) -> dict:
    now = utc_now()
    offline_nodes = _mark_offline_nodes(conn, now=now)
    recovered = _recover_stalled_jobs(conn, now=now)
    return {"offline_nodes": offline_nodes, **recovered}


@router.post("/api/internal/judge/heartbeat")
def internal_judge_heartbeat(payload: dict | None = None, _: None = Depends(require_internal_token)):
    node_name, tags, max_parallel = _node_registration_from_payload(payload)

    with engine.begin() as conn:
        maintenance = _run_scheduler_maintenance(conn)
        node = _upsert_judge_node(conn, node_name=node_name, tags=tags, max_parallel=max_parallel)

    return {"ok": True, "node": dict(node), "maintenance": maintenance}


@router.post("/api/internal/judge/claim")
def internal_judge_claim(payload: dict | None = None, _: None = Depends(require_internal_token)):
    node_name, tags, max_parallel = _node_registration_from_payload(payload)

    with engine.begin() as conn:
        maintenance = _run_scheduler_maintenance(conn)
        node = _upsert_judge_node(conn, node_name=node_name, tags=tags, max_parallel=max_parallel)

        active_jobs = conn.execute(
            text(
                """
                select count(*) as c
                from judge_jobs
                where claimed_by = :node_id
                  and status = 'CLAIMED'
                """
            ),
            {"node_id": node["id"]},
        ).scalar_one()
        if int(active_jobs) >= max_parallel:
            return {"ok": True, "job": None, "maintenance": maintenance}

        job = conn.execute(
            text(
                """
                select id
                from judge_jobs
                where status = 'PENDING'
                  and required_tags <@ cast(:node_tags as text[])
                order by id asc
                for update skip locked
                limit 1
                """
            ),
            {"node_tags": list(tags)},
        ).mappings().first()

        if not job:
            return {"ok": True, "job": None, "maintenance": maintenance}

        row = conn.execute(
            text(
                """
                update judge_jobs
                set status = 'CLAIMED',
                    attempt = attempt + 1,
                    claimed_by = :node_id,
                    claimed_at = now(),
                    started_at = now(),
                    finished_at = null
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

    return {"ok": True, "job": dict(row), "maintenance": maintenance}


@router.post("/api/internal/judge/finish")
def internal_judge_finish(payload: dict, _: None = Depends(require_internal_token)):
    job_id = payload.get("job_id")
    run_status = payload.get("status")
    runtime_ms = payload.get("runtime_ms")
    memory_peak_mb = payload.get("memory_peak_mb")
    error_message = payload.get("error_message")
    payload_attempt = payload.get("attempt")

    if job_id is None:
        raise HTTPException(status_code=400, detail="Missing job_id")
    if payload_attempt is not None:
        try:
            payload_attempt = int(payload_attempt)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid attempt") from exc

    with engine.begin() as conn:
        job = conn.execute(
            text("select * from judge_jobs where id = :id for update"),
            {"id": job_id},
        ).mappings().first()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        submission_id = int(job["submission_id"])
        spec = normalize_run_spec(job["run_spec"])
        submission = _submission_row_for_update(conn, submission_id)

        if payload_attempt is not None and payload_attempt != int(job["attempt"] or 0):
            return {
                "ok": True,
                "ignored": True,
                "reason": "attempt_mismatch",
                "job_id": job_id,
                "submission_id": submission_id,
                "attempt": job["attempt"],
            }

        if job["status"] != "CLAIMED":
            return {
                "ok": True,
                "ignored": True,
                "reason": "job_not_claimed",
                "job_id": job_id,
                "submission_id": submission_id,
                "status": job["status"],
            }

        if run_status == "RUN_FINISHED":
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
                err_message = str(exc)
                if should_retry_job(job["attempt"]):
                    queue_status = _requeue_job(conn, int(job["id"]), submission_id, job["run_spec"])
                    return {
                        "ok": True,
                        "submission_id": submission_id,
                        "status": queue_status,
                        "retried": True,
                        "error_message": err_message,
                    }

                _finalize_job_failure(
                    conn,
                    job_id=int(job["id"]),
                    submission=submission,
                    run_spec=job["run_spec"],
                    submission_status=err_status,
                    error_message=err_message,
                    runtime_ms=runtime_ms,
                    memory_peak_mb=memory_peak_mb,
                )
                return {
                    "ok": True,
                    "submission_id": submission_id,
                    "status": err_status,
                    "error_message": err_message,
                }

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
            final_status = "TEST_ACCEPTED" if spec.get("is_test_run") else "ACCEPTED"
            return {"ok": True, "submission_id": submission_id, "status": final_status}

        fail_status = failed_submission_status(spec)
        fail_message = str(error_message or "Run failed")
        if should_retry_job(job["attempt"]):
            queue_status = _requeue_job(conn, int(job["id"]), submission_id, job["run_spec"])
            return {
                "ok": True,
                "submission_id": submission_id,
                "status": queue_status,
                "retried": True,
                "error_message": fail_message,
            }

        _finalize_job_failure(
            conn,
            job_id=int(job["id"]),
            submission=submission,
            run_spec=job["run_spec"],
            submission_status=fail_status,
            error_message=fail_message,
            runtime_ms=runtime_ms,
            memory_peak_mb=memory_peak_mb,
        )
        return {"ok": True, "submission_id": submission_id, "status": fail_status}


@router.post("/api/internal/evaluate/{submission_id}")
def internal_evaluate(submission_id: int, _: None = Depends(require_internal_token)):
    with engine.begin() as conn:
        evaluate_submission(conn, submission_id)
    return {"ok": True, "submission_id": submission_id}


@router.get("/api/internal/status")
def internal_status(_: None = Depends(require_internal_token)):
    with engine.begin() as conn:
        maintenance = _run_scheduler_maintenance(conn)
        pending = conn.execute(text("select count(*) as c from judge_jobs where status = 'PENDING'")).scalar()
        running = conn.execute(text("select count(*) as c from judge_jobs where status = 'CLAIMED'")).scalar()
        online_nodes = conn.execute(text("select count(*) as c from judge_nodes where status = 'ONLINE'")).scalar()
        offline_nodes = conn.execute(text("select count(*) as c from judge_nodes where status = 'OFFLINE'")).scalar()
    return {
        "ok": True,
        "pending_jobs": pending,
        "running_jobs": running,
        "online_nodes": online_nodes,
        "offline_nodes": offline_nodes,
        "maintenance": maintenance,
    }
