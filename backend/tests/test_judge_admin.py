from datetime import datetime, timedelta, timezone

from app.services.judge_admin import (
    is_job_stale,
    is_node_online,
    normalize_max_parallel,
    normalize_run_spec,
    normalize_tags,
    queue_submission_status,
    should_retry_job,
    tags_match,
)


def test_normalize_run_spec_parses_json_strings():
    spec = normalize_run_spec('{"is_test_run": true, "limits": {"cpu_count": 2}}')

    assert spec["is_test_run"] is True
    assert spec["limits"]["cpu_count"] == 2


def test_queue_submission_status_uses_test_run_flag():
    assert queue_submission_status({"is_test_run": False}) == "QUEUED"
    assert queue_submission_status({"is_test_run": True}) == "TEST_QUEUED"


def test_normalize_tags_deduplicates_and_preserves_order():
    assert normalize_tags("cpu, gpu, cpu") == ["cpu", "gpu"]


def test_normalize_max_parallel_enforces_bounds():
    assert normalize_max_parallel("4") == 4


def test_should_retry_job_uses_max_attempts():
    assert should_retry_job(1, max_attempts=3) is True
    assert should_retry_job(3, max_attempts=3) is False


def test_tags_match_requires_subset():
    assert tags_match(["python", "gpu"], ["python", "gpu", "cuda"]) is True
    assert tags_match(["python", "gpu"], ["python"]) is False


def test_is_node_online_respects_heartbeat_ttl():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert is_node_online(now - timedelta(seconds=30), now=now) is True
    assert is_node_online(now - timedelta(seconds=91), now=now) is False


def test_is_job_stale_only_for_old_claimed_jobs():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert is_job_stale("CLAIMED", now - timedelta(minutes=20), now=now) is True
    assert is_job_stale("CLAIMED", now - timedelta(minutes=2), now=now) is False
    assert is_job_stale("FAILED", now - timedelta(minutes=20), now=now) is False
