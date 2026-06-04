from fastapi import HTTPException

from app.routers import notifications as notifications_router
from app.services.notifications import notify_admin_broadcast


class _FakeResult:
    def __init__(self, rowcount: int):
        self.rowcount = rowcount


class _FakeConn:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        return _FakeResult(3)


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


def test_notify_admin_broadcast_targets_active_users_only():
    conn = _FakeConn()

    notified_users = notify_admin_broadcast(
        conn,
        title="平台维护通知",
        body_md="今晚 23:00 将进行维护。",
        link="/notifications",
    )

    assert notified_users == 3
    assert len(conn.calls) == 1
    sql, params = conn.calls[0]
    normalized_sql = " ".join(sql.lower().split())
    assert "insert into notifications" in normalized_sql
    assert "from users u" in normalized_sql
    assert "coalesce(u.is_disabled, false) = false" in normalized_sql
    assert params["title"] == "平台维护通知"
    assert params["body_md"] == "今晚 23:00 将进行维护。"
    assert params["link"] == "/notifications"


def test_admin_broadcast_notification_records_audit(monkeypatch):
    conn = _FakeConn()
    captured = {}

    def fake_notify_admin_broadcast(current_conn, *, title, body_md, link=None):
        captured["notify"] = {
            "conn": current_conn,
            "title": title,
            "body_md": body_md,
            "link": link,
        }
        return 7

    def fake_audit_log(current_conn, **kwargs):
        captured["audit"] = {"conn": current_conn, **kwargs}

    monkeypatch.setattr(notifications_router, "engine", _FakeEngine(conn))
    monkeypatch.setattr(notifications_router, "notify_admin_broadcast", fake_notify_admin_broadcast)
    monkeypatch.setattr(notifications_router, "audit_log", fake_audit_log)

    result = notifications_router.admin_broadcast_notification(
        {"title": "平台公告", "body_md": "请注意系统升级", "link": "/contests"},
        user={"id": 99, "role": "ADMIN"},
    )

    assert result == {"ok": True, "type": "ADMIN_BROADCAST", "notified_users": 7}
    assert captured["notify"] == {
        "conn": conn,
        "title": "平台公告",
        "body_md": "请注意系统升级",
        "link": "/contests",
    }
    assert captured["audit"] == {
        "conn": conn,
        "user_id": 99,
        "action": "admin.notification.broadcast",
        "resource_type": "notification",
        "resource_id": "平台公告",
        "metadata": {
            "type": "ADMIN_BROADCAST",
            "link": "/contests",
            "notified_users": 7,
        },
    }


def test_admin_broadcast_notification_rejects_external_link():
    try:
        notifications_router.admin_broadcast_notification(
            {"title": "平台公告", "body_md": "请注意系统升级", "link": "https://example.com"},
            user={"id": 99, "role": "ADMIN"},
        )
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "Link must start with /"
    else:
        raise AssertionError("Expected HTTPException for invalid link")
