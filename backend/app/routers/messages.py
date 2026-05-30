from pathlib import Path
import mimetypes
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_user
from app.storage import S3_BUCKET_MESSAGES, get_bytes, put_bytes

router = APIRouter()

MAX_MESSAGE_LENGTH = 4000
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
IMAGE_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def normalize_message_body(value) -> str:
    body = normalize_optional_message_body(value)
    if not body:
        raise HTTPException(status_code=400, detail="Message body is required")
    return body


def normalize_optional_message_body(value) -> str:
    body = str(value or "").strip()
    if len(body) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=400, detail=f"Message body must be at most {MAX_MESSAGE_LENGTH} characters")
    return body


def normalize_recipient_id(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        recipient_id = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid recipient_id")
    if recipient_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid recipient_id")
    return recipient_id


def resolve_recipient(conn, *, current_user_id: int, recipient_id=None, recipient_key: str = ""):
    recipient_id = normalize_recipient_id(recipient_id)
    recipient_key = str(recipient_key or "").strip()
    if recipient_id is None and not recipient_key:
        raise HTTPException(status_code=400, detail="Recipient is required")

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
    if recipient["id"] == current_user_id:
        raise HTTPException(status_code=400, detail="Cannot send a message to yourself")
    if bool(recipient["is_disabled"]):
        raise HTTPException(status_code=400, detail="Recipient is disabled")
    return recipient


def normalize_content_type(filename: str | None, content_type: str | None) -> str:
    content_type = str(content_type or "").split(";", 1)[0].strip().lower()
    if content_type and content_type != "application/octet-stream":
        return content_type
    guessed, _ = mimetypes.guess_type(filename or "")
    return guessed or "application/octet-stream"


def validate_file_upload(filename: str | None, content_type: str | None, data: bytes) -> tuple[str, str]:
    content_type = normalize_content_type(filename, content_type)
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="File must be at most 20 MB")

    suffix = Path(filename or "").suffix.lower()
    if not suffix or len(suffix) > 16:
        suffix = mimetypes.guess_extension(content_type) or ".bin"
    if suffix == ".jpeg":
        suffix = ".jpg"
    return content_type, suffix


def safe_attachment_filename(filename: str | None, fallback_suffix: str) -> str:
    name = Path(filename or f"file{fallback_suffix}").name
    safe = "".join(ch for ch in name if ch.isalnum() or ch in " ._-()[]").strip()
    return (safe or f"file{fallback_suffix}")[:180]


def content_disposition(filename: str | None, *, inline: bool = False) -> str:
    disposition = "inline" if inline else "attachment"
    if not filename:
        return disposition
    ascii_name = "".join(ch if 32 <= ord(ch) < 127 and ch not in {'"', "\\"} else "_" for ch in filename)
    return f'{disposition}; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'


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
                  (ranked.attachment_object_key is not null) as last_has_attachment,
                  ranked.attachment_content_type as last_attachment_content_type,
                  ranked.attachment_filename as last_attachment_filename,
                  ranked.attachment_size_bytes as last_attachment_size_bytes,
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
                    (dm.attachment_object_key is not null) as has_attachment,
                    case when dm.attachment_object_key is not null then dm.id end as attachment_id,
                    dm.attachment_content_type,
                    dm.attachment_filename,
                    dm.attachment_size_bytes,
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
    recipient_id = payload.get("recipient_id")
    recipient_key = str(payload.get("recipient_username") or payload.get("recipient") or "").strip()

    with engine.begin() as conn:
        recipient = resolve_recipient(
            conn,
            current_user_id=user["id"],
            recipient_id=recipient_id,
            recipient_key=recipient_key,
        )
        row = conn.execute(
            text(
                """
                with inserted as (
                  insert into direct_messages(sender_id, recipient_id, body_md)
                  values (:sender_id, :recipient_id, :body_md)
                  returning id, sender_id, recipient_id, body_md,
                            false as has_attachment,
                            null::bigint as attachment_id,
                            attachment_content_type, attachment_filename, attachment_size_bytes,
                            is_read, created_at, read_at
                )
                select
                  inserted.id,
                  inserted.sender_id,
                  su.username as sender_username,
                  inserted.recipient_id,
                  ru.username as recipient_username,
                  inserted.body_md,
                  inserted.has_attachment,
                  inserted.attachment_id,
                  inserted.attachment_content_type,
                  inserted.attachment_filename,
                  inserted.attachment_size_bytes,
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


@router.post("/api/messages/files")
async def send_direct_message_file(
    recipient_id: int | None = Form(None),
    recipient: str | None = Form(None),
    recipient_username: str | None = Form(None),
    body_md: str = Form(""),
    file: UploadFile = File(...),
    user=Depends(require_user),
):
    body = normalize_optional_message_body(body_md)
    file_bytes = await file.read()
    content_type, suffix = validate_file_upload(file.filename, file.content_type, file_bytes)
    object_key = f"messages/{user['id']}/{uuid4().hex}{suffix}"
    filename = safe_attachment_filename(file.filename, suffix)

    with engine.begin() as conn:
        peer = resolve_recipient(
            conn,
            current_user_id=user["id"],
            recipient_id=recipient_id,
            recipient_key=recipient_username or recipient or "",
        )
        row = conn.execute(
            text(
                """
                with inserted as (
                  insert into direct_messages(
                    sender_id,
                    recipient_id,
                    body_md,
                    attachment_object_key,
                    attachment_content_type,
                    attachment_filename,
                    attachment_size_bytes
                  )
                  values (
                    :sender_id,
                    :recipient_id,
                    :body_md,
                    :attachment_object_key,
                    :attachment_content_type,
                    :attachment_filename,
                    :attachment_size_bytes
                  )
                  returning id, sender_id, recipient_id, body_md,
                            true as has_attachment,
                            id as attachment_id,
                            attachment_content_type, attachment_filename, attachment_size_bytes,
                            is_read, created_at, read_at
                )
                select
                  inserted.id,
                  inserted.sender_id,
                  su.username as sender_username,
                  inserted.recipient_id,
                  ru.username as recipient_username,
                  inserted.body_md,
                  inserted.has_attachment,
                  inserted.attachment_id,
                  inserted.attachment_content_type,
                  inserted.attachment_filename,
                  inserted.attachment_size_bytes,
                  inserted.is_read,
                  inserted.created_at,
                  inserted.read_at
                from inserted
                join users su on su.id = inserted.sender_id
                join users ru on ru.id = inserted.recipient_id
                """
            ),
            {
                "sender_id": user["id"],
                "recipient_id": peer["id"],
                "body_md": body,
                "attachment_object_key": object_key,
                "attachment_content_type": content_type,
                "attachment_filename": filename,
                "attachment_size_bytes": len(file_bytes),
            },
        ).mappings().first()

    try:
        put_bytes(S3_BUCKET_MESSAGES, object_key, file_bytes, content_type)
    except Exception as exc:
        with engine.begin() as conn:
            conn.execute(text("delete from direct_messages where id = :id"), {"id": row["id"]})
        raise HTTPException(status_code=500, detail="Failed to store message file") from exc

    return {"ok": True, "message": dict(row), "peer": dict(peer)}


@router.post("/api/messages/images")
async def send_direct_message_image(
    recipient_id: int | None = Form(None),
    recipient: str | None = Form(None),
    recipient_username: str | None = Form(None),
    body_md: str = Form(""),
    image: UploadFile = File(...),
    user=Depends(require_user),
):
    return await send_direct_message_file(
        recipient_id=recipient_id,
        recipient=recipient,
        recipient_username=recipient_username,
        body_md=body_md,
        file=image,
        user=user,
    )


@router.get("/api/messages/{message_id}/attachment")
def get_direct_message_attachment(message_id: int, user=Depends(require_user)):
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select attachment_object_key, attachment_content_type, attachment_filename
                from direct_messages
                where id = :message_id
                  and (sender_id = :user_id or recipient_id = :user_id)
                  and attachment_object_key is not null
                """
            ),
            {"message_id": message_id, "user_id": user["id"]},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        content = get_bytes(S3_BUCKET_MESSAGES, row["attachment_object_key"])
    except Exception as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc

    content_type = row["attachment_content_type"] or "application/octet-stream"
    headers = {
        "Content-Disposition": content_disposition(
            row["attachment_filename"],
            inline=content_type.startswith("image/"),
        )
    }
    return Response(content=content, media_type=content_type, headers=headers)


@router.get("/api/messages/{message_id}/image")
def get_direct_message_image(message_id: int, user=Depends(require_user)):
    return get_direct_message_attachment(message_id, user)


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
