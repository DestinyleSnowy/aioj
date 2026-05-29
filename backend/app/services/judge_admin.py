import json
import re
from datetime import datetime, timedelta, timezone

from app.settings import settings

TAG_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_run_spec(run_spec) -> dict:
    if not run_spec:
        return {}
    if isinstance(run_spec, str):
        return json.loads(run_spec)
    return dict(run_spec)


def normalize_tags(value) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        raw_items = [item.strip() for item in value.split(",")]
    elif isinstance(value, (list, tuple, set)):
        raw_items = [str(item).strip() for item in value]
    else:
        raise ValueError("tags must be a string or list of strings")

    tags = []
    seen = set()
    for item in raw_items:
        if not item:
            continue
        if not TAG_PATTERN.fullmatch(item):
            raise ValueError(f"invalid tag: {item}")
        if item not in seen:
            seen.add(item)
            tags.append(item)
    return tags


def normalize_max_parallel(value, *, default: int = 1, minimum: int = 1, maximum: int = 32) -> int:
    if value in (None, ""):
        return default
    parsed = int(value)
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"max_parallel must be between {minimum} and {maximum}")
    return parsed


def node_heartbeat_ttl_seconds() -> int:
    return max(30, int(settings.judge_node_offline_seconds))


def job_stale_after_seconds() -> int:
    return max(60, int(settings.stale_job_minutes) * 60)


def should_retry_job(attempt: int | None, max_attempts: int | None = None) -> bool:
    max_attempts = max(1, int(max_attempts or settings.max_job_attempts))
    return int(attempt or 0) < max_attempts


def tags_match(required_tags, node_tags) -> bool:
    required = set(normalize_tags(required_tags))
    available = set(normalize_tags(node_tags))
    return required.issubset(available)


def queue_submission_status(run_spec) -> str:
    spec = normalize_run_spec(run_spec)
    return "TEST_QUEUED" if spec.get("is_test_run") else "QUEUED"


def failed_submission_status(run_spec) -> str:
    spec = normalize_run_spec(run_spec)
    return "TEST_FAILED" if spec.get("is_test_run") else "RUN_FAILED"


def evaluation_failed_submission_status(run_spec) -> str:
    spec = normalize_run_spec(run_spec)
    return "TEST_EVALUATION_FAILED" if spec.get("is_test_run") else "EVALUATION_FAILED"


def is_node_online(last_heartbeat_at, *, now: datetime | None = None, ttl_seconds: int | None = None) -> bool:
    if not last_heartbeat_at:
        return False
    now = now or utc_now()
    ttl_seconds = ttl_seconds or node_heartbeat_ttl_seconds()
    return last_heartbeat_at >= now - timedelta(seconds=ttl_seconds)


def is_job_stale(
    status: str | None,
    claimed_at,
    *,
    now: datetime | None = None,
    stale_after_seconds: int | None = None,
) -> bool:
    if status != "CLAIMED" or not claimed_at:
        return False
    now = now or utc_now()
    stale_after_seconds = stale_after_seconds or job_stale_after_seconds()
    return claimed_at <= now - timedelta(seconds=stale_after_seconds)
