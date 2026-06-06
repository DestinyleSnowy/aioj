from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.routers.messages import (
    admin_update_message_report,
    build_group_payload,
    clamp_limit,
    delete_direct_message,
    edit_direct_message,
    edit_group_message,
    extract_message_mentions,
    get_group_message_conversation,
    get_message_conversation,
    hydrate_message_rows,
    list_message_conversations,
    mark_group_messages_read,
    normalize_dm_policy,
    normalize_group_member_ids,
    normalize_group_member_role,
    normalize_group_name,
    normalize_group_nickname,
    normalize_message_body,
    normalize_message_cursor,
    normalize_edited_message_body,
    normalize_optional_message_body,
    normalize_optional_time,
    recall_direct_message,
    report_message,
    require_direct_message_allowed,
    require_message_mutation_window,
    require_group_owner,
    safe_attachment_filename,
    scan_message_attachment,
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

    def all(self):
        return self.row or []

    def scalar(self):
        return self.row

    def scalar_one(self):
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

    def connect(self):
        return _FakeBegin(self.conn)


class _SequenceConn:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        response = self.responses.pop(0) if self.responses else None
        return _FakeResult(response)


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
    assert validate_file_upload("demo.jpeg", "image/jpeg", b"\xff\xd8\xffdemo") == ("image/jpeg", ".jpg")
    assert validate_file_upload("report.pdf", "application/pdf", b"data") == ("application/pdf", ".pdf")
    assert validate_file_upload("archive", "", b"data") == ("application/octet-stream", ".bin")

    with pytest.raises(HTTPException) as empty:
        validate_file_upload("demo.png", "image/png", b"")
    assert empty.value.status_code == 400


def test_validate_file_upload_rejects_mismatched_images_and_dangerous_files():
    with pytest.raises(HTTPException) as mismatched:
        validate_file_upload("demo.png", "image/png", b"not a png")
    assert mismatched.value.status_code == 400

    with pytest.raises(HTTPException) as dangerous:
        validate_file_upload("run.ps1", "text/plain", b"Write-Host bad")
    assert dangerous.value.status_code == 400

    assert scan_message_attachment(b"MZ executable", "application/octet-stream") == "SUSPICIOUS"
    assert scan_message_attachment(b"plain text", "text/plain") == "CLEAN"


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


def test_new_message_normalizers_accept_expected_values():
    assert normalize_dm_policy(" nobody ") == "NOBODY"
    assert normalize_dm_policy(None) == "EVERYONE"
    assert normalize_group_member_role(" admin ") == "ADMIN"
    assert normalize_optional_time("09:30").hour == 9
    assert normalize_optional_time("") is None

    with pytest.raises(HTTPException):
        normalize_dm_policy("friends")
    with pytest.raises(HTTPException):
        normalize_group_member_role("owner")
    with pytest.raises(HTTPException):
        normalize_optional_time("25:00")


def test_require_direct_message_allowed_respects_recipient_privacy(monkeypatch):
    monkeypatch.setattr(
        "app.routers.messages.get_user_block_state",
        lambda *_args, **_kwargs: {"is_blocked_by_me": False, "has_blocked_me": False},
    )
    monkeypatch.setattr(
        "app.routers.messages.get_user_message_preferences",
        lambda *_args, **_kwargs: {"dm_policy": "NOBODY"},
    )

    with pytest.raises(HTTPException) as forbidden:
        require_direct_message_allowed(object(), current_user_id=1, other_user_id=2)

    assert forbidden.value.status_code == 403
    assert forbidden.value.detail == "This user is not accepting direct messages"


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
            "created_at": datetime.now(timezone.utc),
        },
    )

    result = edit_direct_message(15, {"body_md": "   "}, user={"id": 9})

    assert result == {"ok": True, "message_id": 15}
    assert len(conn.calls) == 1
    _, params = conn.calls[0]
    assert params == {"message_id": 15, "body_md": ""}


def test_edit_direct_message_restores_recalled_message(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_direct_message_for_user",
        lambda *_args, **_kwargs: {
            "sender_id": 9,
            "deleted_at": datetime.now(timezone.utc),
            "attachment_object_key": None,
            "created_at": datetime.now(timezone.utc),
        },
    )

    result = edit_direct_message(15, {"body_md": "  revised  "}, user={"id": 9})

    assert result == {"ok": True, "message_id": 15}
    assert len(conn.calls) == 1
    statement, params = conn.calls[0]
    assert "deleted_at = null" in statement
    assert "deleted_by_user_id = null" in statement
    assert params == {"message_id": 15, "body_md": "revised"}


def test_edit_group_message_restores_recalled_message(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_group_message_for_user",
        lambda *_args, **_kwargs: {
            "sender_id": 9,
            "deleted_at": datetime.now(timezone.utc),
            "attachment_object_key": None,
            "created_at": datetime.now(timezone.utc),
        },
    )

    result = edit_group_message(21, {"body_md": "  group revised  "}, user={"id": 9})

    assert result == {"ok": True, "message_id": 21}
    assert len(conn.calls) == 1
    statement, params = conn.calls[0]
    assert "deleted_at = null" in statement
    assert "deleted_by_user_id = null" in statement
    assert params == {"message_id": 21, "body_md": "group revised"}


def test_require_message_mutation_window_rejects_expired_message():
    with pytest.raises(HTTPException) as excinfo:
        require_message_mutation_window(
            {"created_at": datetime.now(timezone.utc) - timedelta(minutes=3)},
            action="edited",
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "Messages can only be edited within 2 minutes"


def test_recall_direct_message_marks_message_recalled(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_direct_message_for_user",
        lambda *_args, **_kwargs: {
            "sender_id": 9,
            "deleted_at": None,
            "created_at": datetime.now(timezone.utc),
        },
    )

    result = recall_direct_message(15, user={"id": 9})

    assert result == {"ok": True, "message_id": 15, "recalled": True}
    assert len(conn.calls) == 1
    _, params = conn.calls[0]
    assert params == {"message_id": 15, "user_id": 9}


def test_delete_direct_message_hides_message_for_current_user(monkeypatch):
    conn = _FakeConn()

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_direct_message_for_user",
        lambda *_args, **_kwargs: {"sender_id": 7},
    )

    result = delete_direct_message(15, user={"id": 9})

    assert result == {"ok": True, "message_id": 15, "deleted_for_me": True}
    assert len(conn.calls) == 1
    _, params = conn.calls[0]
    assert params == {"user_id": 9, "message_id": 15}


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


def test_list_message_conversations_aligns_direct_and_group_union_columns(monkeypatch):
    conn = _FakeConn(row=[])
    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))

    result = list_message_conversations(user={"id": 3})

    assert result == {"items": [], "has_more": False, "next_offset": 0}
    assert len(conn.calls) == 1
    statement, params = conn.calls[0]
    assert "null::text as last_sender_group_nickname" in statement
    assert "null::text as peer_avatar_object_key" in statement
    assert "null::timestamptz as peer_avatar_updated_at" in statement
    assert params == {"user_id": 3, "limit": 51, "offset": 0}


def test_get_message_conversation_reports_first_unread_message_id(monkeypatch):
    now = datetime.now(timezone.utc)
    conn = _SequenceConn(
        [
            {
                "id": 8,
                "username": "peer",
                "role": "USER",
                "avatar_object_key": None,
                "avatar_updated_at": None,
                "is_disabled": False,
            },
            [
                {
                    "id": 11,
                    "sender_id": 8,
                    "sender_username": "peer",
                    "sender_avatar_object_key": None,
                    "sender_avatar_updated_at": None,
                    "recipient_id": 3,
                    "recipient_username": "me",
                    "recipient_avatar_object_key": None,
                    "recipient_avatar_updated_at": None,
                    "body_md": "hello",
                    "reply_to_message_id": None,
                    "has_attachment": False,
                    "attachment_id": None,
                    "attachment_content_type": None,
                    "attachment_filename": None,
                    "attachment_size_bytes": None,
                    "is_read": False,
                    "created_at": now,
                    "read_at": None,
                    "edited_at": None,
                    "deleted_at": None,
                    "deleted_by_user_id": None,
                    "reply_to_body_md": None,
                    "reply_to_has_attachment": False,
                    "reply_to_attachment_content_type": None,
                    "reply_to_attachment_filename": None,
                    "reply_to_deleted_at": None,
                    "reply_to_sender_username": None,
                }
            ],
            None,
        ]
    )

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_user_block_state",
        lambda *_args, **_kwargs: {"is_blocked_by_me": False, "has_blocked_me": False},
    )
    monkeypatch.setattr(
        "app.routers.messages.get_user_message_preferences",
        lambda *_args, **_kwargs: {"dm_policy": "EVERYONE"},
    )
    monkeypatch.setattr(
        "app.routers.messages.get_conversation_preferences",
        lambda *_args, **_kwargs: {},
    )

    result = get_message_conversation(8, user={"id": 3})

    assert result["first_unread_message_id"] == 11
    assert len(conn.calls) >= 3
    assert "update direct_messages" in conn.calls[2][0].lower()


def test_get_group_message_conversation_before_cursor_expands_hidden_filter_sql(monkeypatch):
    now = datetime.now(timezone.utc)
    conn = _SequenceConn(
        [
            0,
            {"created_at": now},
            [],
        ]
    )

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr(
        "app.routers.messages.get_group_membership",
        lambda *_args, **_kwargs: {
            "id": 5,
            "name": "team",
            "owner_id": 3,
            "created_at": now,
            "updated_at": now,
            "member_role": "OWNER",
            "group_nickname": "Captain",
            "joined_at": now - timedelta(days=1),
            "member_count": 2,
        },
    )
    monkeypatch.setattr("app.routers.messages.get_conversation_preferences", lambda *_args, **_kwargs: {})
    monkeypatch.setattr("app.routers.messages.list_group_members", lambda *_args, **_kwargs: [])

    result = get_group_message_conversation(5, before_id=21, user={"id": 3})

    assert result["first_unread_message_id"] is None
    assert len(conn.calls) == 3
    anchor_statement = conn.calls[1][0]
    assert "{message_hidden_filter_sql" not in anchor_statement
    assert "message_hidden_entries" in anchor_statement


def test_hydrate_message_rows_adds_reactions_favorites_and_group_reads():
    conn = _SequenceConn(
        [
            [{"message_id": 1, "emoji": "👍", "count": 2, "reacted_by_me": True}],
            [{"message_id": 2, "emoji": "✅", "count": 1, "reacted_by_me": False}],
            [{"message_id": 1}],
            [],
            [{"message_id": 2, "read_count": 3, "last_read_at": None, "read_by_me": True}],
        ]
    )

    rows = hydrate_message_rows(
        conn,
        [
            {"id": 1, "message_type": "direct"},
            {"id": 2, "message_type": "group", "group_id": 9},
        ],
        user_id=7,
    )

    assert rows[0]["reactions"] == [{"emoji": "👍", "count": 2, "reacted_by_me": True}]
    assert rows[0]["is_favorited"] is True
    assert rows[1]["reactions"] == [{"emoji": "✅", "count": 1, "reacted_by_me": False}]
    assert rows[1]["read_count"] == 3
    assert rows[1]["read_by_me"] is True


def test_mark_group_messages_read_writes_per_message_receipts():
    now = datetime.now(timezone.utc)
    conn = _SequenceConn([21])

    mark_group_messages_read(conn, group_id=5, user_id=3, joined_at=now)

    assert len(conn.calls) == 3
    assert "group_message_read_receipts" in conn.calls[2][0]
    assert conn.calls[2][1] == {
        "group_id": 5,
        "user_id": 3,
        "joined_at": now,
        "last_message_id": 21,
    }


def test_admin_update_message_report_records_resolution(monkeypatch):
    conn = _SequenceConn(
        [
            {"id": 4, "message_sender_id": 8},
            {
                "id": 4,
                "status": "REVIEWED",
                "reviewed_by_user_id": 99,
                "resolution_note": "handled",
                "action_taken": "NONE",
            },
        ]
    )
    audit_calls = []

    monkeypatch.setattr("app.routers.messages.engine", _FakeEngine(conn))
    monkeypatch.setattr("app.routers.messages.audit_log", lambda *args, **kwargs: audit_calls.append((args, kwargs)))

    result = admin_update_message_report(4, {"status": "reviewed", "resolution_note": " handled "}, user={"id": 99})

    assert result["ok"] is True
    assert result["report"]["status"] == "REVIEWED"
    assert conn.calls[1][1]["resolution_note"] == "handled"
    assert audit_calls
