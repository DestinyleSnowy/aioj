import io
import re
import zipfile
from pathlib import Path

from fastapi import HTTPException

from app.settings import settings

try:
    import yaml
except Exception:
    yaml = None


def safe_slug(value: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}", value or ""):
        raise HTTPException(status_code=400, detail="Invalid slug")
    return value


def parse_yaml(data: bytes) -> dict:
    if yaml is None:
        raise HTTPException(status_code=500, detail="PyYAML is not installed")
    try:
        obj = yaml.safe_load(data.decode("utf-8")) or {}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid problem.yaml: {exc}")
    if not isinstance(obj, dict):
        raise HTTPException(status_code=400, detail="problem.yaml must be a mapping")
    return obj


def _validate_zip_members(
    archive: zipfile.ZipFile,
    *,
    max_files: int,
    max_uncompressed_bytes: int,
    dest: Path | None = None,
) -> None:
    file_count = 0
    total_uncompressed = 0
    dest_root = dest.resolve() if dest is not None else None

    for info in archive.infolist():
        if dest_root is not None:
            target = (dest_root / info.filename).resolve()
            if not str(target).startswith(str(dest_root)):
                raise HTTPException(status_code=400, detail=f"Unsafe zip path: {info.filename}")

        if info.is_dir():
            continue

        file_count += 1
        if file_count > max_files:
            raise HTTPException(status_code=400, detail=f"Zip contains too many files; limit is {max_files}")

        total_uncompressed += max(0, int(info.file_size))
        if total_uncompressed > max_uncompressed_bytes:
            limit_mb = max_uncompressed_bytes // (1024 * 1024)
            raise HTTPException(status_code=400, detail=f"Zip expands to more than {limit_mb} MB")


def inspect_zip_bytes(zip_bytes: bytes, *, max_files: int, max_uncompressed_bytes: int) -> None:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        _validate_zip_members(
            archive,
            max_files=max_files,
            max_uncompressed_bytes=max_uncompressed_bytes,
        )


def safe_extract_zip_bytes(zip_bytes: bytes, dest: Path, *, max_files: int, max_uncompressed_bytes: int) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        _validate_zip_members(
            archive,
            max_files=max_files,
            max_uncompressed_bytes=max_uncompressed_bytes,
            dest=dest,
        )
        archive.extractall(dest)


def validate_submission_archive(zip_bytes: bytes) -> None:
    if len(zip_bytes) > settings.max_source_zip_bytes:
        raise HTTPException(status_code=400, detail="source.zip too large")
    inspect_zip_bytes(
        zip_bytes,
        max_files=settings.max_source_files,
        max_uncompressed_bytes=settings.max_source_uncompressed_bytes,
    )


def validate_problem_archive(zip_bytes: bytes) -> None:
    if len(zip_bytes) > settings.max_problem_zip_bytes:
        raise HTTPException(status_code=400, detail="problem.zip too large")
    inspect_zip_bytes(
        zip_bytes,
        max_files=settings.max_problem_files,
        max_uncompressed_bytes=settings.max_problem_uncompressed_bytes,
    )
