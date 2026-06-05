import io
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.routers import problems


class DummyConnect:
    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc, tb):
        return False


def _request(method: str, headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    return Request({"type": "http", "method": method, "headers": headers or []})


def test_statement_pdf_head_returns_headers_without_reading_bytes(monkeypatch):
    monkeypatch.setattr(problems, "engine", SimpleNamespace(connect=lambda: DummyConnect()))
    monkeypatch.setattr(
        problems,
        "latest_problem_version",
        lambda conn, slug, public_only=True: {
            "statement_assets_json": {
                "default_language": "en",
                "markdowns": [],
                "pdfs": [
                    {
                        "id": "zh-cn",
                        "object_key": "problems/demo/v1/statements/zh-cn/statement.pdf",
                        "filename": "statement.pdf",
                    }
                ],
            }
        },
    )
    monkeypatch.setattr(
        problems,
        "head_object",
        lambda *args, **kwargs: {"ContentLength": 1234},
    )
    monkeypatch.setattr(
        problems,
        "get_bytes",
        lambda *args, **kwargs: pytest.fail("HEAD should not read PDF bytes"),
    )

    response = problems.get_problem_statement_pdf("demo-problem", "zh-cn", _request("HEAD"))

    assert response.status_code == 200
    assert response.media_type == "application/pdf"
    assert response.headers["content-length"] == "1234"
    assert response.headers["content-disposition"] == 'inline; filename="statement.pdf"'
    assert response.headers["accept-ranges"] == "bytes"


def test_statement_pdf_get_still_returns_pdf_bytes(monkeypatch):
    monkeypatch.setattr(problems, "engine", SimpleNamespace(connect=lambda: DummyConnect()))
    monkeypatch.setattr(
        problems,
        "latest_problem_version",
        lambda conn, slug, public_only=True: {
            "statement_assets_json": {
                "default_language": "en",
                "markdowns": [],
                "pdfs": [
                    {
                        "id": "zh-cn",
                        "object_key": "problems/demo/v1/statements/zh-cn/statement.pdf",
                        "filename": "statement.pdf",
                    }
                ],
            }
        },
    )
    monkeypatch.setattr(
        problems,
        "head_object",
        lambda *args, **kwargs: {"ContentLength": 9},
    )
    monkeypatch.setattr(problems, "get_bytes", lambda *args, **kwargs: b"%PDF-demo")

    response = problems.get_problem_statement_pdf("demo-problem", "zh-cn", _request("GET"))

    assert response.status_code == 200
    assert response.media_type == "application/pdf"
    assert response.body == b"%PDF-demo"
    assert response.headers["content-length"] == "9"


def test_statement_pdf_range_request_returns_partial_content(monkeypatch):
    monkeypatch.setattr(problems, "engine", SimpleNamespace(connect=lambda: DummyConnect()))
    monkeypatch.setattr(
        problems,
        "latest_problem_version",
        lambda conn, slug, public_only=True: {
            "statement_assets_json": {
                "default_language": "en",
                "markdowns": [],
                "pdfs": [
                    {
                        "id": "zh-cn",
                        "object_key": "problems/demo/v1/statements/zh-cn/statement.pdf",
                        "filename": "statement.pdf",
                    }
                ],
            }
        },
    )
    monkeypatch.setattr(
        problems,
        "head_object",
        lambda *args, **kwargs: {"ContentLength": 10},
    )
    monkeypatch.setattr(
        problems,
        "get_object",
        lambda *args, **kwargs: {
            "Body": io.BytesIO(b"%PDF"),
            "ContentLength": 4,
            "ContentRange": "bytes 0-3/10",
        },
    )
    monkeypatch.setattr(
        problems,
        "get_bytes",
        lambda *args, **kwargs: pytest.fail("Range requests should not read the full PDF"),
    )

    response = problems.get_problem_statement_pdf(
        "demo-problem",
        "zh-cn",
        _request("GET", headers=[(b"range", b"bytes=0-3")]),
    )

    assert response.status_code == 206
    assert response.media_type == "application/pdf"
    assert response.body == b"%PDF"
    assert response.headers["content-length"] == "4"
    assert response.headers["content-range"] == "bytes 0-3/10"
    assert response.headers["accept-ranges"] == "bytes"
