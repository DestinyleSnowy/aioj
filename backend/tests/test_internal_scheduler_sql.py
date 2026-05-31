import inspect

from app.routers import internal


def test_recover_stalled_jobs_locks_only_jobs_table():
    source = inspect.getsource(internal._recover_stalled_jobs)

    assert "for update of j skip locked" in source.lower()
