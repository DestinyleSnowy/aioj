from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path


class DocumentConversionError(RuntimeError):
    pass


def _libreoffice_binary() -> str:
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        raise DocumentConversionError("LibreOffice is not installed on this server")
    return binary


def _safe_docx_name(filename: str) -> str:
    name = Path(filename or "statement.docx").name
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", Path(name).stem).strip("._-") or "statement"
    return f"{stem}.docx"


def convert_docx_file_to_pdf(docx_path: Path, output_dir: Path, *, timeout_sec: int = 180) -> Path:
    binary = _libreoffice_binary()
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="aioj_lo_profile_") as profile_td:
        cmd = [
            binary,
            f"-env:UserInstallation={Path(profile_td).resolve().as_uri()}",
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(docx_path),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
        except subprocess.TimeoutExpired as exc:
            raise DocumentConversionError(f"DOCX conversion timed out after {timeout_sec} seconds") from exc
        except Exception as exc:
            raise DocumentConversionError(f"DOCX conversion failed: {exc}") from exc

    candidates = sorted(output_dir.glob("*.pdf"), key=lambda path: path.stat().st_mtime, reverse=True)
    expected = output_dir / f"{docx_path.stem}.pdf"
    generated = expected if expected.exists() else (candidates[0] if candidates else None)
    if result.returncode != 0 or not generated:
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        message = detail[-1] if detail else "LibreOffice did not produce a PDF"
        raise DocumentConversionError(message)
    return generated


def convert_docx_bytes_to_pdf(docx_bytes: bytes, filename: str, *, timeout_sec: int = 180) -> tuple[str, bytes]:
    with tempfile.TemporaryDirectory(prefix="aioj_docx_") as td:
        root = Path(td)
        docx_path = root / _safe_docx_name(filename)
        output_dir = root / "pdf"
        docx_path.write_bytes(docx_bytes)
        pdf_path = convert_docx_file_to_pdf(docx_path, output_dir, timeout_sec=timeout_sec)
        return f"{Path(filename or docx_path.name).stem}.pdf", pdf_path.read_bytes()
