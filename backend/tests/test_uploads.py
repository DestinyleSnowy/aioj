import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.uploads import convert_notebook_to_python, inspect_zip_bytes, safe_extract_zip_bytes, validate_submission_archive


def build_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return buf.getvalue()


def test_validate_submission_archive_accepts_small_zip():
    validate_submission_archive(build_zip({"predict.py": b"print('ok')"}))


def test_inspect_zip_bytes_rejects_too_many_files():
    zip_bytes = build_zip({f"file-{idx}.txt": b"x" for idx in range(3)})

    with pytest.raises(HTTPException) as excinfo:
        inspect_zip_bytes(zip_bytes, max_files=2, max_uncompressed_bytes=1024)

    assert "too many files" in excinfo.value.detail


def test_safe_extract_zip_bytes_rejects_path_traversal(tmp_path: Path):
    zip_bytes = build_zip({"../escape.txt": b"boom"})

    with pytest.raises(HTTPException) as excinfo:
        safe_extract_zip_bytes(zip_bytes, tmp_path, max_files=10, max_uncompressed_bytes=1024)

    assert "Unsafe zip path" in excinfo.value.detail


def test_safe_extract_zip_bytes_rejects_sibling_prefix_escape(tmp_path: Path):
    dest = tmp_path / "root"
    zip_bytes = build_zip({"../root_evil/escape.txt": b"boom"})

    with pytest.raises(HTTPException) as excinfo:
        safe_extract_zip_bytes(zip_bytes, dest, max_files=10, max_uncompressed_bytes=1024)

    assert "Unsafe zip path" in excinfo.value.detail


def test_convert_notebook_to_python_extracts_code_and_comments_magics():
    nb = {
        "cells": [
            {"cell_type": "markdown", "source": ["# heading\n"]},
            {"cell_type": "code", "source": ["%matplotlib inline\n", "print('ok')\n", "!pwd\n"]},
        ]
    }

    script = convert_notebook_to_python(json.dumps(nb).encode("utf-8"))

    assert "print('ok')" in script
    assert "# %matplotlib inline" in script
    assert "# !pwd" in script
    assert "# heading" not in script


def test_convert_notebook_to_python_rejects_non_list_cells():
    with pytest.raises(HTTPException) as excinfo:
        convert_notebook_to_python(b'{"cells":"oops"}')

    assert excinfo.value.status_code == 400
    assert "'cells' must be a list" in excinfo.value.detail


def test_convert_notebook_to_python_rejects_non_object_cell():
    with pytest.raises(HTTPException) as excinfo:
        convert_notebook_to_python(b'{"cells":["oops"]}')

    assert excinfo.value.status_code == 400
    assert "each cell must be an object" in excinfo.value.detail
