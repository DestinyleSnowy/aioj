import pytest
from fastapi import HTTPException

from app.routers.messages import (
    build_group_payload,
    clamp_limit,
    edit_direct_message,
    extract_message_mentions,
    normalize_group_member_ids,
    normalize_group_name,
    normalize_group_nickname,
    normalize_message_body,
    normalize_message_cursor,
    normalize_edited_message_body,
    normalize_optional_message_body,
    report_message,
    require_group_owner,
    safe_attachment_filename,
    trim_message_page,
    update_message_conversation_preferences,
    validate_file_upload,
)


class _FakeResult:
    def __init__(self, row=None):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class _FakeConn:
    def __init__(self, row=None):
        self.row = row
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
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


def test_normalize_edited_message_body_allows_empty_attachment_caption():
    assert normalize_edited_message_body({"attachment_object_key": "messages/demo.bin"}, {"body_md": "   "}) == ""
    assert normalize_edited_message_body({"attachment_object_key": None}, {"body_md": "  updated  "}) == "updated"

    with pytest.raises(HTTPException) as empty:
        normalize_edited_message_body({"attachment_object_key": None}, {"body_md": "   "})
    assert empty.value.status_code == 400


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


def test_normalize_group_nickname_supports_reset_and_length_validation():
    assert normalize_group_nickname("  Alice  ") == "Alice"
    assert normalize_group_nickname("   ", allow_empty=True) is None

    with pytest.raises(HTTPException) as empty:
        normalize_group_nickname("   ")
    assert empty.value.status_code == 400

    with pytest.raises(HTTPException) as too_long:
        normalize_group_nickname("x" * 51)
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

    assert mentions == {"usernames": ["alice", "bob"], "nicknames": [], "all": True}


def test_extract_message_mentions_supports_braced_group_nicknames():
    mentions = extract_message_mentions("@{火箭队} hi @{Data Crew} @{火箭队}")

    assert mentions == {"usernames": [], "nicknames": ["火箭队", "Data Crew"], "all": False}


def test_build_group_payload_marks_owner_management_capability():
    payload = build_group_payload(
        {"id": 7, "name": "team", "member_role": "OWNER", "group_nickname": "Captain"},
        [{"id": 1}, {"id": 2}],
    )

    assert payload["can_manage"] is True
    assert payload["current_user_member_role"] == "OWNER"
    assert payload["current_user_group_nickname"] == "Captain"
    assert payload["member_count"] == 2


def test_require_group_owner_rejects_regular_member():
    with pytest.raises(HTTPException) as forbidden:
        require_group_owner({"member_role": "MEMBER"})

    assert forbidden.value.status_code == 403


def test_update_message_conversation_preferences_rejects_self_direct_conversation(monkeypatch):
    with pytest.raises(HTTPException) as excinfo:
        update_message_conversation_preferences("direct", 7, {"is_pinned": True}, user={"id": 7})

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Cannot update self conversation preferences"


def test_edit_direct_message_allows_empty_attachment_caption(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_direct_message_for_user",
        lambda *_args, **_kwargs: {
            "sender_id": 9,
            "deleted_at": None,
            "attachment_object_key": "messages/demo.bin",
        },
    )

    result = edit_direct_message(15, {"body_md": "   "}, user={"id": 9})

    assert result == {"ok": True, "message_id": 15}
    assert len(conn.calls) == 1
    _, params = conn.calls[0]
    assert params == {"message_id": 15, "body_md": ""}


def test_report_message_rejects_reporting_own_direct_message(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_direct_message_for_user",
        lambda *_args, **_kwargs: {"sender_id": 5},
    )

    with pytest.raises(HTTPException) as excinfo:
        report_message(
            {"conversation_type": "direct", "message_id": 12, "reason": "spam"},
            user={"id": 5},
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Cannot report your own message"
    assert conn.calls == []


def test_report_message_rejects_reporting_own_group_message(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_group_message_for_user",
        lambda *_args, **_kwargs: {"sender_id": 6},
    )

    with pytest.raises(HTTPException) as excinfo:
        report_message(
            {"conversation_type": "group", "message_id": 21, "reason": "abuse"},
            user={"id": 6},
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Cannot report your own message"
    assert conn.calls == []
