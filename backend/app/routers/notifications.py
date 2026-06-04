from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin, require_user
from app.services.audit import audit_log
from app.services.notifications import notify_admin_broadcast

router = APIRouter()


@router.get("/api/notifications")
def list_notifications(limit: int = 50, unread_only: bool = False, user=Depends(require_user)):
    limit = max(1, min(int(limit or 50), 200))
    where_extra = "and is_read = false" if unread_only else ""

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select id, type, title, body_md, link, is_read, created_at, read_at
                from notifications
                where user_id = :user_id
                {where_extra}
                order by created_at desc, id desc
                limit :limit
                """
            ),
            {"user_id": user["id"], "limit": limit},
        ).mappings().all()

    return {"items": [dict(row) for row in rows]}


@router.get("/api/notifications/unread-count")
def notification_unread_count(user=Depends(require_user)):
    with engine.connect() as conn:
        unread_count = conn.execute(
            text(
                """
                select count(*) as n
                from notifications
                where user_id = :user_id and is_read = false
                """
            ),
            {"user_id": user["id"]},
        ).scalar_one()
    return {"unread_count": int(unread_count or 0)}


@router.post("/api/notifications/read-all")
def mark_notifications_read_all(user=Depends(require_user)):
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                update notifications
                set is_read = true,
                    read_at = coalesce(read_at, now())
                where user_id = :user_id
                  and is_read = false
                """
            ),
            {"user_id": user["id"]},
        )
    return {"ok": True}


@router.post("/api/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update notifications
                set is_read = true,
                    read_at = coalesce(read_at, now())
                where id = :notification_id
                  and user_id = :user_id
                returning id, is_read, read_at
                """
            ),
            {"notification_id": notification_id, "user_id": user["id"]},
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True, "notification": dict(row)}


@router.post("/api/admin/notifications/broadcast")
def admin_broadcast_notification(payload: dict, user=Depends(require_admin)):
    title = str(payload.get("title") or "").strip()
    body_md = str(payload.get("body_md") or "").strip()
    link = str(payload.get("link") or "").strip() or None

    if not title:
        raise HTTPException(status_code=400, detail="Missing title")
    if not body_md:
        raise HTTPException(status_code=400, detail="Missing body_md")
    if link and not link.startswith("/"):
        raise HTTPException(status_code=400, detail="Link must start with /")

    with engine.begin() as conn:
        notified_users = notify_admin_broadcast(
            conn,
            title=title,
            body_md=body_md,
            link=link,
        )
        audit_log(
            conn,
            user_id=user["id"],
            action="admin.notification.broadcast",
            resource_type="notification",
            resource_id=title[:120],
            metadata={
                "type": "ADMIN_BROADCAST",
                "link": link,
                "notified_users": notified_users,
            },
        )

    return {"ok": True, "type": "ADMIN_BROADCAST", "notified_users": notified_users}
