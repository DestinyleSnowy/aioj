import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.routers import auth as auth_router


class _FakeResult:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class _FakeConn:
    def __init__(self, *, row=None, error=None):
        self.row = row
        self.error = error
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        if self.error:
            raise self.error
        return _FakeResult(self.row)


class _FakeBegin:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeEngine:
    def __init__(self, conn):
        self.conn = conn

    def begin(self):
        return _FakeBegin(self.conn)


def _fake_request(host: str = "127.0.0.1"):
    return SimpleNamespace(client=SimpleNamespace(host=host))


def test_register_requires_email(monkeypatch):
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *args, **kwargs: None)

    with pytest.raises(HTTPException) as excinfo:
        auth_router.register(
            {"username": "user123", "password": "hunter2", "email": ""},
            _fake_request(),
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Email is required"


def test_register_creates_user_with_required_email(monkeypatch):
    conn = _FakeConn(
        row={
            "id": 42,
            "username": "user123",
            "email": "user123@example.com",
            "role": "USER",
            "signature": "",
            "created_at": "2026-06-05T00:00:00Z",
            "avatar_object_key": None,
            "avatar_updated_at": None,
        }
    )

    monkeypatch.setattr(auth_router, "engine", _FakeEngine(conn))
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_router, "get_setting_bool", lambda *args, **kwargs: True)
    monkeypatch.setattr(auth_router, "hash_password", lambda password: f"hashed:{password}")
    monkeypatch.setattr(auth_router, "make_token", lambda user_id, username, role: f"token:{user_id}:{username}:{role}")

    result = auth_router.register(
        {"username": "user123", "password": "hunter2", "email": "user123@example.com"},
        _fake_request("8.8.8.8"),
    )

    assert result["token"] == "token:42:user123:USER"
    assert result["user"]["email"] == "user123@example.com"
    assert len(conn.calls) == 1
    _, params = conn.calls[0]
    assert params == {
        "username": "user123",
        "email": "user123@example.com",
        "password_hash": "hashed:hunter2",
    }


def test_register_reports_duplicate_email(monkeypatch):
    error = IntegrityError(
        "insert into users",
        {"email": "dup@example.com"},
        Exception('duplicate key value violates unique constraint "users_email_key"'),
    )

    monkeypatch.setattr(auth_router, "engine", _FakeEngine(_FakeConn(error=error)))
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_router, "get_setting_bool", lambda *args, **kwargs: True)

    with pytest.raises(HTTPException) as excinfo:
        auth_router.register(
            {"username": "user123", "password": "hunter2", "email": "dup@example.com"},
            _fake_request(),
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Email already exists"


def test_register_logs_unexpected_database_failure(monkeypatch, caplog):
    monkeypatch.setattr(auth_router, "engine", _FakeEngine(_FakeConn(error=RuntimeError("db offline"))))
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_router, "get_setting_bool", lambda *args, **kwargs: True)

    with caplog.at_level(logging.ERROR):
        with pytest.raises(HTTPException) as excinfo:
            auth_router.register(
                {"username": "user123", "password": "hunter2", "email": "user123@example.com"},
                _fake_request(),
            )

    assert excinfo.value.status_code == 500
    assert excinfo.value.detail == "Registration failed, please retry later"
    assert "Registration failed for username=user123 email=user123@example.com host=127.0.0.1" in caplog.text
