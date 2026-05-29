from datetime import datetime, timedelta, timezone

from app.services.judge_admin import is_job_stale, is_node_online, normalize_run_spec, queue_submission_status


def test_normalize_run_spec_parses_json_strings():
    spec = normalize_run_spec('{"is_test_run": true, "limits": {"cpu_count": 2}}')

    assert spec["is_test_run"] is True
    assert spec["limits"]["cpu_count"] == 2


def test_queue_submission_status_uses_test_run_flag():
    assert queue_submission_status({"is_test_run": False}) == "QUEUED"
    assert queue_submission_status({"is_test_run": True}) == "TEST_QUEUED"


def test_is_node_online_respects_heartbeat_ttl():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert is_node_online(now - timedelta(seconds=30), now=now) is True
    assert is_node_online(now - timedelta(seconds=91), now=now) is False


def test_is_job_stale_only_for_old_claimed_jobs():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert is_job_stale("CLAIMED", now - timedelta(minutes=20), now=now) is True
    assert is_job_stale("CLAIMED", now - timedelta(minutes=2), now=now) is False
    assert is_job_stale("FAILED", now - timedelta(minutes=20), now=now) is False
