import pytest

from app.services import problem_versions as problem_versions_service


class DummyResult:
    def __init__(self, row=None, rowcount=1):
        self._row = row
        self.rowcount = rowcount

    def mappings(self):
        return self

    def first(self):
        return self._row


class DummyConn:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), params))
        return DummyResult()


def test_run_problem_version_self_test_passes_with_default_accuracy(monkeypatch):
    conn = DummyConn()

    monkeypatch.setattr(
        problem_versions_service,
        "problem_version_row",
        lambda conn, slug, version_id: {
            "id": version_id,
            "version": "v1",
            "slug": slug,
            "problem_status": "PUBLIC",
            "runner_image": "aioj-python-basic:latest",
            "run_command": ["python", "/workspace/predict.py"],
            "required_tags": ["cpu"],
            "sample_submission_object_key": "sample.csv",
            "label_object_key": "labels.csv",
            "scorer_object_key": None,
        },
    )
    monkeypatch.setattr(
        problem_versions_service,
        "get_text",
        lambda bucket, key: (
            "id,prediction\n1,0\n2,1\n"
            if key == "sample.csv"
            else "id,label,split\n1,0,public\n2,1,private\n"
        ),
    )

    result = problem_versions_service.run_problem_version_self_test(conn, "demo-problem", 7)

    assert result["self_test_status"] == "PASSED"
    assert result["ok"] is True
    assert result["public_score"] == 1.0
    assert result["private_score"] == 1.0
    assert conn.calls[-1][1]["self_test_status"] == "PASSED"


def test_activate_problem_version_requires_passed_self_test_without_force(monkeypatch):
    conn = DummyConn()

    monkeypatch.setattr(
        problem_versions_service,
        "problem_version_row",
        lambda conn, slug, version_id: {
            "id": version_id,
            "problem_id": 11,
            "self_test_status": "FAILED",
        },
    )

    with pytest.raises(ValueError, match="Run and pass version self-test"):
        problem_versions_service.activate_problem_version(conn, "demo-problem", 7)

    assert conn.calls == []


def test_run_problem_version_self_test_passes_with_artifact_scorer(monkeypatch):
    conn = DummyConn()
    calls = {}

    monkeypatch.setattr(
        problem_versions_service,
        "problem_version_row",
        lambda conn, slug, version_id: {
            "id": version_id,
            "version": "v2",
            "slug": slug,
            "problem_status": "PUBLIC",
            "runner_image": "aioj-python-basic:latest",
            "run_command": ["python", "/workspace/predict.py"],
            "required_tags": ["cpu"],
            "sample_bundle_object_key": "sample.zip",
            "private_bundle_object_key": "scoring.zip",
            "public_bundle_object_key": "public.zip",
            "scorer_object_key": "scorer.py",
            "output_files": ["submission_a.npy", "submission_b.npy"],
        },
    )
    monkeypatch.setattr(problem_versions_service, "get_bytes", lambda bucket, key: key.encode("utf-8"))
    monkeypatch.setattr(problem_versions_service, "get_text", lambda bucket, key: "def score_artifact(*args, **kwargs): pass")

    def fake_run_custom_scorer(scorer_code, **kwargs):
        calls["scorer_code"] = scorer_code
        calls["kwargs"] = kwargs
        return {"public_score": 0.5, "private_score": 0.75, "metrics": {"metric": "p_at_1"}}

    monkeypatch.setattr(problem_versions_service, "run_custom_scorer", fake_run_custom_scorer)

    result = problem_versions_service.run_problem_version_self_test(conn, "artifact-problem", 9)

    assert result["self_test_status"] == "PASSED"
    assert result["ok"] is True
    assert result["public_score"] == 0.5
    assert result["private_score"] == 0.75
    assert result["checks"]["scorer_mode"] == "custom_artifact"
    assert calls["kwargs"]["submission_artifact"] == b"sample.zip"
    assert calls["kwargs"]["private_bundle"] == b"scoring.zip"
    assert calls["kwargs"]["public_bundle"] == b"public.zip"
    assert calls["kwargs"]["output_files"] == ["submission_a.npy", "submission_b.npy"]
