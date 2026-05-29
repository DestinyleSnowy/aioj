#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import boto3
import requests


ROOT = Path(os.environ.get("AIOJ_ROOT", "/opt/aioj"))
RUN_ROOT = ROOT / "runs"
API_BASE = os.environ.get("AIOJ_API_BASE", "http://127.0.0.1:8000")
LOOP = "--loop" in sys.argv
INTERVAL = int(os.environ.get("AIOJ_JUDGE_INTERVAL", "3"))


def load_env(path: Path):
    if not path.exists():
        return
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT", os.environ.get("MINIO_ENDPOINT", "http://127.0.0.1:9000")),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY", os.environ.get("MINIO_ROOT_USER", "aiojadmin")),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY", os.environ.get("MINIO_ROOT_PASSWORD", "aiojpassword")),
    )


def safe_extract(zip_path: Path, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            target = (dest / info.filename).resolve()
            if not str(target).startswith(str(dest.resolve())):
                raise RuntimeError(f"unsafe zip path: {info.filename}")
        z.extractall(dest)


def request_json(method, path, **kwargs):
    url = f"{API_BASE}{path}"
    last = None
    for i in range(5):
        try:
            r = requests.request(method, url, timeout=20, **kwargs)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            wait = min(15, 2 ** i)
            print(f"api request failed ({method} {path}): {e}; retry in {wait}s", flush=True)
            time.sleep(wait)
    raise last


def claim_job():
    data = request_json("POST", "/api/dev/judge/claim")
    return data.get("job")


def finish_job(job_id, status, runtime_ms=None, memory_peak_mb=None, error_message=None):
    payload = {
        "job_id": job_id,
        "status": status,
        "runtime_ms": runtime_ms,
        "memory_peak_mb": memory_peak_mb,
        "error_message": error_message,
    }
    return request_json("POST", "/api/dev/judge/finish", json=payload)


def download_object(s3, bucket, key, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(path))


def upload_object(s3, bucket, key, path: Path, content_type="application/octet-stream"):
    s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": content_type})


def run_job(job):
    job_id = job["id"]
    spec = job["run_spec"]
    if isinstance(spec, str):
        spec = json.loads(spec)

    submission_id = spec["submission_id"]
    run_dir = RUN_ROOT / f"job-{job_id}"
    if run_dir.exists():
        shutil.rmtree(run_dir)

    workspace = run_dir / "workspace"
    input_dir = run_dir / "input"
    output_dir = run_dir / "output"
    logs_dir = run_dir / "logs"
    for p in [workspace, input_dir, output_dir, logs_dir]:
        p.mkdir(parents=True, exist_ok=True)

    # The judge image may run as a non-root user.
    # Make mounted writable dirs writable inside the sandbox.
    os.chmod(run_dir, 0o755)
    os.chmod(output_dir, 0o777)
    os.chmod(logs_dir, 0o777)

    log_path = logs_dir / "run.log"
    source_zip = run_dir / "source.zip"
    test_csv = input_dir / "test.csv"

    s3 = s3_client()

    with log_path.open("w", encoding="utf-8") as log:
        def write(msg):
            print(msg, flush=True)
            log.write(msg + "\n")
            log.flush()

        try:
            write(f"claimed job={job_id}, submission={submission_id}")
            write("downloading source and test input...")

            download_object(s3, spec["source_bucket"], spec["source_object_key"], source_zip)
            download_object(s3, spec["test_input_bucket"], spec["test_input_object_key"], test_csv)

            write("extracting source.zip...")
            safe_extract(source_zip, workspace)

            run_command = spec.get("run_command") or ["python", "/workspace/predict.py", "--input", "/input/test.csv", "--output", "/output/submission.csv"]
            runner_image = spec.get("runner_image") or "aioj-python-basic:latest"
            limits = spec.get("limits") or {}
            cpu_count = str(limits.get("cpu_count", 1))
            memory_limit_mb = int(limits.get("memory_limit_mb", 1024))
            time_limit_sec = int(limits.get("time_limit_sec", 60))
            output_limit_mb = int(limits.get("output_limit_mb", 64))

            cmd = [
                "docker", "run", "--rm",
                "--network", "none",
                "--cpus", cpu_count,
                "--memory", f"{memory_limit_mb}m",
                "--pids-limit", "256",
                "-v", f"{workspace}:/workspace:ro",
                "-v", f"{input_dir}:/input:ro",
                "-v", f"{output_dir}:/output",
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

            write("----- stdout -----")
            log.write(proc.stdout or "")
            if proc.stdout and not proc.stdout.endswith("\n"):
                log.write("\n")
            write("----- stderr -----")
            log.write(proc.stderr or "")
            if proc.stderr and not proc.stderr.endswith("\n"):
                log.write("\n")

            output_file = output_dir / "submission.csv"
            if proc.returncode != 0:
                raise RuntimeError(f"process exited with code {proc.returncode}")

            if not output_file.exists():
                raise RuntimeError("output/submission.csv was not created")

            if output_file.stat().st_size > output_limit_mb * 1024 * 1024:
                raise RuntimeError(f"output too large; limit is {output_limit_mb} MB")

            write("uploading output and logs...")
            upload_object(s3, spec["output_bucket"], spec["output_object_key"], output_file, "text/csv")
            upload_object(s3, spec["log_bucket"], spec["log_object_key"], log_path, "text/plain")

            result = finish_job(job_id, "RUN_FINISHED", runtime_ms=runtime_ms)
            write("finish result: " + json.dumps(result, ensure_ascii=False))

        except subprocess.TimeoutExpired:
            msg = f"time limit exceeded after {time_limit_sec}s"
            write("ERROR: " + msg)
            upload_object(s3, spec["log_bucket"], spec["log_object_key"], log_path, "text/plain")
            finish_job(job_id, "RUN_FAILED", runtime_ms=(time_limit_sec * 1000), error_message=msg)
        except Exception as e:
            msg = str(e)
            write("ERROR: " + msg)
            try:
                upload_object(s3, spec["log_bucket"], spec["log_object_key"], log_path, "text/plain")
            except Exception as up_e:
                print(f"failed to upload log: {up_e}", flush=True)
            finish_job(job_id, "RUN_FAILED", error_message=msg)


def once():
    job = claim_job()
    if not job:
        print("no pending job", flush=True)
        return False
    run_job(job)
    return True


def main():
    load_env(ROOT / ".env")
    RUN_ROOT.mkdir(parents=True, exist_ok=True)

    if not LOOP:
        once()
        return

    print("aioj judge agent started", flush=True)
    while True:
        try:
            once()
            time.sleep(INTERVAL)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"loop error: {e}", flush=True)
            time.sleep(min(30, INTERVAL * 3))


if __name__ == "__main__":
    main()
