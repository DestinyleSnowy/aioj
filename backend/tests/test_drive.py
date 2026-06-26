import pytest
from fastapi import HTTPException

from app.routers.drive import (
    drive_quota_bytes,
    drive_parent_filter,
    ensure_name_available,
    ensure_drive_schema_ready,
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


def test_drive_parent_filter_avoids_untyped_null_parameters():
    assert drive_parent_filter(None) == "parent_id is null"
    assert drive_parent_filter(42) == "parent_id = :parent_id"


class _NoDuplicateResult:
    def first(self):
        return None


class _CaptureConn:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        return _NoDuplicateResult()


def test_ensure_name_available_generates_typed_parent_conditions():
    conn = _CaptureConn()

    ensure_name_available(conn, 1, None, "Root")
    root_sql, root_params = conn.calls[-1]
    assert "parent_id is null" in root_sql
    assert ":parent_id is null" not in root_sql
    assert ":exclude_id is null" not in root_sql
    assert root_params["parent_id"] is None

    ensure_name_available(conn, 1, 42, "Child", exclude_id=7)
    child_sql, child_params = conn.calls[-1]
    assert "parent_id = :parent_id" in child_sql
    assert "id <> :exclude_id" in child_sql
    assert child_params["parent_id"] == 42
    assert child_params["exclude_id"] == 7


def test_content_type_suffix_and_quota_helpers():
    assert normalize_content_type("report.pdf", "") == "application/pdf"
    assert normalize_content_type("data.bin", "application/octet-stream") == "application/octet-stream"
    assert object_suffix("photo.jpeg", "image/jpeg") == ".jpg"
    assert object_suffix("archive", "application/zip") == ".zip"
    assert drive_quota_bytes({"role": "USER"}) == settings.drive_user_quota_bytes
    assert drive_quota_bytes({"role": "ADMIN"}) == settings.drive_admin_quota_bytes


def test_ensure_drive_schema_ready_runs_once(monkeypatch):
    import app.routers.drive as drive

    calls: list[str] = []
    monkeypatch.setattr(drive, "_drive_schema_ready", False)
    monkeypatch.setattr(drive, "ensure_drive_schema_compatibility", lambda: calls.append("ok"))

    ensure_drive_schema_ready()
    ensure_drive_schema_ready()

    assert calls == ["ok"]
    assert drive._drive_schema_ready is True
