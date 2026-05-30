from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_user

router = APIRouter()

MAX_MESSAGE_LENGTH = 4000


def normalize_message_body(value) -> str:
    body = str(value or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message body is required")
    if len(body) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=400, detail=f"Message body must be at most {MAX_MESSAGE_LENGTH} characters")
    return body


def clamp_limit(value, *, default: int = 50, max_value: int = 200) -> int:
    try:
        limit = int(value or default)
    except (TypeError, ValueError):
        limit = default
    return max(1, min(limit, max_value))


@router.get("/api/messages/unread-count")
def direct_message_unread_count(user=Depends(require_user)):
    with engine.connect() as conn:
        unread_count = conn.execute(
            text(
                """
                select count(*) as n
                from direct_messages
                where recipient_id = :user_id
                  and is_read = false
                """
            ),
            {"user_id": user["id"]},
        ).scalar_one()
    return {"unread_count": int(unread_count or 0)}


@router.get("/api/messages/users")
def search_message_users(q: str = "", limit: int = 20, user=Depends(require_user)):
    limit = clamp_limit(limit, default=20, max_value=50)
    query = str(q or "").strip()
    params = {"user_id": user["id"], "limit": limit}
    where_query = ""
    if query:
        where_query = "and username ilike :query"
        params["query"] = f"%{query}%"

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select id, username, role
                from users
                where id <> :user_id
                  and coalesce(is_disabled, false) = false
                  {where_query}
                order by username asc, id asc
                limit :limit
                """
            ),
            params,
        ).mappings().all()
    return {"items": [dict(row) for row in rows]}


@router.get("/api/messages/conversations")
def list_message_conversations(limit: int = 50, user=Depends(require_user)):
    limit = clamp_limit(limit, default=50, max_value=200)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                with scoped as (
                  select
                    dm.*,
                    case
                      when dm.sender_id = :user_id then dm.recipient_id
                      else dm.sender_id
                    end as peer_id
                  from direct_messages dm
                  where dm.sender_id = :user_id
                     or dm.recipient_id = :user_id
                ),
                ranked as (
                  select
                    scoped.*,
                    row_number() over (
                      partition by peer_id
                      order by created_at desc, id desc
                    ) as rn
                  from scoped
                ),
                unread as (
                  select sender_id as peer_id, count(*) as unread_count
                  from direct_messages
                  where recipient_id = :user_id
                    and is_read = false
                  group by sender_id
                )
                select
                  ranked.peer_id,
                  u.username as peer_username,
                  u.role as peer_role,
                  ranked.id as last_message_id,
                  ranked.sender_id as last_sender_id,
                  ranked.recipient_id as last_recipient_id,
                  ranked.body_md as last_body_md,
                  ranked.is_read as last_is_read,
                  ranked.created_at as last_created_at,
                  ranked.read_at as last_read_at,
                  coalesce(unread.unread_count, 0) as unread_count
                from ranked
                join users u on u.id = ranked.peer_id
                left join unread on unread.peer_id = ranked.peer_id
                where ranked.rn = 1
                order by ranked.created_at desc, ranked.id desc
                limit :limit
                """
            ),
            {"user_id": user["id"], "limit": limit},
        ).mappings().all()
    return {"items": [dict(row) for row in rows]}


@router.get("/api/messages/conversations/{peer_id}")
def get_message_conversation(peer_id: int, limit: int = 100, user=Depends(require_user)):
    if peer_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot open a conversation with yourself")

    limit = clamp_limit(limit, default=100, max_value=200)
    with engine.begin() as conn:
        peer = conn.execute(
            text(
                """
                select id, username, role, coalesce(is_disabled, false) as is_disabled
                from users
                where id = :peer_id
                """
            ),
            {"peer_id": peer_id},
        ).mappings().first()
        if not peer:
            raise HTTPException(status_code=404, detail="User not found")

        conn.execute(
            text(
                """
                update direct_messages
                set is_read = true,
                    read_at = coalesce(read_at, now())
                where sender_id = :peer_id
                  and recipient_id = :user_id
                  and is_read = false
                """
            ),
            {"peer_id": peer_id, "user_id": user["id"]},
        )
        rows = conn.execute(
            text(
                """
                select *
                from (
                  select
                    dm.id,
                    dm.sender_id,
                    su.username as sender_username,
                    dm.recipient_id,
                    ru.username as recipient_username,
                    dm.body_md,
                    dm.is_read,
                    dm.created_at,
                    dm.read_at
                  from direct_messages dm
                  join users su on su.id = dm.sender_id
                  join users ru on ru.id = dm.recipient_id
                  where (dm.sender_id = :user_id and dm.recipient_id = :peer_id)
                     or (dm.sender_id = :peer_id and dm.recipient_id = :user_id)
                  order by dm.created_at desc, dm.id desc
                  limit :limit
                ) recent
                order by created_at asc, id asc
                """
            ),
            {"user_id": user["id"], "peer_id": peer_id, "limit": limit},
        ).mappings().all()

    return {"peer": dict(peer), "items": [dict(row) for row in rows]}


@router.post("/api/messages")
def send_direct_message(payload: dict, user=Depends(require_user)):
    body = normalize_message_body(payload.get("body_md") or payload.get("body"))
    recipient_id_raw = payload.get("recipient_id")
    recipient_id = None
    recipient_key = str(payload.get("recipient_username") or payload.get("recipient") or "").strip()

    if recipient_id_raw not in (None, ""):
        try:
            recipient_id = int(recipient_id_raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid recipient_id")
        if recipient_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid recipient_id")
    if recipient_id is None and not recipient_key:
        raise HTTPException(status_code=400, detail="Recipient is required")

    with engine.begin() as conn:
        if recipient_id is not None:
            recipient = conn.execute(
                text(
                    """
                    select id, username, role, coalesce(is_disabled, false) as is_disabled
                    from users
                    where id = :recipient_id
                    """
                ),
                {"recipient_id": recipient_id},
            ).mappings().first()
        else:
            recipient = conn.execute(
                text(
                    """
                    select id, username, role, coalesce(is_disabled, false) as is_disabled
                    from users
                    where username = :recipient_key
                       or email = :recipient_key
                    limit 1
                    """
                ),
                {"recipient_key": recipient_key},
            ).mappings().first()

        if not recipient:
            raise HTTPException(status_code=404, detail="Recipient not found")
        if recipient["id"] == user["id"]:
            raise HTTPException(status_code=400, detail="Cannot send a message to yourself")
        if bool(recipient["is_disabled"]):
            raise HTTPException(status_code=400, detail="Recipient is disabled")

        row = conn.execute(
            text(
                """
                with inserted as (
                  insert into direct_messages(sender_id, recipient_id, body_md)
                  values (:sender_id, :recipient_id, :body_md)
                  returning id, sender_id, recipient_id, body_md, is_read, created_at, read_at
                )
                select
                  inserted.id,
                  inserted.sender_id,
                  su.username as sender_username,
                  inserted.recipient_id,
                  ru.username as recipient_username,
                  inserted.body_md,
                  inserted.is_read,
                  inserted.created_at,
                  inserted.read_at
                from inserted
                join users su on su.id = inserted.sender_id
                join users ru on ru.id = inserted.recipient_id
                """
            ),
            {"sender_id": user["id"], "recipient_id": recipient["id"], "body_md": body},
        ).mappings().first()

    return {"ok": True, "message": dict(row), "peer": dict(recipient)}


@router.post("/api/messages/conversations/{peer_id}/read")
def mark_message_conversation_read(peer_id: int, user=Depends(require_user)):
    if peer_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot mark a self conversation")

    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                update direct_messages
                set is_read = true,
                    read_at = coalesce(read_at, now())
                where sender_id = :peer_id
                  and recipient_id = :user_id
                  and is_read = false
                """
            ),
            {"peer_id": peer_id, "user_id": user["id"]},
        )
    return {"ok": True, "updated": int(result.rowcount or 0)}
