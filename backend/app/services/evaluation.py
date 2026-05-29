import csv
import io
import json
import subprocess
import tempfile
from pathlib import Path

from sqlalchemy import text

from app.storage import S3_BUCKET_PROBLEMS, S3_BUCKET_SUBMISSIONS, get_text


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


def run_custom_scorer(scorer_code: str, prediction_csv: str, label_csv: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="aioj_scorer_") as td:
        root = Path(td)
        (root / "scorer.py").write_text(scorer_code, encoding="utf-8")
        (root / "prediction.csv").write_text(prediction_csv, encoding="utf-8")
        (root / "labels.csv").write_text(label_csv, encoding="utf-8")

        runner = root / "run_scorer.py"
        runner.write_text(
            """
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("scorer", "scorer.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

if not hasattr(mod, "score"):
    raise RuntimeError("scorer.py must define score(prediction_csv, label_csv)")

result = mod.score(str(Path("prediction.csv").resolve()), str(Path("labels.csv").resolve()))
if not isinstance(result, dict):
    raise RuntimeError("score() must return a dict")

print(json.dumps(result, ensure_ascii=False))
""".strip(),
            encoding="utf-8",
        )

        proc = subprocess.run(
            ["python", str(runner)],
            cwd=str(root),
            text=True,
            capture_output=True,
            timeout=20,
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

    conn.execute(
        text(
            """
            update submissions
            set status = 'ACCEPTED',
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
            "public_score": result["public_score"],
            "private_score": result["private_score"],
            "metrics": json.dumps(result["metrics"]),
        },
    )

    rebuild_leaderboard(conn, row["problem_id"])
