import pytest
from fastapi import HTTPException

from app.routers.messages import (
    build_group_payload,
    clamp_limit,
    extract_message_mentions,
    normalize_group_member_ids,
    normalize_group_name,
    normalize_message_body,
    normalize_message_cursor,
    normalize_optional_message_body,
    require_group_owner,
    safe_attachment_filename,
    trim_message_page,
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


def test_trim_message_page_keeps_newest_rows_when_extra_cursor_row_exists():
    rows = [{"id": id_} for id_ in range(1, 22)]

    page = trim_message_page(rows, 20)

    assert [row["id"] for row in page] == list(range(2, 22))


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


def test_normalize_group_name_trims_and_limits_length():
    assert normalize_group_name("  team chat  ") == "team chat"

    with pytest.raises(HTTPException) as empty:
        normalize_group_name("   ")
    assert empty.value.status_code == 400

    with pytest.raises(HTTPException) as too_long:
        normalize_group_name("x" * 81)
    assert too_long.value.status_code == 400


def test_normalize_group_member_ids_dedupes_and_skips_current_user():
    assert normalize_group_member_ids([1, "2", 2, 3], current_user_id=1) == [2, 3]
    assert normalize_group_member_ids("2,3,2", current_user_id=1) == [2, 3]

    with pytest.raises(HTTPException) as invalid:
        normalize_group_member_ids(["bad"])
    assert invalid.value.status_code == 400

    with pytest.raises(HTTPException) as too_many:
        normalize_group_member_ids(list(range(1, 51)))
    assert too_many.value.status_code == 400


def test_extract_message_mentions_dedupes_usernames_and_all():
    mentions = extract_message_mentions("@alice hello @bob, @alice and @all")

    assert mentions == ["alice", "bob", "all"]


def test_build_group_payload_marks_owner_management_capability():
    payload = build_group_payload({"id": 7, "name": "team", "member_role": "OWNER"}, [{"id": 1}, {"id": 2}])

    assert payload["can_manage"] is True
    assert payload["current_user_member_role"] == "OWNER"
    assert payload["member_count"] == 2


def test_require_group_owner_rejects_regular_member():
    with pytest.raises(HTTPException) as forbidden:
        require_group_owner({"member_role": "MEMBER"})

    assert forbidden.value.status_code == 403
