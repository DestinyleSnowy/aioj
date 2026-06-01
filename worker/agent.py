#!/usr/bin/env python3
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
import requests


ROOT = Path(os.environ.get("AIOJ_ROOT", "/opt/aioj"))
RUN_ROOT = ROOT / "runs"
HOST_RUN_ROOT = Path(os.environ.get("AIOJ_HOST_RUN_ROOT", str(RUN_ROOT)))
LOOP = "--loop" in sys.argv

API_BASE = "http://127.0.0.1:8000"
INTERVAL = 3
NODE_NAME = "local-worker"
NODE_TAGS = []
MAX_PARALLEL = 1
HEARTBEAT_INTERVAL = 15
ALLOW_LOCAL_RUNNER = False


def load_env(path: Path):
    if not path.exists():
        return
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def configure_runtime():
    global ROOT, RUN_ROOT, HOST_RUN_ROOT
    global API_BASE, INTERVAL, NODE_NAME, NODE_TAGS, MAX_PARALLEL, HEARTBEAT_INTERVAL, ALLOW_LOCAL_RUNNER

    ROOT = Path(os.environ.get("AIOJ_ROOT", str(ROOT)))
    RUN_ROOT = ROOT / "runs"
    HOST_RUN_ROOT = Path(os.environ.get("AIOJ_HOST_RUN_ROOT", str(RUN_ROOT)))
    API_BASE = os.environ.get("AIOJ_API_BASE", "http://127.0.0.1:8000")
    INTERVAL = max(1, int(os.environ.get("AIOJ_JUDGE_INTERVAL", "3")))
    NODE_NAME = str(os.environ.get("JUDGE_NODE_NAME") or socket.gethostname()).strip() or "local-worker"
    NODE_TAGS = parse_tags(os.environ.get("JUDGE_NODE_TAGS") or os.environ.get("AIOJ_JUDGE_TAGS") or "cpu")
    MAX_PARALLEL = max(
        1,
        int(os.environ.get("JUDGE_NODE_MAX_PARALLEL", os.environ.get("AIOJ_JUDGE_MAX_PARALLEL", "1"))),
    )
    HEARTBEAT_INTERVAL = max(
        5,
        int(
            os.environ.get(
                "JUDGE_HEARTBEAT_INTERVAL_SECONDS",
                os.environ.get("AIOJ_JUDGE_HEARTBEAT_INTERVAL", "15"),
            )
        ),
    )
    ALLOW_LOCAL_RUNNER = str(os.environ.get("AIOJ_ALLOW_LOCAL_JUDGE_RUNNER", "")).lower() in {"1", "true", "yes", "on"}


def parse_tags(value):
    tags = []
    seen = set()
    for raw in str(value or "").split(","):
        tag = raw.strip()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)
    return tags


def node_registration_payload():
    return {
        "node_name": NODE_NAME,
        "tags": list(NODE_TAGS),
        "max_parallel": MAX_PARALLEL,
    }


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT", os.environ.get("MINIO_ENDPOINT", "http://127.0.0.1:9000")),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY", os.environ.get("MINIO_ROOT_USER", "aiojadmin")),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY", os.environ.get("MINIO_ROOT_PASSWORD", "aiojpassword")),
    )


def safe_extract(zip_path: Path, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    dest_root = dest.resolve()
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            target = (dest / info.filename).resolve()
            try:
                target.relative_to(dest_root)
            except ValueError:
                raise RuntimeError(f"unsafe zip path: {info.filename}")
        z.extractall(dest)


def request_json(method, path, **kwargs):
    url = f"{API_BASE}{path}"
    last = None
    headers = dict(kwargs.pop("headers", {}) or {})
    internal_api_token = os.environ.get("INTERNAL_API_TOKEN", "")
    if internal_api_token:
        headers.setdefault("X-Internal-Token", internal_api_token)
    for i in range(5):
        try:
            r = requests.request(method, url, timeout=20, headers=headers, **kwargs)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            wait = min(15, 2**i)
            print(f"api request failed ({method} {path}): {e}; retry in {wait}s", flush=True)
            time.sleep(wait)
    raise last


def heartbeat():
    return request_json("POST", "/api/internal/judge/heartbeat", json=node_registration_payload())


def claim_job():
    data = request_json("POST", "/api/internal/judge/claim", json=node_registration_payload())
    return data.get("job")


def finish_job(job_id, status, *, attempt=None, runtime_ms=None, memory_peak_mb=None, error_message=None):
    payload = {
        "job_id": job_id,
        "attempt": attempt,
        "status": status,
        "runtime_ms": runtime_ms,
        "memory_peak_mb": memory_peak_mb,
        "error_message": error_message,
    }
    return request_json("POST", "/api/internal/judge/finish", json=payload)


def download_object(s3, bucket, key, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(path))


def upload_object(s3, bucket, key, path: Path, content_type="application/octet-stream"):
    s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": content_type})


def docker_bind_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(RUN_ROOT.resolve())
    except ValueError:
        return str(resolved)
    return str((HOST_RUN_ROOT / relative).resolve())


def docker_availability_error() -> str | None:
    try:
        d_check = subprocess.run(
            ["docker", "ps"],
            text=True,
            capture_output=True,
            timeout=10,
        )
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}"

    if d_check.returncode == 0:
        return None

    detail = (d_check.stderr or d_check.stdout or "").strip()
    if detail:
        return detail
    return f"docker ps exited with code {d_check.returncode}"


def run_job(job):
    job_id = job["id"]
    attempt = job.get("attempt")
    spec = job["run_spec"]
    if isinstance(spec, str):
        spec = json.loads(spec)

    submission_id = spec["submission_id"]
    run_dir = RUN_ROOT / f"job-{job_id}"
    if run_dir.exists():
        shutil.rmtree(run_dir)

    workspace = run_dir / "workspace"
    input_dir = run_dir / "input"
    public_dir = run_dir / "public"
    output_dir = run_dir / "output"
    logs_dir = run_dir / "logs"
    for p in [workspace, input_dir, public_dir, output_dir, logs_dir]:
        p.mkdir(parents=True, exist_ok=True)

    os.chmod(run_dir, 0o755)
    os.chmod(output_dir, 0o777)
    os.chmod(logs_dir, 0o777)

    log_path = logs_dir / "run.log"
    source_zip = run_dir / "source.zip"
    test_csv = input_dir / "test.csv"
    public_bundle_zip = run_dir / "public_bundle.zip"
    private_bundle_zip = run_dir / "private_bundle.zip"

    s3 = s3_client()

    with log_path.open("w", encoding="utf-8") as log:

        def write(msg):
            print(msg, flush=True)
            log.write(msg + "\n")
            log.flush()

        try:
            write(f"claimed job={job_id}, attempt={attempt}, submission={submission_id}")
            write(f"node={NODE_NAME}, tags={','.join(NODE_TAGS) or '-'}")
            write("downloading source and test input...")

            download_object(s3, spec["source_bucket"], spec["source_object_key"], source_zip)
            if spec.get("test_input_bundle_object_key"):
                download_object(s3, spec["test_input_bundle_bucket"], spec["test_input_bundle_object_key"], private_bundle_zip)
                safe_extract(private_bundle_zip, input_dir)
            elif spec.get("private_bundle_object_key"):
                download_object(s3, spec["private_bundle_bucket"], spec["private_bundle_object_key"], private_bundle_zip)
                safe_extract(private_bundle_zip, input_dir)
            else:
                download_object(s3, spec["test_input_bucket"], spec["test_input_object_key"], test_csv)

            if spec.get("public_bundle_object_key"):
                download_object(s3, spec["public_bundle_bucket"], spec["public_bundle_object_key"], public_bundle_zip)
                safe_extract(public_bundle_zip, public_dir)

            write("extracting source.zip...")
            safe_extract(source_zip, workspace)

            run_command = spec.get("run_command") or [
                "python",
                "/workspace/predict.py",
                "--input",
                "/input/test.csv",
                "--output",
                "/output/submission.csv",
            ]
            runner_image = spec.get("runner_image") or "aioj-python-basic:latest"
            limits = spec.get("limits") or {}
            cpu_count = str(limits.get("cpu_count", 1))
            memory_limit_mb = int(limits.get("memory_limit_mb", 1024))
            time_limit_sec = int(limits.get("time_limit_sec", 60))
            output_limit_mb = int(limits.get("output_limit_mb", 64))

            docker_error = docker_availability_error()
            has_docker = docker_error is None

            if has_docker:
                cmd = [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--cap-drop",
                    "ALL",
                    "--security-opt",
                    "no-new-privileges",
                    "--read-only",
                    "--tmpfs",
                    "/tmp:rw,nosuid,nodev,size=64m",
                    "--cpus",
                    cpu_count,
                    "--memory",
                    f"{memory_limit_mb}m",
                    "--memory-swap",
                    f"{memory_limit_mb}m",
                    "--pids-limit",
                    "256",
                    "-v",
                    f"{docker_bind_path(workspace)}:/workspace:ro",
                    "-v",
                    f"{docker_bind_path(input_dir)}:/input:ro",
                    "-v",
                    f"{docker_bind_path(public_dir)}:/public:ro",
                    "-v",
                    f"{docker_bind_path(output_dir)}:/output",
                    runner_image,
                    *run_command,
                ]

                write("running docker sandbox...")
                write("command: " + " ".join(cmd))

                start = time.time()
                proc = subprocess.run(
                    cmd,
                    text=True,
                    capture_output=True,
                    timeout=time_limit_sec + 10,
                )
                runtime_ms = int((time.time() - start) * 1000)
            else:
                if docker_error:
                    write("docker availability check failed: " + docker_error)
                if not ALLOW_LOCAL_RUNNER:
                    raise RuntimeError(
                        "Docker daemon is not available or not accessible from worker; "
                        f"check failed with: {docker_error}. "
                        "Refusing to run untrusted submission locally. "
                        "Set AIOJ_ALLOW_LOCAL_JUDGE_RUNNER=true only for isolated development environments."
                    )
                write("WARNING: Docker daemon not running or not found. Falling back to local process runner.")
                
                is_windows = (os.name == "nt")
                ws_link = Path("/workspace")
                in_link = Path("/input")
                pub_link = Path("/public")
                out_link = Path("/output")
                
                if is_windows:
                    drive = workspace.anchor
                    ws_link = Path(drive) / "workspace"
                    in_link = Path(drive) / "input"
                    pub_link = Path(drive) / "public"
                    out_link = Path(drive) / "output"
                
                # Setup links
                for link, target in [(ws_link, workspace), (in_link, input_dir), (pub_link, public_dir), (out_link, output_dir)]:
                    if link.exists() or (not is_windows and link.is_symlink()):
                        try:
                            if is_windows:
                                subprocess.run(["cmd", "/c", "rmdir", str(link)], check=False)
                            else:
                                if link.is_dir() and not link.is_symlink():
                                    shutil.rmtree(link)
                                else:
                                    link.unlink()
                        except Exception:
                            pass
                    try:
                        if is_windows:
                            subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True)
                        else:
                            link.symlink_to(target, target_is_directory=True)
                    except Exception as e:
                        write(f"WARNING: Could not link {link} to {target}: {e}")

                local_cmd = []
                for arg in run_command:
                    if arg.startswith("/workspace/"):
                        local_cmd.append(str(workspace / arg[len("/workspace/"):]))
                    elif arg == "/workspace":
                        local_cmd.append(str(workspace))
                    elif arg.startswith("/input/"):
                        local_cmd.append(str(input_dir / arg[len("/input/"):]))
                    elif arg == "/input":
                        local_cmd.append(str(input_dir))
                    elif arg.startswith("/public/"):
                        local_cmd.append(str(public_dir / arg[len("/public/"):]))
                    elif arg == "/public":
                        local_cmd.append(str(public_dir))
                    elif arg.startswith("/output/"):
                        local_cmd.append(str(output_dir / arg[len("/output/"):]))
                    elif arg == "/output":
                        local_cmd.append(str(output_dir))
                    else:
                        local_cmd.append(arg)

                if local_cmd and local_cmd[0] in ("python", "python3"):
                    local_cmd[0] = sys.executable

                write("running local sandbox...")
                write("command: " + " ".join(local_cmd))

                start = time.time()
                try:
                    proc = subprocess.run(
                        local_cmd,
                        text=True,
                        capture_output=True,
                        timeout=time_limit_sec + 10,
                        cwd=str(workspace)
                    )
                finally:
                    # Clean up links
                    for link in [ws_link, in_link, pub_link, out_link]:
                        if link.exists() or (not is_windows and link.is_symlink()):
                            try:
                                if is_windows:
                                    subprocess.run(["cmd", "/c", "rmdir", str(link)], check=False)
                                else:
                                    if link.is_symlink():
                                        link.unlink()
                                    elif link.is_dir():
                                        shutil.rmtree(link)
                                    else:
                                        link.unlink()
                            except Exception:
                                pass
                
                runtime_ms = int((time.time() - start) * 1000)

            write("----- stdout -----")
            log.write(proc.stdout or "")
            if proc.stdout and not proc.stdout.endswith("\n"):
                log.write("\n")
            write("----- stderr -----")
            log.write(proc.stderr or "")
            if proc.stderr and not proc.stderr.endswith("\n"):
                log.write("\n")

            if proc.returncode != 0:
                raise RuntimeError(f"process exited with code {proc.returncode}")

            expected_output_files = spec.get("output_files") or ["submission.csv"]
            missing_outputs = []
            for relative_path in expected_output_files:
                if not (output_dir / relative_path).exists():
                    missing_outputs.append(relative_path)
            if missing_outputs:
                raise RuntimeError("Missing output files: " + ", ".join(missing_outputs))

            artifact_mode = bool(
                spec.get("public_bundle_object_key")
                or spec.get("private_bundle_object_key")
                or expected_output_files != ["submission.csv"]
                or str(spec.get("output_object_key") or "").endswith(".zip")
            )
            output_file = output_dir / "submission.csv"
            upload_path = output_file
            upload_type = "text/csv"
            if artifact_mode:
                upload_path = run_dir / "result.zip"
                with zipfile.ZipFile(upload_path, "w", zipfile.ZIP_DEFLATED) as archive:
                    for child in sorted(output_dir.rglob("*")):
                        if child.is_file():
                            archive.write(child, arcname=child.relative_to(output_dir).as_posix())
                upload_type = "application/zip"

            if upload_path.stat().st_size > output_limit_mb * 1024 * 1024:
                raise RuntimeError(f"output too large; limit is {output_limit_mb} MB")

            write("uploading output and logs...")
            upload_object(s3, spec["output_bucket"], spec["output_object_key"], upload_path, upload_type)
            upload_object(s3, spec["log_bucket"], spec["log_object_key"], log_path, "text/plain")

            result = finish_job(job_id, "RUN_FINISHED", attempt=attempt, runtime_ms=runtime_ms)
            write("finish result: " + json.dumps(result, ensure_ascii=False))

        except subprocess.TimeoutExpired:
            msg = f"time limit exceeded after {time_limit_sec}s"
            write("ERROR: " + msg)
            upload_object(s3, spec["log_bucket"], spec["log_object_key"], log_path, "text/plain")
            finish_job(job_id, "RUN_FAILED", attempt=attempt, runtime_ms=(time_limit_sec * 1000), error_message=msg)
        except Exception as e:
            msg = str(e)
            write("ERROR: " + msg)
            try:
                upload_object(s3, spec["log_bucket"], spec["log_object_key"], log_path, "text/plain")
            except Exception as up_e:
                print(f"failed to upload log: {up_e}", flush=True)
            finish_job(job_id, "RUN_FAILED", attempt=attempt, error_message=msg)


def once():
    heartbeat()
    job = claim_job()
    if not job:
        print("no pending job", flush=True)
        return False
    run_job(job)
    return True


def poll_finished(active):
    done = [future for future in active if future.done()]
    for future in done:
        job = active.pop(future)
        try:
            future.result()
        except Exception as exc:
            print(f"job {job['id']} crashed: {exc}", flush=True)


def loop_forever():
    active = {}
    next_heartbeat_at = 0.0

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as executor:
        print(
            f"aioj judge agent started node={NODE_NAME} max_parallel={MAX_PARALLEL} tags={','.join(NODE_TAGS) or '-'}",
            flush=True,
        )
        while True:
            now = time.time()
            if now >= next_heartbeat_at:
                try:
                    heartbeat()
                    next_heartbeat_at = now + HEARTBEAT_INTERVAL
                except Exception as exc:
                    print(f"heartbeat failed: {exc}", flush=True)
                    next_heartbeat_at = now + min(HEARTBEAT_INTERVAL, 10)

            poll_finished(active)

            while len(active) < MAX_PARALLEL:
                try:
                    job = claim_job()
                except Exception as exc:
                    print(f"claim failed: {exc}", flush=True)
                    break
                if not job:
                    break
                future = executor.submit(run_job, job)
                active[future] = {"id": job["id"]}

            if active:
                time.sleep(1)
            else:
                time.sleep(INTERVAL)


def main():
    load_env(ROOT / ".env")
    configure_runtime()
    RUN_ROOT.mkdir(parents=True, exist_ok=True)

    if not LOOP:
        once()
        return

    while True:
        try:
            loop_forever()
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"loop error: {e}", flush=True)
            time.sleep(min(30, INTERVAL * 3))


if __name__ == "__main__":
    main()
