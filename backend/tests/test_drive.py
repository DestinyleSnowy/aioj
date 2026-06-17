import pytest
from fastapi import HTTPException

from app.routers.drive import (
    drive_quota_bytes,
    normalize_content_type,
    normalize_drive_name,
    normalize_optional_drive_id,
    object_suffix,
)
from app.settings import settings


def test_normalize_drive_name_strips_paths_and_rejects_invalid_names():
    assert normalize_drive_name("folder/report.pdf") == "report.pdf"
    assert normalize_drive_name(r"folder\report.pdf") == "report.pdf"
    assert normalize_drive_name("  数据集.zip  ") == "数据集.zip"
    assert normalize_drive_name("", fallback="Untitled") == "Untitled"

    with pytest.raises(HTTPException) as dotdot:
        normalize_drive_name("..")
    assert dotdot.value.status_code == 400

    with pytest.raises(HTTPException) as too_long:
        normalize_drive_name("x" * 181)
    assert too_long.value.status_code == 400


def test_normalize_optional_drive_id_accepts_empty_and_positive_ids_only():
    assert normalize_optional_drive_id(None) is None
    assert normalize_optional_drive_id("") is None
    assert normalize_optional_drive_id("null") is None
    assert normalize_optional_drive_id("42") == 42

    with pytest.raises(HTTPException):
        normalize_optional_drive_id("bad")

    with pytest.raises(HTTPException):
        normalize_optional_drive_id(0)


def test_content_type_suffix_and_quota_helpers():
    assert normalize_content_type("report.pdf", "") == "application/pdf"
    assert normalize_content_type("data.bin", "application/octet-stream") == "application/octet-stream"
    assert object_suffix("photo.jpeg", "image/jpeg") == ".jpg"
    assert object_suffix("archive", "application/zip") == ".zip"
    assert drive_quota_bytes({"role": "USER"}) == settings.drive_user_quota_bytes
    assert drive_quota_bytes({"role": "ADMIN"}) == settings.drive_admin_quota_bytes
