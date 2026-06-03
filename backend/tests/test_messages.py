import pytest
from fastapi import HTTPException

from app.routers.messages import (
    clamp_limit,
    normalize_message_body,
    normalize_message_cursor,
    normalize_optional_message_body,
    safe_attachment_filename,
    validate_file_upload,
)


def test_normalize_message_body_trims_and_limits_length():
    assert normalize_message_body("  hello  ") == "hello"

    with pytest.raises(HTTPException) as empty:
        normalize_message_body("   ")
    assert empty.value.status_code == 400

    with pytest.raises(HTTPException) as too_long:
        normalize_message_body("x" * 4001)
    assert too_long.value.status_code == 400


def test_clamp_limit_handles_invalid_and_bounds():
    assert clamp_limit("bad", default=20, max_value=50) == 20
    assert clamp_limit(0, default=20, max_value=50) == 20
    assert clamp_limit(500, default=20, max_value=50) == 50
    assert clamp_limit(12, default=20, max_value=50) == 12


def test_normalize_message_cursor_allows_positive_ids_only():
    assert normalize_message_cursor(None) is None
    assert normalize_message_cursor("") is None
    assert normalize_message_cursor("42") == 42

    with pytest.raises(HTTPException) as invalid:
        normalize_message_cursor(0)
    assert invalid.value.status_code == 400

    with pytest.raises(HTTPException) as malformed:
        normalize_message_cursor("bad")
    assert malformed.value.status_code == 400


def test_optional_message_body_allows_empty_caption_but_limits_length():
    assert normalize_optional_message_body("   ") == ""
    assert normalize_optional_message_body("  caption  ") == "caption"

    with pytest.raises(HTTPException) as too_long:
        normalize_optional_message_body("x" * 4001)
    assert too_long.value.status_code == 400


def test_validate_file_upload_accepts_images_and_regular_files():
    assert validate_file_upload("demo.jpeg", "image/jpeg", b"data") == ("image/jpeg", ".jpg")
    assert validate_file_upload("report.pdf", "application/pdf", b"data") == ("application/pdf", ".pdf")
    assert validate_file_upload("archive", "", b"data") == ("application/octet-stream", ".bin")

    with pytest.raises(HTTPException) as empty:
        validate_file_upload("demo.png", "image/png", b"")
    assert empty.value.status_code == 400


def test_safe_attachment_filename_removes_header_unsafe_characters():
    assert safe_attachment_filename('../bad"name.png', ".png") == "badname.png"
    assert safe_attachment_filename("", ".webp") == "file.webp"
