import io
import mimetypes
import zipfile
from pathlib import Path
from typing import Any


def guess_content_type(filename: str, fallback: str = "application/octet-stream") -> str:
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or fallback


def zip_directory_bytes(root: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, arcname=path.relative_to(root).as_posix())
    return buffer.getvalue()


def zip_path_bytes(path: Path, *, arcname: str | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        if path.is_dir():
            base = path
            for child in sorted(path.rglob("*")):
                if child.is_file():
                    archive.write(child, arcname=child.relative_to(base).as_posix())
        else:
            archive.write(path, arcname=arcname or path.name)
    return buffer.getvalue()


def normalize_output_files(value: Any) -> list[str]:
    if value is None:
        return ["submission.csv"]
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, list):
        items = value
    else:
        raise ValueError("output_files must be a string or list of strings")

    normalized: list[str] = []
    for item in items:
        text = str(item or "").strip().replace("\\", "/")
        if not text:
            continue
        if text.startswith("/") or text.startswith("../") or "/../" in f"/{text}/":
            raise ValueError(f"Invalid output file path: {text}")
        normalized.append(text)

    if not normalized:
        raise ValueError("output_files cannot be empty")
    return normalized


def parse_statement_assets(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"default_language": "default", "markdowns": [], "pdfs": []}

    default_language = str(value.get("default_language") or "default")
    markdowns = value.get("markdowns")
    pdfs = value.get("pdfs")
    if not isinstance(markdowns, list):
        markdowns = []
    if not isinstance(pdfs, list):
        pdfs = []
    return {
        "default_language": default_language,
        "markdowns": [item for item in markdowns if isinstance(item, dict)],
        "pdfs": [item for item in pdfs if isinstance(item, dict)],
    }


def sanitize_statement_assets_for_api(assets: dict[str, Any], slug: str) -> dict[str, Any]:
    parsed = parse_statement_assets(assets)
    pdfs = []
    for item in parsed["pdfs"]:
        asset_id = str(item.get("id") or "").strip()
        if not asset_id:
            continue
        pdfs.append(
            {
                "id": asset_id,
                "language": str(item.get("language") or ""),
                "label": str(item.get("label") or item.get("filename") or asset_id),
                "filename": str(item.get("filename") or f"{asset_id}.pdf"),
                "download_url": f"/api/problems/{slug}/statement-pdfs/{asset_id}",
            }
        )

    markdowns = []
    for item in parsed["markdowns"]:
        content = str(item.get("content") or "")
        if not content.strip():
            continue
        markdowns.append(
            {
                "id": str(item.get("id") or "default"),
                "language": str(item.get("language") or ""),
                "label": str(item.get("label") or item.get("language") or "Default"),
                "filename": str(item.get("filename") or "statement.md"),
                "content": content,
            }
        )

    return {
        "default_language": parsed["default_language"],
        "markdowns": markdowns,
        "pdfs": pdfs,
    }


def has_artifact_mode(
    *,
    test_input_bundle_object_key: str | None = None,
    public_bundle_object_key: str | None,
    private_bundle_object_key: str | None,
    sample_bundle_object_key: str | None,
    output_files: list[str] | None,
) -> bool:
    files = output_files or ["submission.csv"]
    if test_input_bundle_object_key or public_bundle_object_key or private_bundle_object_key or sample_bundle_object_key:
        return True
    return files != ["submission.csv"]
