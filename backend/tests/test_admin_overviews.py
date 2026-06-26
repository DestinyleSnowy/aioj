from app.routers import drive as drive_router
from app.routers import messages as messages_router


class _FakeResult:
    def __init__(self, response):
        self.response = response

    def mappings(self):
        return self

    def first(self):
        return self.response

    def all(self):
        return self.response or []


class _SequenceConn:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), params or {}))
        response = self.responses.pop(0) if self.responses else None
        return _FakeResult(response)


class _FakeConnect:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeEngine:
    def __init__(self, conn):
        self.conn = conn

    def connect(self):
        return _FakeConnect(self.conn)


def test_admin_hello_overview_returns_operational_sections(monkeypatch):
    conn = _SequenceConn(
        [
            {
                "direct_message_count": 12,
                "group_message_count": 8,
                "today_message_count": 4,
                "message_count_7d": 15,
                "active_senders_7d": 3,
                "group_count": 2,
                "group_member_count": 9,
                "attachment_count": 5,
                "attachment_bytes": 2048,
                "report_count": 7,
                "open_report_count": 2,
            },
            [{"day": "2026-06-27", "direct_count": 3, "group_count": 1, "total_count": 4}],
            [{"status": "OPEN", "count": 2}],
            [{"reason": "spam", "count": 2}],
            [{"id": 1, "username": "alice", "message_count": 9}],
            [{"id": 3, "status": "OPEN", "reason": "spam", "reporter_username": "bob"}],
            [{"id": 4, "action": "message.report.update", "username": "admin"}],
        ]
    )
    monkeypatch.setattr(messages_router, "engine", _FakeEngine(conn))

    result = messages_router.admin_hello_overview(user={"id": 99, "role": "ADMIN"})

    assert result["summary"]["open_report_count"] == 2
    assert result["daily_messages"][0]["total_count"] == 4
    assert result["report_status_counts"][0]["status"] == "OPEN"
    assert result["top_report_reasons"][0]["reason"] == "spam"
    assert result["top_senders"][0]["username"] == "alice"
    assert result["recent_reports"][0]["reporter_username"] == "bob"
    assert result["recent_audit"][0]["action"] == "message.report.update"
    combined_sql = " ".join(sql.lower() for sql, _ in conn.calls)
    assert "direct_messages" in combined_sql
    assert "group_messages" in combined_sql
    assert "message_reports" in combined_sql
    assert "a.action like 'message.%'" in combined_sql


def test_admin_drive_overview_returns_capacity_and_share_sections(monkeypatch):
    conn = _SequenceConn(
        [
            {
                "used_bytes": 4096,
                "file_count": 6,
                "folder_count": 2,
                "user_count": 3,
                "today_file_count": 2,
                "today_uploaded_bytes": 1024,
                "share_count": 5,
                "active_share_count": 3,
                "revoked_share_count": 1,
                "expired_share_count": 1,
                "share_download_count": 17,
                "near_quota_user_count": 1,
            },
            [{"day": "2026-06-27", "file_count": 2, "uploaded_bytes": 1024}],
            [{"type": "image", "count": 4, "bytes": 3072}],
            [{"status": "ACTIVE", "count": 3}],
            [{"id": 1, "username": "alice", "used_bytes": 4096, "quota_bytes": 10_000}],
            [{"id": 7, "name": "dataset.zip", "download_count": 12, "status": "ACTIVE"}],
            [{"id": 8, "action": "drive.file.upload", "username": "alice"}],
        ]
    )
    monkeypatch.setattr(drive_router, "engine", _FakeEngine(conn))
    monkeypatch.setattr(drive_router, "ensure_drive_schema_ready", lambda: None)

    result = drive_router.admin_drive_overview(user={"id": 99, "role": "ADMIN"})

    assert result["summary"]["used_bytes"] == 4096
    assert result["daily_uploads"][0]["uploaded_bytes"] == 1024
    assert result["file_type_counts"][0]["type"] == "image"
    assert result["share_status_counts"][0]["status"] == "ACTIVE"
    assert result["top_users"][0]["username"] == "alice"
    assert result["heavy_shares"][0]["name"] == "dataset.zip"
    assert result["recent_audit"][0]["action"] == "drive.file.upload"
    assert conn.calls[0][1]["user_quota"] > 0
    assert conn.calls[0][1]["admin_quota"] > conn.calls[0][1]["user_quota"]
    combined_sql = " ".join(sql.lower() for sql, _ in conn.calls)
    assert "drive_items" in combined_sql
    assert "drive_shares" in combined_sql
    assert "a.action like 'drive.%'" in combined_sql
