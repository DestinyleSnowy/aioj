import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def load_worker_agent():
    spec = importlib.util.spec_from_file_location("worker_agent", ROOT / "worker" / "agent.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_docker_bind_path_maps_run_root_to_host_run_root(tmp_path):
    agent = load_worker_agent()
    agent.RUN_ROOT = tmp_path / "container-runs"
    agent.HOST_RUN_ROOT = tmp_path / "host-runs"

    workspace = agent.RUN_ROOT / "job-7" / "workspace"
    workspace.mkdir(parents=True)

    assert Path(agent.docker_bind_path(workspace)) == (agent.HOST_RUN_ROOT / "job-7" / "workspace").resolve()


def test_worker_defaults_to_cpu_tag(monkeypatch):
    agent = load_worker_agent()
    monkeypatch.delenv("JUDGE_NODE_TAGS", raising=False)
    monkeypatch.delenv("AIOJ_JUDGE_TAGS", raising=False)

    agent.configure_runtime()

    assert agent.NODE_TAGS == ["cpu"]
