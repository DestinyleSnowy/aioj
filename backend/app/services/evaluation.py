import csv
import io
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from sqlalchemy import text

from app.services.problem_assets import normalize_output_files
from app.storage import S3_BUCKET_PROBLEMS, S3_BUCKET_SUBMISSIONS, get_bytes, get_text

SCORER_TIMEOUT_SEC = int(os.environ.get("AIOJ_SCORER_TIMEOUT_SEC", "900"))


def scorer_subprocess_env(temp_dir: Path) -> dict[str, str]:
    env = {
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "TMPDIR": str(temp_dir),
        "TEMP": str(temp_dir),
        "TMP": str(temp_dir),
    }
    passthrough_keys = (
        "HF_HOME",
        "HF_TOKEN",
        "HUGGINGFACE_HUB_TOKEN",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "OPENROUTER_API_KEY",
        "OPENROUTER_BASE_URL",
    )
    for key in passthrough_keys:
        value = os.environ.get(key)
        if value:
            env[key] = value
    # Windows Python startup needs SystemRoot; keep only non-secret runtime basics.
    if os.name == "nt" and os.environ.get("SystemRoot"):
        env["SystemRoot"] = os.environ["SystemRoot"]
    return env


def default_accuracy_score(prediction_csv: str, label_csv: str) -> dict:
    pred_reader = csv.DictReader(io.StringIO(prediction_csv))
    label_reader = csv.DictReader(io.StringIO(label_csv))

    if pred_reader.fieldnames != ["id", "prediction"]:
        raise ValueError("Prediction CSV must have columns exactly: id,prediction")
    if "id" not in (label_reader.fieldnames or []) or "label" not in (label_reader.fieldnames or []):
        raise ValueError("Label CSV must contain id,label columns")

    predictions = {}
    for row in pred_reader:
        predictions[str(row["id"])] = str(row["prediction"])

    labels = []
    for row in label_reader:
        labels.append(
            {
                "id": str(row["id"]),
                "label": str(row["label"]),
                "split": str(row.get("split", "private") or "private").lower(),
            }
        )

    if not labels:
        raise ValueError("Label CSV is empty")

    missing = [r["id"] for r in labels if r["id"] not in predictions]
    if missing:
        raise ValueError(f"Missing predictions for ids: {', '.join(missing[:10])}")

    def acc(rows):
        if not rows:
            return None, 0, 0
        correct = sum(1 for r in rows if predictions[r["id"]] == r["label"])
        return correct / len(rows), correct, len(rows)

    public_rows = [r for r in labels if r["split"] == "public"]
    private_rows = [r for r in labels if r["split"] != "public"]
    all_rows = labels

    public_score, public_correct, public_total = acc(public_rows)
    private_score, private_correct, private_total = acc(private_rows)
    total_score, total_correct, total_total = acc(all_rows)

    if public_score is None:
        public_score = total_score
    if private_score is None:
        private_score = total_score

    return {
        "public_score": public_score,
        "private_score": private_score,
        "metrics": {
            "metric": "accuracy",
            "public_accuracy": public_score,
            "private_accuracy": private_score,
            "total_accuracy": total_score,
            "public_correct": public_correct,
            "public_total": public_total,
            "private_correct": private_correct,
            "private_total": private_total,
            "total_correct": total_correct,
            "total_total": total_total,
        },
    }


def _extract_zip_bytes(zip_bytes: bytes, dest: Path) -> None:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        archive.extractall(dest)


def _copy_output_to_dir(root: Path, output_files: list[str], submission_artifact: bytes) -> Path:
    submission_dir = root / "submission"
    submission_dir.mkdir(parents=True, exist_ok=True)
    if len(output_files) == 1:
        (submission_dir / output_files[0]).parent.mkdir(parents=True, exist_ok=True)
        (submission_dir / output_files[0]).write_bytes(submission_artifact)
        return submission_dir

    _extract_zip_bytes(submission_artifact, submission_dir)
    return submission_dir


def run_custom_scorer(
    scorer_code: str,
    prediction_csv: str | None = None,
    label_csv: str | None = None,
    *,
    submission_artifact: bytes | None = None,
    private_bundle: bytes | None = None,
    public_bundle: bytes | None = None,
    output_files: list[str] | None = None,
) -> dict:
    with tempfile.TemporaryDirectory(prefix="aioj_scorer_") as td:
        root = Path(td)
        (root / "scorer.py").write_text(scorer_code, encoding="utf-8")
        if prediction_csv is not None:
            (root / "prediction.csv").write_text(prediction_csv, encoding="utf-8")
        if label_csv is not None:
            (root / "labels.csv").write_text(label_csv, encoding="utf-8")
        output_files = normalize_output_files(output_files)
        if submission_artifact is not None:
            _copy_output_to_dir(root, output_files, submission_artifact)
        if private_bundle is not None:
            private_dir = root / "private"
            private_dir.mkdir(parents=True, exist_ok=True)
            _extract_zip_bytes(private_bundle, private_dir)
        if public_bundle is not None:
            public_dir = root / "public"
            public_dir.mkdir(parents=True, exist_ok=True)
            _extract_zip_bytes(public_bundle, public_dir)

        runner = root / "run_scorer.py"
        runner.write_text(
            """
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("scorer", "scorer.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

submission_dir = Path("submission").resolve()
private_dir = Path("private").resolve()
public_dir = Path("public").resolve()
prediction_csv = Path("prediction.csv").resolve()
labels_csv = Path("labels.csv").resolve()

if submission_dir.exists() and hasattr(mod, "score_artifact"):
    result = mod.score_artifact(
        str(submission_dir),
        str(private_dir) if private_dir.exists() else None,
        str(public_dir) if public_dir.exists() else None,
    )
elif hasattr(mod, "score"):
    result = mod.score(str(prediction_csv), str(labels_csv))
else:
    raise RuntimeError("scorer.py must define score(...) or score_artifact(...)")

if not isinstance(result, dict):
    raise RuntimeError("score() must return a dict")

print(json.dumps(result, ensure_ascii=False))
""".strip(),
            encoding="utf-8",
        )

        proc = subprocess.run(
            [sys.executable, "-I", str(runner)],
            cwd=str(root),
            env=scorer_subprocess_env(root),
            text=True,
            capture_output=True,
            timeout=SCORER_TIMEOUT_SEC,
        )

        if proc.returncode != 0:
            raise ValueError(f"scorer.py failed:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")

        try:
            data = json.loads(proc.stdout)
        except Exception as exc:
            raise ValueError(f"scorer.py did not output valid JSON: {exc}\nOutput:\n{proc.stdout}") from exc

    if "public_score" not in data or "private_score" not in data:
        raise ValueError("scorer.py result must contain public_score and private_score")

    metrics = data.get("metrics")
    if metrics is None:
        metrics = {}
    if not isinstance(metrics, dict):
        raise ValueError("metrics must be a dict")

    return {
        "public_score": float(data["public_score"]),
        "private_score": float(data["private_score"]),
        "metrics": metrics,
    }


def rebuild_leaderboard(conn, problem_id: int) -> None:
    problem = conn.execute(
        text("select higher_is_better from problems where id = :id"),
        {"id": problem_id},
    ).mappings().first()

    higher = True if not problem else problem["higher_is_better"]

    rows = conn.execute(
        text(
            """
            select s.id, s.user_id, coalesce(u.username, 'anonymous') as username,
                   s.public_score, s.private_score, s.created_at
            from submissions s
            left join users u on u.id = s.user_id
            where s.problem_id = :problem_id
              and s.status = 'ACCEPTED'
              and s.public_score is not null
            order by s.created_at asc, s.id asc
            """
        ),
        {"problem_id": problem_id},
    ).mappings().all()

    best = {}
    for row in rows:
        key = str(row["user_id"]) if row["user_id"] is not None else "anonymous"
        old = best.get(key)
        if old is None:
            best[key] = row
            continue
        if higher:
            if row["public_score"] > old["public_score"]:
                best[key] = row
        else:
            if row["public_score"] < old["public_score"]:
                best[key] = row

    conn.execute(text("delete from leaderboard_entries where problem_id = :problem_id"), {"problem_id": problem_id})

    for row in best.values():
        conn.execute(
            text(
                """
                insert into leaderboard_entries (
                    problem_id, user_id, username, best_submission_id,
                    public_score, private_score, updated_at
                )
                values (
                    :problem_id, :user_id, :username, :best_submission_id,
                    :public_score, :private_score, now()
                )
                """
            ),
            {
                "problem_id": problem_id,
                "user_id": row["user_id"],
                "username": row["username"],
                "best_submission_id": row["id"],
                "public_score": row["public_score"],
                "private_score": row["private_score"],
            },
        )


def evaluate_submission(conn, submission_id: int) -> None:
    row = conn.execute(
        text(
            """
            select
                s.id,
                s.problem_id,
                s.output_object_key,
                pv.label_object_key,
                pv.test_input_bundle_object_key,
                pv.public_bundle_object_key,
                pv.private_bundle_object_key,
                pv.sample_bundle_object_key,
                pv.output_files,
                pv.scorer_object_key,
                p.metric
            from submissions s
            join problem_versions pv on pv.id = s.problem_version_id
            join problems p on p.id = s.problem_id
            where s.id = :id
            """
        ),
        {"id": submission_id},
    ).mappings().first()

    if not row:
        raise ValueError("Submission not found")
    if not row["output_object_key"]:
        raise ValueError("Submission has no output object")

    output_files = normalize_output_files(row.get("output_files"))
    artifact_mode = bool(
        row.get("test_input_bundle_object_key")
        or
        row.get("public_bundle_object_key")
        or row.get("private_bundle_object_key")
        or row.get("sample_bundle_object_key")
        or output_files != ["submission.csv"]
        or str(row["output_object_key"]).endswith(".zip")
    )

    if artifact_mode and row["scorer_object_key"]:
        submission_artifact = get_bytes(S3_BUCKET_SUBMISSIONS, row["output_object_key"])
        private_bundle = (
            get_bytes(S3_BUCKET_PROBLEMS, row["private_bundle_object_key"])
            if row.get("private_bundle_object_key")
            else None
        )
        public_bundle = (
            get_bytes(S3_BUCKET_PROBLEMS, row["public_bundle_object_key"])
            if row.get("public_bundle_object_key")
            else None
        )
        scorer_code = get_text(S3_BUCKET_PROBLEMS, row["scorer_object_key"])
        result = run_custom_scorer(
            scorer_code,
            submission_artifact=submission_artifact,
            private_bundle=private_bundle,
            public_bundle=public_bundle,
            output_files=output_files,
        )
        result["metrics"].setdefault("metric", row["metric"])
        result["metrics"].setdefault("scorer", "custom_artifact")
    else:
        prediction_csv = get_text(S3_BUCKET_SUBMISSIONS, row["output_object_key"])
        label_csv = get_text(S3_BUCKET_PROBLEMS, row["label_object_key"])
        if row["scorer_object_key"]:
            scorer_code = get_text(S3_BUCKET_PROBLEMS, row["scorer_object_key"])
            result = run_custom_scorer(scorer_code, prediction_csv, label_csv)
            result["metrics"].setdefault("metric", row["metric"])
            result["metrics"].setdefault("scorer", "custom")
        else:
            result = default_accuracy_score(prediction_csv, label_csv)
            result["metrics"].setdefault("scorer", "default_accuracy")

    # Check if this is a test run
    job_row = conn.execute(
        text(
            """
            select run_spec
            from judge_jobs
            where submission_id = :submission_id
            order by id desc
            limit 1
            """
        ),
        {"submission_id": submission_id},
    ).mappings().first()

    is_test_run = False
    if job_row and job_row["run_spec"]:
        spec = job_row["run_spec"]
        if isinstance(spec, str):
            spec = json.loads(spec)
        is_test_run = spec.get("is_test_run", False)

    status = "TEST_ACCEPTED" if is_test_run else "ACCEPTED"

    conn.execute(
        text(
            """
            update submissions
            set status = :status,
                public_score = :public_score,
                private_score = :private_score,
                metrics = cast(:metrics as jsonb),
                error_message = null,
                judged_at = now()
            where id = :id
            """
        ),
        {
            "id": submission_id,
            "status": status,
            "public_score": result["public_score"],
            "private_score": result["private_score"],
            "metrics": json.dumps(result["metrics"]),
        },
    )

    if not is_test_run:
        rebuild_leaderboard(conn, row["problem_id"])
