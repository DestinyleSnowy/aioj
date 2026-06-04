from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.routers import problems


class DummyConnect:
    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc, tb):
        return False


def _request(method: str) -> Request:
    return Request({"type": "http", "method": method, "headers": []})


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
        "get_bytes",
        lambda *args, **kwargs: pytest.fail("HEAD should not read PDF bytes"),
    )

    response = problems.get_problem_statement_pdf("demo-problem", "zh-cn", _request("HEAD"))

    assert response.status_code == 200
    assert response.media_type == "application/pdf"
    assert response.headers["content-disposition"] == 'inline; filename="statement.pdf"'


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
    monkeypatch.setattr(problems, "get_bytes", lambda *args, **kwargs: b"%PDF-demo")

    response = problems.get_problem_statement_pdf("demo-problem", "zh-cn", _request("GET"))

    assert response.status_code == 200
    assert response.media_type == "application/pdf"
    assert response.body == b"%PDF-demo"
