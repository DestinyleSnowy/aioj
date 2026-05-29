import json
from datetime import datetime, timedelta, timezone


NODE_HEARTBEAT_TTL_SECONDS = 90
JOB_STALE_AFTER_SECONDS = 15 * 60


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_run_spec(run_spec) -> dict:
    if not run_spec:
        return {}
    if isinstance(run_spec, str):
        return json.loads(run_spec)
    return dict(run_spec)


def queue_submission_status(run_spec) -> str:
    spec = normalize_run_spec(run_spec)
    return "TEST_QUEUED" if spec.get("is_test_run") else "QUEUED"


def failed_submission_status(run_spec) -> str:
    spec = normalize_run_spec(run_spec)
    return "TEST_FAILED" if spec.get("is_test_run") else "RUN_FAILED"


def evaluation_failed_submission_status(run_spec) -> str:
    spec = normalize_run_spec(run_spec)
    return "TEST_EVALUATION_FAILED" if spec.get("is_test_run") else "EVALUATION_FAILED"


def is_node_online(last_heartbeat_at, *, now: datetime | None = None, ttl_seconds: int = NODE_HEARTBEAT_TTL_SECONDS) -> bool:
    if not last_heartbeat_at:
        return False
    now = now or utc_now()
    return last_heartbeat_at >= now - timedelta(seconds=ttl_seconds)


def is_job_stale(
    status: str | None,
    claimed_at,
    *,
    now: datetime | None = None,
    stale_after_seconds: int = JOB_STALE_AFTER_SECONDS,
) -> bool:
    if status != "CLAIMED" or not claimed_at:
        return False
    now = now or utc_now()
    return claimed_at <= now - timedelta(seconds=stale_after_seconds)
