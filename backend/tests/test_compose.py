from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_compose_starts_judge_worker_with_api():
    data = yaml.safe_load((ROOT / "compose.yaml").read_text())
    worker = data["services"]["worker"]

    assert worker["build"]["dockerfile"] == "worker/Dockerfile"
    assert worker["environment"]["AIOJ_API_BASE"] == "http://api:8000"
    assert worker["environment"]["JUDGE_NODE_NAME"] == "${WORKER_NODE_NAME:-compose-worker}"
    assert worker["environment"]["JUDGE_NODE_TAGS"] == "${JUDGE_NODE_TAGS:-cpu}"
    assert worker["environment"]["INTERNAL_API_TOKEN"] == "${INTERNAL_API_TOKEN}"
    assert "api" in worker["depends_on"]
