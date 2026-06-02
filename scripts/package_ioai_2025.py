from __future__ import annotations

import argparse
import json
import re
import shutil
import textwrap
import unicodedata
import zipfile
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

import numpy as np


RUNNER_IMAGE = "aioj-python-ioai-cpu:latest"
PIXEL_REF_DATASET = "IOAI-official/IOAI-2025-Pixel-ref"
STOP_HEADINGS = {
    "### data loading",
    "### dependencies and config variables",
    "### imports",
    "### train your model",
}


def repair_mojibake(text: str) -> str:
    suspicious = ("Ã", "Â", "¡", "©", "â")
    if not any(token in text for token in suspicious):
        return text
    try:
        repaired = text.encode("latin-1").decode("utf-8")
    except Exception:
        return text
    if repaired.count("©") >= text.count("©") and repaired.count("¡") >= text.count("¡"):
        return text
    return repaired


def normalize_markdown(text: str) -> str:
    text = repair_mojibake(text).replace("\r\n", "\n")
    text = re.sub(
        r'<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>',
        lambda m: f'![{m.group(2)}]({m.group(1)})',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"<img[^>]*src='([^']+)'[^>]*alt='([^']*)'[^>]*>",
        lambda m: f'![{m.group(2)}]({m.group(1)})',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r'<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"[^>]*>',
        lambda m: f'![{m.group(1)}]({m.group(2)})',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"<img[^>]*alt='([^']*)'[^>]*src='([^']+)'[^>]*>",
        lambda m: f'![{m.group(1)}]({m.group(2)})',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r'<img[^>]*src="([^"]+)"[^>]*>',
        lambda m: f'![]({m.group(1)})',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"<img[^>]*src='([^']+)'[^>]*>",
        lambda m: f'![]({m.group(1)})',
        text,
        flags=re.IGNORECASE,
    )
    text = text.replace("./figs/", "figs/").replace(".\\figs\\", "figs/")
    text = re.sub(r"^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$", "", text, flags=re.MULTILINE)
    text = re.sub(
        r"^\|(.*)\|$",
        lambda m: "  ".join(part.strip() for part in m.group(1).split("|") if part.strip()),
        text,
        flags=re.MULTILINE,
    )
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?span[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?div[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?p[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_statement_markdown(notebook_path: Path) -> str:
    data = json.loads(notebook_path.read_text(encoding="utf-8"))
    chunks: list[str] = []
    for cell in data.get("cells", []):
        if cell.get("cell_type") == "code" and chunks:
            break
        if cell.get("cell_type") != "markdown":
            continue
        text = normalize_markdown("".join(cell.get("source", [])))
        if not text:
            continue
        heading = text.splitlines()[0].strip().lower()
        if heading in STOP_HEADINGS:
            break
        chunks.append(text)
    statement = "\n\n".join(chunks).strip()
    if not statement:
        raise RuntimeError(f"Failed to extract statement markdown from {notebook_path}")
    return statement + "\n"


def reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def copy_tree(src: Path, dst: Path) -> None:
    shutil.copytree(src, dst, dirs_exist_ok=True)


def copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_jsonl(path: Path, rows: list[object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def write_problem_yaml(path: Path, cfg: dict) -> None:
    statement_languages = cfg.get("statement_languages") if isinstance(cfg.get("statement_languages"), dict) else {"en": "English"}
    if "en" not in statement_languages:
        statement_languages = {"en": "English", **statement_languages}
    lines = [
        f"slug: {json.dumps(cfg['slug'], ensure_ascii=False)}",
        f"title: {json.dumps(cfg['title'], ensure_ascii=False)}",
        f"metric: {json.dumps(cfg['metric'], ensure_ascii=False)}",
        f"higher_is_better: {'true' if cfg['higher_is_better'] else 'false'}",
        f"time_limit_sec: {int(cfg['time_limit_sec'])}",
        f"memory_limit_mb: {int(cfg['memory_limit_mb'])}",
        f"cpu_count: {int(cfg['cpu_count'])}",
        f"output_limit_mb: {int(cfg['output_limit_mb'])}",
        f"runner_image: {json.dumps(cfg['runner_image'], ensure_ascii=False)}",
        'required_tags: ["cpu"]',
        f"sample_submission: {json.dumps(cfg['sample_submission'], ensure_ascii=False)}",
        "default_statement_language: en",
        "statement_languages:",
    ]
    ordered_language_ids = ["en"] + sorted(lang_id for lang_id in statement_languages if lang_id != "en")
    for language_id in ordered_language_ids:
        lines.append(f"  {language_id}: {json.dumps(str(statement_languages[language_id]), ensure_ascii=False)}")
    lines.append(f"activate_on_import: {'true' if cfg['activate_on_import'] else 'false'}")
    lines.append("run_command:")
    for arg in cfg["run_command"]:
        lines.append(f"  - {json.dumps(arg, ensure_ascii=False)}")
    lines.append("output_files:")
    for arg in cfg["output_files"]:
        lines.append(f"  - {json.dumps(arg, ensure_ascii=False)}")
    write_text(path, "\n".join(lines) + "\n")


def zip_directory(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(src.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(src).as_posix())


def copy_figures(task_dir: Path, public_dir: Path) -> None:
    figs_dir = task_dir / "figs"
    if figs_dir.is_dir():
        copy_tree(figs_dir, public_dir / "figs")


def statement_language_id(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", repair_mojibake(text))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-") or "statement"


def clean_translation_pdf_label(text: str) -> str:
    cleaned = repair_mojibake(text).replace("_", " ")
    cleaned = re.sub(r"(?i)\bindividual contest day[12]\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bgaite day[12]\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bteamleadertranslate\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bteamleadtranslate\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bmachinetranslate\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bteam leader translate\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bteam lead translate\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bmachine translate\b", " ", cleaned)
    cleaned = re.sub(r"(?i)\bold\d*\b", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" -_")


def translation_pdf_label(pdf_path: Path) -> str:
    country = clean_translation_pdf_label(pdf_path.parent.name) or "Translation"
    descriptor = clean_translation_pdf_label(pdf_path.stem)
    if not descriptor:
        return country
    country_norm = re.sub(r"\s+", " ", country).casefold()
    descriptor_norm = re.sub(r"\s+", " ", descriptor).casefold()
    if descriptor_norm == country_norm:
        return country
    if country_norm and country_norm in descriptor_norm:
        return descriptor
    return f"{country} · {descriptor}"


def copy_translation_pdfs(source_root: Path, package_dir: Path, cfg: dict) -> dict[str, str]:
    translation_pack = str(cfg.get("translation_pack") or "").strip()
    if not translation_pack:
        return {}

    translation_dir = source_root / "Translations" / translation_pack
    if not translation_dir.is_dir():
        return {}

    expected_day = "day2" if "day2" in translation_pack.lower() else "day1"
    labels: dict[str, str] = {}
    used_ids = {"en"}
    for pdf_path in sorted(translation_dir.rglob("*.pdf")):
        if not pdf_path.is_file() or pdf_path.name.startswith("._"):
            continue
        normalized_name = repair_mojibake(pdf_path.name).casefold()
        if expected_day == "day2" and "day1" in normalized_name:
            continue
        if expected_day == "day1" and "day2" in normalized_name:
            continue
        label = translation_pdf_label(pdf_path)
        base_id = statement_language_id(label)
        language_id = base_id
        suffix = 2
        while language_id in used_ids:
            language_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(language_id)
        copy_file(pdf_path, package_dir / "statements" / language_id / pdf_path.name)
        labels[language_id] = label

    return labels


def ensure_placeholder(dir_path: Path, message: str) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)
    write_text(dir_path / "README.txt", message + "\n")


def radar_scorer() -> str:
    return textwrap.dedent(
        """
        import json
        from pathlib import Path

        import numpy as np
        import pandas as pd


        def load_ground_truth(csv_path: Path) -> dict[str, np.ndarray]:
            frame = pd.read_csv(csv_path)
            cols = [column for column in frame.columns if column.startswith("pixel_")]
            ground_truth = {}
            for _, row in frame.iterrows():
                ground_truth[str(row["filename"])] = row[cols].to_numpy(dtype=int)
            return ground_truth


        def calculate_score(csv_path: Path, ground_truth: dict[str, np.ndarray], bonus: int = 50) -> float:
            frame = pd.read_csv(csv_path)
            pred_cols = [column for column in frame.columns if column.startswith("pixel_")]
            if not pred_cols:
                raise ValueError("No prediction columns found")

            total_score = 0
            total_theoretical = 0
            for _, row in frame.iterrows():
                filename = str(row["filename"])
                if filename not in ground_truth:
                    raise ValueError(f"Missing ground truth for {filename}")
                predictions = row[pred_cols].to_numpy(dtype=int)
                labels = ground_truth[filename]
                if len(predictions) != len(labels):
                    raise ValueError(f"Length mismatch for {filename}")
                equal_mask = predictions == labels
                neg_one_mask = labels == -1
                total_score += int(np.sum(equal_mask & neg_one_mask))
                total_score += int(np.sum(equal_mask & ~neg_one_mask)) * bonus
                total_theoretical += int(np.sum(neg_one_mask))
                total_theoretical += int(np.sum(~neg_one_mask)) * bonus

            if total_theoretical <= 0:
                return 0.0
            score = total_score / total_theoretical
            return float(score if np.isfinite(score) and 0.0 <= score <= 1.0 else 0.0)


        def score_artifact(submission_dir: str, private_dir: str | None, public_dir: str | None):
            submission_root = Path(submission_dir)
            private_root = Path(private_dir or submission_dir)
            public_score = calculate_score(
                submission_root / "output_validation.csv",
                load_ground_truth(private_root / "ground_truth_val.csv"),
            )
            private_score = calculate_score(
                submission_root / "output_testing.csv",
                load_ground_truth(private_root / "ground_truth_test.csv"),
            )
            return {
                "public_score": public_score,
                "private_score": private_score,
                "metrics": {
                    "metric": "weighted_accuracy",
                    "public_accuracy": public_score,
                    "private_accuracy": private_score,
                },
            }
        """
    ).strip() + "\n"


def restroom_scorer() -> str:
    return textwrap.dedent(
        """
        from pathlib import Path

        import numpy as np


        def precision_at_1(predictions: np.ndarray, labels: np.ndarray) -> float:
            if predictions.shape != labels.shape:
                raise ValueError("Prediction shape does not match answer shape")
            score = float(np.sum(predictions == labels) / len(labels))
            return score if np.isfinite(score) and 0.0 <= score <= 1.0 else 0.0


        def score_artifact(submission_dir: str, private_dir: str | None, public_dir: str | None):
            submission_root = Path(submission_dir)
            private_root = Path(private_dir or submission_dir)
            public_score = precision_at_1(
                np.load(submission_root / "submission_a.npy"),
                np.load(private_root / "answer_a.npy"),
            )
            private_score = precision_at_1(
                np.load(submission_root / "submission_b.npy"),
                np.load(private_root / "answer_b.npy"),
            )
            return {
                "public_score": public_score,
                "private_score": private_score,
                "metrics": {
                    "metric": "precision_at_1",
                    "public_precision_at_1": public_score,
                    "private_precision_at_1": private_score,
                },
            }
        """
    ).strip() + "\n"


def antique_scorer() -> str:
    return textwrap.dedent(
        """
        from pathlib import Path
        import zipfile

        import numpy as np
        import pandas as pd
        from sklearn.metrics import accuracy_score


        def score_artifact(submission_dir: str, private_dir: str | None, public_dir: str | None):
            submission_root = Path(submission_dir)
            private_root = Path(private_dir or submission_dir)
            extracted = submission_root / "_unzipped"
            extracted.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(submission_root / "submission.zip") as archive:
                archive.extractall(extracted)

            labels = pd.read_csv(private_root / "label.csv")
            pred_a = pd.read_csv(extracted / "submissionA.csv", header=None)
            pred_b = pd.read_csv(extracted / "submissionB.csv", header=None)
            public_score = float(accuracy_score(pred_a, labels["validation_label"]))
            private_score = float(accuracy_score(pred_b, labels["testing_label"]))
            return {
                "public_score": public_score if np.isfinite(public_score) else 0.0,
                "private_score": private_score if np.isfinite(private_score) else 0.0,
                "metrics": {
                    "metric": "accuracy",
                    "public_accuracy": public_score,
                    "private_accuracy": private_score,
                },
            }
        """
    ).strip() + "\n"


def chicken_scorer() -> str:
    return textwrap.dedent(
        """
        import math
        from pathlib import Path

        import numpy as np
        from datasets import load_dataset


        DATASET_NAME = "ioaihsc/Task2_Chicken_Counting_LABEL"


        def validate_predictions(predictions: np.ndarray) -> np.ndarray:
            if not isinstance(predictions, np.ndarray):
                raise ValueError("Predictions must be a numpy array")
            if predictions.shape == (100, 180, 320):
                return predictions
            if predictions.shape == (100, 1, 180, 320):
                return predictions[:, 0, :, :]
            raise ValueError("Prediction arrays must have shape 100x180x320 or 100x1x180x320")


        def load_targets(split: str) -> np.ndarray:
            dataset = load_dataset(DATASET_NAME, data_dir="valandtest", split=split)
            targets = [np.asarray(item["density"], dtype=np.float32) for item in dataset]
            return np.stack(targets, axis=0)


        def evaluate(predictions: np.ndarray, targets: np.ndarray) -> float:
            preds_sum = predictions.reshape(len(predictions), -1).sum(axis=1)
            target_sum = targets.reshape(len(targets), -1).sum(axis=1)
            with np.errstate(divide="ignore", invalid="ignore"):
                rates = np.abs(1 - preds_sum / target_sum)
            rates = np.where(np.isfinite(rates), rates, 1.0)
            score = math.exp(-float(rates.mean()))
            return score if np.isfinite(score) and 0.0 <= score <= 1.0 else 0.0


        def score_artifact(submission_dir: str, private_dir: str | None, public_dir: str | None):
            submission_root = Path(submission_dir)
            predictions = np.load(submission_root / "submission.npz", allow_pickle=False)
            if "pred_a" not in predictions or "pred_b" not in predictions:
                raise ValueError("submission.npz must contain pred_a and pred_b")
            pred_a = validate_predictions(predictions["pred_a"])
            pred_b = validate_predictions(predictions["pred_b"])
            score_a = evaluate(pred_a, load_targets("validation"))
            score_b = evaluate(pred_b, load_targets("test"))
            return {
                "public_score": score_a,
                "private_score": score_b,
                "metrics": {
                    "metric": "density_similarity",
                    "public_density_similarity": score_a,
                    "private_density_similarity": score_b,
                },
            }
        """
    ).strip() + "\n"


def concepts_scorer() -> str:
    return textwrap.dedent(
        """
        import json
        import math
        import os
        from pathlib import Path

        from datasets import load_dataset
        from openai import OpenAI


        VALID_DATASET = "IOAI-official/ioai2025-onsite-concepts-validation"
        TEST_DATASET = "IOAI-official/ioai2025-onsite-concepts-test"
        HINT_DATASET = "IOAI-official/ioai2025-onsite-concepts-hint-descriptions"
        DEFAULT_MODEL = "google/gemini-2.5-flash-lite-preview-06-17"


        def get_client() -> OpenAI:
            if os.environ.get("OPENROUTER_API_KEY"):
                return OpenAI(
                    api_key=os.environ["OPENROUTER_API_KEY"],
                    base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                )
            if os.environ.get("OPENAI_API_KEY"):
                return OpenAI(
                    api_key=os.environ["OPENAI_API_KEY"],
                    base_url=os.environ.get("OPENAI_BASE_URL") or None,
                )
            raise RuntimeError("Concepts evaluation requires OPENROUTER_API_KEY or OPENAI_API_KEY")


        def load_hint_descriptions() -> dict[int, str]:
            dataset = load_dataset(HINT_DATASET, split="train")
            return {int(row["ID"]): str(row["Description"]).replace("\\n", ", ") for row in dataset}


        def read_clues(path: Path) -> list[list[list[int]]]:
            with path.open("r", encoding="utf-8") as handle:
                return [json.loads(line) for line in handle if line.strip()]


        def normalize_guesses(payload) -> list[str]:
            if isinstance(payload, dict) and isinstance(payload.get("answer"), list):
                return [str(item).lower() for item in payload["answer"]]
            if isinstance(payload, list):
                return [str(item).lower() for item in payload]
            raise ValueError("Judge response did not contain a valid answer list")


        def guess_keyword(client: OpenAI, model: str, hint_dict: dict[int, str], clues, options) -> list[str]:
            ordinals = ["first", "second", "third", "fourth"]
            lines = []
            for index, sequence in enumerate(clues):
                lines.append(f"{ordinals[index]} clue:")
                for marker in sequence:
                    lines.append(f" - {hint_dict.get(int(marker), f'[hint {marker}]')}")
                lines.append("")
            prompt = (
                "You are playing a Concepts game. "
                "Return a JSON object with a single key named answer whose value is a list of ten guesses.\\n\\n"
                + "\\n".join(lines)
                + "\\nThe secret keyword is guaranteed to be one of the following options:\\n"
                + "\\n".join(str(option) for option in options)
            )
            completion = client.chat.completions.create(
                model=model,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "You output only valid JSON."},
                    {"role": "user", "content": prompt},
                ],
            )
            content = completion.choices[0].message.content or "{}"
            return normalize_guesses(json.loads(content))


        def ndcg_at_10(predictions: list[str], answer: str) -> float:
            answer = str(answer).lower()
            if answer not in predictions[:10]:
                return 0.0
            rank = predictions[:10].index(answer) + 1
            return 1 / math.log2(rank + 1)


        def score_dataset(client: OpenAI, model: str, hint_dict: dict[int, str], clues, dataset) -> float:
            if len(clues) != len(dataset):
                raise ValueError(f"Expected {len(dataset)} clue sets, got {len(clues)}")
            scores = []
            for clue, row in zip(clues, dataset):
                predictions = guess_keyword(client, model, hint_dict, clue, row["options"])
                answer = str(row["label"]).lower()
                hit10 = 1.0 if answer in predictions[:10] else 0.0
                scores.append(0.9 * hit10 + 0.1 * ndcg_at_10(predictions, answer))
            score = float(sum(scores) / len(scores))
            return score if math.isfinite(score) and 0.0 <= score <= 1.0 else 0.0


        def score_artifact(submission_dir: str, private_dir: str | None, public_dir: str | None):
            submission_root = Path(submission_dir)
            model = os.environ.get("CONCEPTS_GUESSER_MODEL", DEFAULT_MODEL)
            client = get_client()
            hint_dict = load_hint_descriptions()
            public_dataset = load_dataset(VALID_DATASET)["test"]
            private_dataset = load_dataset(TEST_DATASET)["test"]
            public_score = score_dataset(client, model, hint_dict, read_clues(submission_root / "clues_a.jsonl"), public_dataset)
            private_score = score_dataset(client, model, hint_dict, read_clues(submission_root / "clues_b.jsonl"), private_dataset)
            return {
                "public_score": public_score,
                "private_score": private_score,
                "metrics": {
                    "metric": "guess_score",
                    "public_guess_score": public_score,
                    "private_guess_score": private_score,
                },
            }
        """
    ).strip() + "\n"


def pixel_scorer() -> str:
    return textwrap.dedent(
        """
        import json
        import math
        import os
        import random
        from pathlib import Path

        import numpy as np
        import torch
        from datasets import load_dataset
        from PIL import Image
        from transformers import CLIPModel, CLIPProcessor


        DATASET_PATH = "IOAI-official/IOAI-2025-Pixel-ref"
        MODEL_PATH = "openai/clip-vit-large-patch14"
        RETAIN_RATIO = 0.0625
        DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


        def read_masks(mask_file_path: Path) -> dict[str, list[list[int]]]:
            masks = {}
            with mask_file_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    masks[str(data["idx"])] = data["coordinates"]
            return masks


        def valid_coordinates(coordinates) -> bool:
            try:
                (top, left), (bottom, right) = coordinates
            except Exception:
                return False
            coords = [top, left, bottom, right]
            if not all(isinstance(value, int) for value in coords):
                return False
            if not (0 <= top < 224 and 0 <= left < 224 and 1 <= bottom <= 224 and 1 <= right <= 224):
                return False
            if not (top < bottom and left < right):
                return False
            area = (bottom - top) * (right - left)
            return area > 0 and area <= RETAIN_RATIO * 224 * 224


        def generate_mask(coordinates):
            mask = np.zeros((224, 224), dtype=np.int8)
            (top, left), (bottom, right) = coordinates
            mask[top:bottom, left:right] = 1
            return mask


        def apply_mask(image: Image.Image, mask: np.ndarray):
            array = np.asarray(image.convert("RGB")).copy()
            keep = np.stack([mask > 0] * 3, axis=2)
            array = np.where(keep, array, np.zeros((1, 1, 3), dtype=np.uint8))
            return Image.fromarray(array.astype(np.uint8))


        def score_artifact(submission_dir: str, private_dir: str | None, public_dir: str | None):
            submission_root = Path(submission_dir)
            dataset = load_dataset(DATASET_PATH, split="ref")
            masks = read_masks(submission_root / "submission.jsonl")
            if len(masks) != len(dataset):
                raise ValueError(f"Expected {len(dataset)} masks, got {len(masks)}")

            model = CLIPModel.from_pretrained(MODEL_PATH).to(DEVICE)
            processor = CLIPProcessor.from_pretrained(MODEL_PATH)
            model.eval()
            labels = sorted(set(dataset["name"])) + ["other"]
            text_inputs = processor(text=labels, return_tensors="pt", padding=True).to(DEVICE)
            label_to_index = {label: idx for idx, label in enumerate(labels)}

            random.seed(42)
            grouped = {}
            for item in dataset:
                grouped.setdefault(item["name"], []).append(item)

            public_items = []
            private_items = []
            for items in grouped.values():
                random.shuffle(items)
                split = int(len(items) * 0.3)
                if len(items) >= 2:
                    split = min(max(split, 1), len(items) - 1)
                public_items.extend(items[:split])
                private_items.extend(items[split:])

            def predict(image, coordinates):
                image = apply_mask(image, generate_mask(coordinates))
                inputs = processor(images=image, return_tensors="pt").to(DEVICE)
                outputs = model(pixel_values=inputs["pixel_values"], **text_inputs)
                return int(outputs.logits_per_image.argmax(dim=-1).item())

            def accuracy(items):
                correct = 0
                total = 0
                for item in items:
                    coordinates = masks.get(str(item["idx"]))
                    total += 1
                    if not coordinates or not valid_coordinates(coordinates):
                        continue
                    if predict(item["image"], coordinates) == label_to_index[item["name"]]:
                        correct += 1
                score = correct / total if total else 0.0
                return float(score if math.isfinite(score) and 0.0 <= score <= 1.0 else 0.0)

            public_score = accuracy(public_items)
            private_score = accuracy(private_items)
            return {
                "public_score": public_score,
                "private_score": private_score,
                "metrics": {
                    "metric": "masked_accuracy",
                    "public_accuracy": public_score,
                    "private_accuracy": private_score,
                },
            }
        """
    ).strip() + "\n"


TASKS = [
    {
        "key": "radar",
        "source_dir": Path("Individual-Contest/Radar"),
        "notebook": "Radar.ipynb",
        "slug": "ioai-2025-radar",
        "title": "IOAI 2025 - Radar",
        "metric": "weighted_accuracy",
        "higher_is_better": True,
        "time_limit_sec": 3600,
        "memory_limit_mb": 8192,
        "cpu_count": 4,
        "output_limit_mb": 256,
        "sample_submission": "sample_submission",
        "activate_on_import": True,
        "run_command": [
            "sh",
            "-lc",
            "cd /input && export DATA_PATH=/input && python /workspace/predict.py && cp output_validation.csv /output/output_validation.csv && cp output_testing.csv /output/output_testing.csv",
        ],
        "output_files": ["output_validation.csv", "output_testing.csv"],
        "scorer": radar_scorer,
        "translation_pack": "Individual-Contest-Day1",
    },
    {
        "key": "chicken-counting",
        "source_dir": Path("Individual-Contest/Chicken_Counting"),
        "notebook": "Chicken_Counting.ipynb",
        "slug": "ioai-2025-chicken-counting",
        "title": "IOAI 2025 - Chicken Counting",
        "metric": "density_similarity",
        "higher_is_better": True,
        "time_limit_sec": 3600,
        "memory_limit_mb": 12288,
        "cpu_count": 4,
        "output_limit_mb": 256,
        "sample_submission": "sample_submission.npz",
        "activate_on_import": True,
        "run_command": [
            "sh",
            "-lc",
            "cd /workspace && python predict.py && cp submission.npz /output/submission.npz",
        ],
        "output_files": ["submission.npz"],
        "scorer": chicken_scorer,
        "translation_pack": "Individual-Contest-Day1",
    },
    {
        "key": "concepts",
        "source_dir": Path("Individual-Contest/Concepts"),
        "notebook": "Concepts.ipynb",
        "slug": "ioai-2025-concepts",
        "title": "IOAI 2025 - Concepts",
        "metric": "guess_score",
        "higher_is_better": True,
        "time_limit_sec": 3600,
        "memory_limit_mb": 8192,
        "cpu_count": 4,
        "output_limit_mb": 128,
        "sample_submission": "sample_submission",
        "activate_on_import": False,
        "run_command": [
            "sh",
            "-lc",
            "mkdir -p /workspace/out && cd /workspace && export DATA_PATH=/input && python predict.py && cp out/clues_a.jsonl /output/clues_a.jsonl && cp out/clues_b.jsonl /output/clues_b.jsonl",
        ],
        "output_files": ["clues_a.jsonl", "clues_b.jsonl"],
        "scorer": concepts_scorer,
        "translation_pack": "Individual-Contest-Day1",
    },
    {
        "key": "restroom",
        "source_dir": Path("Individual-Contest/Restroom"),
        "notebook": "Restroom.ipynb",
        "slug": "ioai-2025-restroom",
        "title": "IOAI 2025 - Restroom Icon Matching",
        "metric": "precision_at_1",
        "higher_is_better": True,
        "time_limit_sec": 3600,
        "memory_limit_mb": 8192,
        "cpu_count": 4,
        "output_limit_mb": 128,
        "sample_submission": "sample_submission",
        "activate_on_import": True,
        "run_command": [
            "sh",
            "-lc",
            "cd /input && mkdir -p Scoring && python /workspace/predict.py && cp Scoring/submission_a.npy /output/submission_a.npy && cp Scoring/submission_b.npy /output/submission_b.npy",
        ],
        "output_files": ["submission_a.npy", "submission_b.npy"],
        "scorer": restroom_scorer,
        "translation_pack": "Individual-Contest-Day2",
    },
    {
        "key": "antique",
        "source_dir": Path("Individual-Contest/Antique"),
        "notebook": "Antique.ipynb",
        "slug": "ioai-2025-antique",
        "title": "IOAI 2025 - Antique Painting Authentication",
        "metric": "accuracy",
        "higher_is_better": True,
        "time_limit_sec": 1800,
        "memory_limit_mb": 4096,
        "cpu_count": 2,
        "output_limit_mb": 64,
        "sample_submission": "sample_submission.zip",
        "activate_on_import": True,
        "run_command": [
            "sh",
            "-lc",
            "cd /input && python /workspace/predict.py && cp submission.zip /output/submission.zip",
        ],
        "output_files": ["submission.zip"],
        "scorer": antique_scorer,
        "translation_pack": "Individual-Contest-Day2",
    },
    {
        "key": "pixel",
        "source_dir": Path("Individual-Contest/Pixel"),
        "notebook": "Pixel.ipynb",
        "slug": "ioai-2025-pixel",
        "title": "IOAI 2025 - Pixel Efficiency",
        "metric": "masked_accuracy",
        "higher_is_better": True,
        "time_limit_sec": 3600,
        "memory_limit_mb": 12288,
        "cpu_count": 4,
        "output_limit_mb": 128,
        "sample_submission": "sample_submission.jsonl",
        "activate_on_import": True,
        "run_command": [
            "sh",
            "-lc",
            "cd /workspace && python predict.py && cp submission.jsonl /output/submission.jsonl",
        ],
        "output_files": ["submission.jsonl"],
        "scorer": pixel_scorer,
        "statement_pdf": "IOAI Task 6 - Behind the Pixels.pdf",
        "translation_pack": "Individual-Contest-Day2",
    },
]


def build_radar(task_dir: Path, package_dir: Path) -> None:
    public_sample = package_dir / "public" / "sample_submission"
    public_sample.mkdir(parents=True, exist_ok=True)
    scoring_dir = task_dir / "Solution" / "Scoring"
    copy_file(scoring_dir / "ground_truth_val.csv", public_sample / "output_validation.csv")
    copy_file(scoring_dir / "ground_truth_test.csv", public_sample / "output_testing.csv")
    copy_tree(task_dir / "Solution" / "validation_set", package_dir / "private" / "input" / "validation_set")
    copy_tree(task_dir / "Solution" / "test_set", package_dir / "private" / "input" / "test_set")
    copy_file(scoring_dir / "ground_truth_val.csv", package_dir / "private" / "scoring" / "ground_truth_val.csv")
    copy_file(scoring_dir / "ground_truth_test.csv", package_dir / "private" / "scoring" / "ground_truth_test.csv")


def build_chicken(task_dir: Path, package_dir: Path) -> None:
    sample_path = package_dir / "public" / "sample_submission.npz"
    sample_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        sample_path,
        pred_a=np.zeros((100, 1, 180, 320), dtype=np.float32),
        pred_b=np.zeros((100, 1, 180, 320), dtype=np.float32),
    )
    ensure_placeholder(package_dir / "private" / "input", "Chicken Counting uses hidden Hugging Face test splits at runtime.")
    ensure_placeholder(package_dir / "private" / "scoring", "No local scoring assets are bundled; scorer downloads the official labels.")


def build_concepts(task_dir: Path, package_dir: Path) -> None:
    sample_dir = package_dir / "public" / "sample_submission"
    sample_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(sample_dir / "clues_a.jsonl", [[] for _ in range(50)])
    write_jsonl(sample_dir / "clues_b.jsonl", [[] for _ in range(100)])
    ensure_placeholder(package_dir / "private" / "input", "Concepts uses hidden Hugging Face test splits at runtime.")
    ensure_placeholder(
        package_dir / "private" / "scoring",
        "Concepts scoring requires a configured OPENROUTER_API_KEY or OPENAI_API_KEY on the server.",
    )


def build_restroom(task_dir: Path, package_dir: Path) -> None:
    sample_dir = package_dir / "public" / "sample_submission"
    sample_dir.mkdir(parents=True, exist_ok=True)
    scoring_dir = task_dir / "Solution" / "Scoring"
    copy_file(scoring_dir / "answer_a.npy", sample_dir / "submission_a.npy")
    copy_file(scoring_dir / "answer_b.npy", sample_dir / "submission_b.npy")
    copy_tree(task_dir / "Solution" / "validation_set", package_dir / "private" / "input" / "validation_set")
    copy_tree(task_dir / "Solution" / "test_set", package_dir / "private" / "input" / "test_set")
    (package_dir / "private" / "input" / "Scoring").mkdir(parents=True, exist_ok=True)
    copy_file(scoring_dir / "answer_a.npy", package_dir / "private" / "scoring" / "answer_a.npy")
    copy_file(scoring_dir / "answer_b.npy", package_dir / "private" / "scoring" / "answer_b.npy")


def build_antique(task_dir: Path, package_dir: Path) -> None:
    copy_file(task_dir / "Scoring" / "submission.zip", package_dir / "public" / "sample_submission.zip")
    copy_tree(task_dir / "Solution" / "validation_set", package_dir / "private" / "input" / "Solution" / "validation_set")
    copy_tree(task_dir / "Solution" / "test_set", package_dir / "private" / "input" / "Solution" / "test_set")
    copy_file(task_dir / "Scoring" / "label.csv", package_dir / "private" / "scoring" / "label.csv")


_pixel_ref_ids_cache: list[str] | None = None


def fetch_pixel_ref_ids() -> list[str]:
    global _pixel_ref_ids_cache
    if _pixel_ref_ids_cache is not None:
        return _pixel_ref_ids_cache
    rows: list[str] = []
    page_size = 100
    dataset = quote(PIXEL_REF_DATASET, safe="")
    offset = 0
    while True:
        url = (
            "https://datasets-server.huggingface.co/rows"
            f"?dataset={dataset}&config=default&split=ref&offset={offset}&length={page_size}"
        )
        try:
            with urlopen(url, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            if rows:
                break
            rows = [str(idx) for idx in range(64)]
            print(f"Warning: failed to fetch Pixel reference ids ({exc}); using placeholder ids 0-63 instead.")
            break
        batch = [str(item["row"]["idx"]) for item in payload.get("rows", [])]
        if not batch:
            break
        rows.extend(batch)
        total = int(payload.get("num_rows_total") or len(rows))
        offset += len(batch)
        if offset >= total:
            break
    if not rows:
        raise RuntimeError("Unable to fetch Pixel reference ids for sample submission generation.")
    _pixel_ref_ids_cache = rows
    return rows


def build_pixel(task_dir: Path, package_dir: Path) -> None:
    sample_rows = [{"idx": idx, "coordinates": [[0, 0], [14, 14]]} for idx in fetch_pixel_ref_ids()]
    write_jsonl(package_dir / "public" / "sample_submission.jsonl", sample_rows)
    ensure_placeholder(package_dir / "private" / "input", "Pixel uses hidden Hugging Face evaluation data at runtime.")
    ensure_placeholder(package_dir / "private" / "scoring", "No local scoring assets are bundled; scorer downloads the official model and dataset.")


BUILDERS = {
    "radar": build_radar,
    "chicken-counting": build_chicken,
    "concepts": build_concepts,
    "restroom": build_restroom,
    "antique": build_antique,
    "pixel": build_pixel,
}


def build_task(source_root: Path, output_root: Path, cfg: dict) -> Path:
    task_dir = source_root / cfg["source_dir"]
    package_dir = output_root / cfg["slug"]
    reset_dir(package_dir)

    statement_md = extract_statement_markdown(task_dir / cfg["notebook"])
    write_text(package_dir / "statement.md", statement_md)
    if cfg.get("statement_pdf"):
        copy_file(task_dir / cfg["statement_pdf"], package_dir / "statements" / "en.pdf")
    translation_labels = copy_translation_pdfs(source_root, package_dir, cfg)

    copy_figures(task_dir, package_dir / "public")
    BUILDERS[cfg["key"]](task_dir, package_dir)
    write_text(package_dir / "scorer.py", cfg["scorer"]())
    write_problem_yaml(
        package_dir / "problem.yaml",
        {
            **cfg,
            "runner_image": RUNNER_IMAGE,
            "statement_languages": {
                "en": "English",
                **(cfg.get("statement_languages") if isinstance(cfg.get("statement_languages"), dict) else {}),
                **translation_labels,
            },
        },
    )

    archive_path = output_root / f"{cfg['slug']}.zip"
    zip_directory(package_dir, archive_path)
    return archive_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate AIOJ-ready problem packages from the IOAI 2025 repository.")
    parser.add_argument("--source", type=Path, default=Path(r"E:\IOAI-2025"))
    parser.add_argument("--output", type=Path, default=Path(r"E:\IOAI-2025\aioj-packages"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    archives = []
    for cfg in TASKS:
        archives.append(build_task(args.source, args.output, cfg))
    print("Generated packages:")
    for archive in archives:
        print(f"- {archive}")


if __name__ == "__main__":
    main()
