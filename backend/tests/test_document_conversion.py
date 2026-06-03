import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.routers import problems
from app.services import document_conversion


def test_convert_docx_file_to_pdf_uses_libreoffice(monkeypatch, tmp_path):
    docx_path = tmp_path / "statement.docx"
    docx_path.write_bytes(b"docx")

    monkeypatch.setattr(document_conversion.shutil, "which", lambda name: "soffice" if name == "soffice" else None)

    def fake_run(cmd, capture_output, text, timeout):
        out_dir = Path(cmd[cmd.index("--outdir") + 1])
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "statement.pdf").write_bytes(b"%PDF")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(document_conversion.subprocess, "run", fake_run)

    pdf_path = document_conversion.convert_docx_file_to_pdf(docx_path, tmp_path / "out")

    assert pdf_path.name == "statement.pdf"
    assert pdf_path.read_bytes() == b"%PDF"


def test_convert_docx_file_to_pdf_requires_libreoffice(monkeypatch, tmp_path):
    docx_path = tmp_path / "statement.docx"
    docx_path.write_bytes(b"docx")
    monkeypatch.setattr(document_conversion.shutil, "which", lambda name: None)

    with pytest.raises(document_conversion.DocumentConversionError, match="LibreOffice"):
        document_conversion.convert_docx_file_to_pdf(docx_path, tmp_path / "out")


def test_statement_pdf_upload_payload_keeps_pdf():
    filename, content = problems._statement_pdf_upload_payload("statement.pdf", b"%PDF")

    assert filename == "statement.pdf"
    assert content == b"%PDF"


def test_statement_pdf_upload_payload_converts_docx(monkeypatch):
    monkeypatch.setattr(
        problems,
        "convert_docx_bytes_to_pdf",
        lambda content, filename: ("statement.pdf", b"%PDF"),
    )

    filename, content = problems._statement_pdf_upload_payload("statement.docx", b"docx")

    assert filename == "statement.pdf"
    assert content == b"%PDF"


def test_statement_pdf_upload_payload_rejects_other_files():
    with pytest.raises(HTTPException) as exc_info:
        problems._statement_pdf_upload_payload("statement.txt", b"text")

    assert exc_info.value.status_code == 400
