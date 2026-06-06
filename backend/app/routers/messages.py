import asyncio
from datetime import datetime, time, timedelta, timezone
import json
from pathlib import Path
import mimetypes
import re
import secrets
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin, require_user
from app.rate_limit import check_rate_limit, client_key
from app.services.audit import audit_log
from app.services.notifications import create_notification
from app.storage import S3_BUCKET_MESSAGES, get_bytes, put_bytes
from app.user_profiles import avatar_url_for_user, serialize_user

router = APIRouter()

MAX_MESSAGE_LENGTH = 4000
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_GROUP_NAME_LENGTH = 80
MAX_GROUP_NICKNAME_LENGTH = 50
MAX_CONTACT_REMARK_LENGTH = 50
MAX_GROUP_MEMBERS = 50
MAX_REPORT_REASON_LENGTH = 80
MAX_REPORT_DETAILS_LENGTH = 2000
MESSAGE_MUTATION_WINDOW_SECONDS = 120
MESSAGE_EVENT_POLL_SECONDS = 2
MESSAGE_TYPING_TTL_SECONDS = 8
MESSAGE_ONLINE_WINDOW_SECONDS = 90
PLAIN_MENTION_PATTERN = re.compile(r"(?<![A-Za-z0-9_.-])@([A-Za-z0-9][A-Za-z0-9_.-]{2,49}|all)\b", re.IGNORECASE)
BRACED_MENTION_PATTERN = re.compile(r"@\{([^{}\r\n]{1,50})\}")
IMAGE_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
DANGEROUS_ATTACHMENT_SUFFIXES = {
    ".bat",
    ".cmd",
    ".com",
    ".exe",
    ".js",
    ".jse",
    ".msi",
    ".ps1",
    ".scr",
    ".sh",
    ".vbs",
    ".wsf",
}
DANGEROUS_CONTENT_TYPES = {
    "application/x-msdownload",
    "application/x-msdos-program",
    "application/x-sh",
    "text/x-shellscript",
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


def normalize_edited_message_body(message, payload: dict) -> str:
    body = normalize_optional_message_body(payload.get("body_md") or payload.get("body"))
    if body:
        return body
    if message.get("attachment_object_key"):
        return ""
    raise HTTPException(status_code=400, detail="Message body is required")


def message_hidden_filter_sql(message_alias: str, *, scope: str, user_param: str = "user_id") -> str:
    column = "direct_message_id" if scope == "direct" else "group_message_id"
    return f"""
      not exists (
        select 1
        from message_hidden_entries hidden
        where hidden.user_id = :{user_param}
          and hidden.{column} = {message_alias}.id
      )
    """


def message_mutation_deadline(message) -> datetime:
    created_at = message.get("created_at")
    if not isinstance(created_at, datetime):
        raise HTTPException(status_code=400, detail="Message timestamp is unavailable")
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at + timedelta(seconds=MESSAGE_MUTATION_WINDOW_SECONDS)


def require_message_mutation_window(message, *, action: str) -> None:
    if datetime.now(timezone.utc) > message_mutation_deadline(message):
        raise HTTPException(status_code=400, detail=f"Messages can only be {action} within 2 minutes")


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


def normalize_group_name(value) -> str:
    name = str(value or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    if len(name) > MAX_GROUP_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Group name must be at most {MAX_GROUP_NAME_LENGTH} characters")
    return name


def normalize_group_nickname(value, *, allow_empty: bool = False) -> str | None:
    nickname = str(value or "").strip()
    if not nickname:
        if allow_empty:
            return None
        raise HTTPException(status_code=400, detail="Group nickname is required")
    if len(nickname) > MAX_GROUP_NICKNAME_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Group nickname must be at most {MAX_GROUP_NICKNAME_LENGTH} characters",
        )
    return nickname


def normalize_contact_remark(value) -> str | None:
    remark = str(value or "").strip()
    if not remark:
        return None
    if len(remark) > MAX_CONTACT_REMARK_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Contact remark must be at most {MAX_CONTACT_REMARK_LENGTH} characters",
        )
    return remark


def normalize_group_member_ids(value, *, current_user_id: int | None = None) -> list[int]:
    if value in (None, ""):
        raw_items = []
    elif isinstance(value, str):
        raw_items = [item.strip() for item in value.split(",") if item.strip()]
    elif isinstance(value, (list, tuple, set)):
        raw_items = list(value)
    else:
        raise HTTPException(status_code=400, detail="member_ids must be a list")

    member_ids: list[int] = []
    seen: set[int] = set()
    for item in raw_items:
        try:
            member_id = int(item)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid member_id")
        if member_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid member_id")
        if current_user_id is not None and member_id == current_user_id:
            continue
        if member_id in seen:
            continue
        seen.add(member_id)
        member_ids.append(member_id)

    if len(member_ids) > MAX_GROUP_MEMBERS - 1:
        raise HTTPException(status_code=400, detail=f"Group can have at most {MAX_GROUP_MEMBERS} members")
    return member_ids


def fetch_users_by_ids(conn, user_ids: list[int]):
    if not user_ids:
        return []
    params = {f"user_id_{idx}": user_id for idx, user_id in enumerate(user_ids)}
    placeholders = ", ".join(f":user_id_{idx}" for idx in range(len(user_ids)))
    rows = conn.execute(
        text(
            f"""
            select
              id,
              username,
              role,
              avatar_object_key,
              avatar_updated_at,
              last_seen_at,
              coalesce(is_disabled, false) as is_disabled
            from users
            where id in ({placeholders})
            """
        ),
        params,
    ).mappings().all()

    by_id = {int(row["id"]): row for row in rows}
    missing = [user_id for user_id in user_ids if user_id not in by_id]
    if missing:
        raise HTTPException(status_code=404, detail="Group member not found")
    disabled = [row["username"] for row in rows if bool(row["is_disabled"])]
    if disabled:
        raise HTTPException(status_code=400, detail="Group member is disabled")
    return [serialize_user(by_id[user_id]) for user_id in user_ids]


def resolve_group_members(conn, *, current_user_id: int, member_ids) -> list[dict]:
    normalized_ids = normalize_group_member_ids(member_ids, current_user_id=current_user_id)
    if not normalized_ids:
        raise HTTPException(status_code=400, detail="At least one group member is required")
    return fetch_users_by_ids(conn, normalized_ids)


def resolve_recipient(conn, *, current_user_id: int, recipient_id=None, recipient_key: str = ""):
    recipient_id = normalize_recipient_id(recipient_id)
    recipient_key = str(recipient_key or "").strip()
    if recipient_id is None and not recipient_key:
        raise HTTPException(status_code=400, detail="Recipient is required")

    if recipient_id is not None:
        recipient = conn.execute(
            text(
                """
                select
                  id,
                  username,
                  role,
                  avatar_object_key,
                  avatar_updated_at,
                  last_seen_at,
                  coalesce(is_disabled, false) as is_disabled
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
                select
                  id,
                  username,
                  role,
                  avatar_object_key,
                  avatar_updated_at,
                  last_seen_at,
                  coalesce(is_disabled, false) as is_disabled
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
    return serialize_user(recipient)


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
    if suffix in DANGEROUS_ATTACHMENT_SUFFIXES or content_type in DANGEROUS_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="File type is not allowed")
    if content_type in IMAGE_CONTENT_TYPES:
        signatures = {
            "image/jpeg": (b"\xff\xd8\xff",),
            "image/png": (b"\x89PNG\r\n\x1a\n",),
            "image/gif": (b"GIF87a", b"GIF89a"),
            "image/webp": (b"RIFF",),
        }
        if not any(data.startswith(sig) for sig in signatures.get(content_type, ())):
            raise HTTPException(status_code=400, detail="Image content does not match its type")
    return content_type, suffix


def scan_message_attachment(data: bytes, content_type: str) -> str:
    lowered = data[:4096].lower()
    if b"<script" in lowered or data[:2] == b"MZ":
        return "SUSPICIOUS"
    if content_type in DANGEROUS_CONTENT_TYPES:
        return "SUSPICIOUS"
    return "CLEAN"


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


def normalize_message_cursor(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        cursor = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid message cursor")
    if cursor <= 0:
        raise HTTPException(status_code=400, detail="Invalid message cursor")
    return cursor


def normalize_offset(value) -> int:
    try:
        offset = int(value or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid offset")
    return max(0, offset)


def normalize_conversation_type(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in {"direct", "group"}:
        raise HTTPException(status_code=400, detail="Invalid conversation type")
    return normalized


def normalize_message_scope(value: str | None) -> tuple[str, str]:
    normalized = normalize_conversation_type(value)
    return normalized, "direct_message_id" if normalized == "direct" else "group_message_id"


def normalize_report_reason(value) -> str:
    reason = str(value or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Report reason is required")
    if len(reason) > MAX_REPORT_REASON_LENGTH:
        raise HTTPException(status_code=400, detail=f"Report reason must be at most {MAX_REPORT_REASON_LENGTH} characters")
    return reason


def normalize_report_details(value) -> str:
    details = str(value or "").strip()
    if len(details) > MAX_REPORT_DETAILS_LENGTH:
        raise HTTPException(status_code=400, detail=f"Report details must be at most {MAX_REPORT_DETAILS_LENGTH} characters")
    return details


def normalize_optional_bool(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise HTTPException(status_code=400, detail="Invalid boolean value")


def normalize_dm_policy(value) -> str:
    normalized = str(value or "EVERYONE").strip().upper()
    if normalized not in {"EVERYONE", "NOBODY"}:
        raise HTTPException(status_code=400, detail="Invalid direct message policy")
    return normalized


def normalize_optional_time(value):
    if value in (None, ""):
        return None
    if isinstance(value, time):
        return value
    text_value = str(value).strip()
    try:
        return time.fromisoformat(text_value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid time value")


def normalize_reaction_emoji(value) -> str:
    emoji = str(value or "").strip()
    if not emoji or len(emoji) > 16:
        raise HTTPException(status_code=400, detail="Emoji must be 1-16 characters")
    return emoji


def normalize_optional_note(value, *, max_length: int = 1000) -> str:
    note = str(value or "").strip()
    if len(note) > max_length:
        raise HTTPException(status_code=400, detail=f"Note must be at most {max_length} characters")
    return note


def normalize_group_member_role(value) -> str:
    role = str(value or "").strip().upper()
    if role not in {"ADMIN", "MEMBER"}:
        raise HTTPException(status_code=400, detail="Group member role must be ADMIN or MEMBER")
    return role


def touch_user_presence(conn, user_id: int) -> None:
    conn.execute(text("update users set last_seen_at = now() where id = :user_id"), {"user_id": user_id})


def presence_payload(row) -> dict:
    last_seen_at = row.get("last_seen_at") if row else None
    is_online = False
    if isinstance(last_seen_at, datetime):
        seen_at = last_seen_at if last_seen_at.tzinfo else last_seen_at.replace(tzinfo=timezone.utc)
        is_online = datetime.now(timezone.utc) - seen_at <= timedelta(seconds=MESSAGE_ONLINE_WINDOW_SECONDS)
    return {
        "last_seen_at": last_seen_at,
        "is_online": is_online,
    }


def trim_message_page(rows, limit: int):
    if limit <= 0:
        return []
    return list(rows)[-limit:]


def serialize_group_member(row) -> dict:
    data = dict(row)
    username = str(data.get("username") or "").strip() or "用户"
    nickname = str(data.get("group_nickname") or "").strip() or username
    return {
        "id": data.get("id"),
        "username": username,
        "role": data.get("role"),
        "member_role": data.get("member_role"),
        "joined_at": data.get("joined_at"),
        "group_nickname": nickname,
        "avatar_url": avatar_url_for_user(
            data.get("id"),
            data.get("avatar_updated_at"),
            data.get("avatar_object_key"),
        ),
        **presence_payload(data),
    }


def serialize_message_row(row) -> dict:
    data = dict(row)
    message_type = str(data.get("message_type") or data.get("attachment_scope") or "").strip().lower()
    if message_type not in {"direct", "group"}:
        message_type = "group" if data.get("group_id") is not None else "direct"
    data["message_type"] = message_type
    data["attachment_scope"] = message_type
    data["sender_avatar_url"] = avatar_url_for_user(
        data.get("sender_id"),
        data.get("sender_avatar_updated_at"),
        data.get("sender_avatar_object_key"),
    )
    data["recipient_avatar_url"] = avatar_url_for_user(
        data.get("recipient_id"),
        data.get("recipient_avatar_updated_at"),
        data.get("recipient_avatar_object_key"),
    )
    sender_group_nickname = str(data.get("sender_group_nickname") or "").strip()
    if "sender_group_nickname" in data:
        data["sender_group_nickname"] = sender_group_nickname or data.get("sender_username")
    data["is_deleted"] = bool(data.get("deleted_at"))
    data["is_recalled"] = data["is_deleted"]
    if data["is_deleted"]:
        data["has_attachment"] = False
        data["attachment_id"] = None
    if not bool(data.get("has_attachment")):
        data["attachment_scan_status"] = None
        data["attachment_thumbnail_object_key"] = None
    data["reactions"] = data.get("reactions") or []
    data["is_favorited"] = bool(data.get("is_favorited"))
    if data["message_type"] == "group":
        data["read_count"] = int(data.get("read_count") or 0)
        data["read_by_me"] = bool(data.get("read_by_me"))
    for key in (
        "sender_avatar_object_key",
        "sender_avatar_updated_at",
        "recipient_avatar_object_key",
        "recipient_avatar_updated_at",
    ):
        data.pop(key, None)
    return data


def serialize_conversation_row(row) -> dict:
    data = dict(row)
    data["peer_avatar_url"] = avatar_url_for_user(
        data.get("peer_id"),
        data.get("peer_avatar_updated_at"),
        data.get("peer_avatar_object_key"),
    )
    peer_remark_name = str(data.get("peer_remark_name") or "").strip()
    if "peer_remark_name" in data:
        data["peer_remark_name"] = peer_remark_name or None
        data["peer_display_name"] = peer_remark_name or data.get("peer_username")
    last_sender_group_nickname = str(data.get("last_sender_group_nickname") or "").strip()
    if "last_sender_group_nickname" in data:
        data["last_sender_group_nickname"] = last_sender_group_nickname or data.get("last_sender_username")
    if "peer_last_seen_at" in data:
        data["peer_presence"] = presence_payload({"last_seen_at": data.get("peer_last_seen_at")})
    for key in ("peer_avatar_object_key", "peer_avatar_updated_at", "peer_last_seen_at"):
        data.pop(key, None)
    data["is_pinned"] = bool(data.get("is_pinned"))
    data["is_archived"] = bool(data.get("is_archived"))
    data["is_muted"] = bool(data.get("is_muted"))
    return data


def get_group_membership(conn, *, group_id: int, user_id: int):
    row = conn.execute(
        text(
            """
            select
              g.id,
              g.name,
              g.owner_id,
              g.created_at,
              g.updated_at,
              mgm.role as member_role,
              coalesce(nullif(btrim(mgm.group_nickname), ''), u.username) as group_nickname,
              mgm.joined_at,
              (
                select count(*)
                from message_group_members members
                where members.group_id = g.id
              ) as member_count
            from message_groups g
            join message_group_members mgm on mgm.group_id = g.id
            join users u on u.id = mgm.user_id
            where g.id = :group_id
              and mgm.user_id = :user_id
            """
        ),
        {"group_id": group_id, "user_id": user_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Group not found")
    return row


def list_group_members(conn, group_id: int):
    rows = conn.execute(
        text(
            """
            select
              u.id,
              u.username,
              u.role,
              u.avatar_object_key,
              u.avatar_updated_at,
              u.last_seen_at,
              coalesce(nullif(btrim(mgm.group_nickname), ''), u.username) as group_nickname,
              mgm.role as member_role,
              mgm.joined_at
            from message_group_members mgm
            join users u on u.id = mgm.user_id
            where mgm.group_id = :group_id
            order by
              case mgm.role when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end,
              u.username asc,
              u.id asc
            """
        ),
        {"group_id": group_id},
    ).mappings().all()
    return [serialize_group_member(row) for row in rows]


def build_group_payload(group, members: list[dict] | None = None) -> dict:
    payload = dict(group)
    if members is not None:
        payload["members"] = members
        payload["member_count"] = len(members)
    payload["current_user_member_role"] = payload.get("member_role")
    payload["current_user_group_nickname"] = payload.get("group_nickname")
    payload["can_manage"] = payload.get("member_role") in {"OWNER", "ADMIN"}
    payload["can_transfer_owner"] = payload.get("member_role") == "OWNER"
    return payload


def apply_conversation_preferences_payload(payload: dict, preferences: dict | None = None) -> dict:
    prefs = preferences or {}
    payload["is_pinned"] = bool(prefs.get("is_pinned"))
    payload["pinned_at"] = prefs.get("pinned_at")
    payload["is_archived"] = bool(prefs.get("is_archived"))
    payload["archived_at"] = prefs.get("archived_at")
    payload["is_muted"] = bool(prefs.get("is_muted"))
    payload["muted_at"] = prefs.get("muted_at")
    return payload


def require_group_owner(group) -> None:
    if dict(group).get("member_role") != "OWNER":
        raise HTTPException(status_code=403, detail="Only the group owner can manage this group")


def require_group_manager(group) -> None:
    if dict(group).get("member_role") not in {"OWNER", "ADMIN"}:
        raise HTTPException(status_code=403, detail="Only group managers can perform this action")


def group_member_exists(conn, *, group_id: int, user_id: int) -> bool:
    return bool(
        conn.execute(
            text(
                """
                select 1
                from message_group_members
                where group_id = :group_id
                  and user_id = :user_id
                """
            ),
            {"group_id": group_id, "user_id": user_id},
        ).first()
    )


def get_user_block_state(conn, *, current_user_id: int, other_user_id: int) -> dict:
    row = conn.execute(
        text(
            """
            select
              exists(
                select 1
                from user_message_blocks
                where blocker_id = :current_user_id
                  and blocked_user_id = :other_user_id
              ) as is_blocked_by_me,
              exists(
                select 1
                from user_message_blocks
                where blocker_id = :other_user_id
                  and blocked_user_id = :current_user_id
              ) as has_blocked_me
            """
        ),
        {"current_user_id": current_user_id, "other_user_id": other_user_id},
    ).mappings().first()
    data = dict(row or {})
    return {
        "is_blocked_by_me": bool(data.get("is_blocked_by_me")),
        "has_blocked_me": bool(data.get("has_blocked_me")),
    }


def apply_contact_remark_payload(payload: dict, *, remark_name=None, username_key: str = "username") -> dict:
    remark = str(remark_name or "").strip()
    payload["peer_remark_name"] = remark or None
    payload["peer_display_name"] = remark or payload.get(username_key)
    return payload


def upsert_contact_remark(conn, *, user_id: int, contact_user_id: int, remark_name: str | None) -> dict:
    if remark_name is None:
        conn.execute(
            text(
                """
                delete from message_contact_remarks
                where user_id = :user_id
                  and contact_user_id = :contact_user_id
                """
            ),
            {"user_id": user_id, "contact_user_id": contact_user_id},
        )
        return {"remark_name": None, "updated_at": None}

    row = conn.execute(
        text(
            """
            insert into message_contact_remarks(user_id, contact_user_id, remark_name, updated_at)
            values (:user_id, :contact_user_id, :remark_name, now())
            on conflict (user_id, contact_user_id) do update
            set remark_name = excluded.remark_name,
                updated_at = now()
            returning remark_name, updated_at
            """
        ),
        {"user_id": user_id, "contact_user_id": contact_user_id, "remark_name": remark_name},
    ).mappings().first()
    return {"remark_name": row["remark_name"], "updated_at": row["updated_at"]}


def get_user_message_preferences(conn, *, user_id: int) -> dict:
    row = conn.execute(
        text(
            """
            select dm_policy, allow_group_invites, dnd_start_time, dnd_end_time, updated_at
            from user_message_preferences
            where user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    data = dict(row or {})
    return {
        "dm_policy": normalize_dm_policy(data.get("dm_policy")),
        "allow_group_invites": bool(data.get("allow_group_invites", True)),
        "dnd_start_time": data.get("dnd_start_time"),
        "dnd_end_time": data.get("dnd_end_time"),
        "updated_at": data.get("updated_at"),
    }


def require_direct_message_allowed(conn, *, current_user_id: int, other_user_id: int) -> None:
    block_state = get_user_block_state(conn, current_user_id=current_user_id, other_user_id=other_user_id)
    if block_state["is_blocked_by_me"]:
        raise HTTPException(status_code=403, detail="You blocked this user")
    if block_state["has_blocked_me"]:
        raise HTTPException(status_code=403, detail="This user is not accepting your messages")
    recipient_prefs = get_user_message_preferences(conn, user_id=other_user_id)
    if recipient_prefs["dm_policy"] == "NOBODY":
        raise HTTPException(status_code=403, detail="This user is not accepting direct messages")


def get_conversation_preferences(conn, *, user_id: int, conversation_type: str, conversation_id: int) -> dict:
    normalized_type = normalize_conversation_type(conversation_type).upper()
    row = conn.execute(
        text(
            """
            select
              is_pinned,
              pinned_at,
              is_archived,
              archived_at,
              is_muted,
              muted_at,
              updated_at
            from message_conversation_preferences
            where user_id = :user_id
              and conversation_type = :conversation_type
              and conversation_id = :conversation_id
            """
        ),
        {
            "user_id": user_id,
            "conversation_type": normalized_type,
            "conversation_id": conversation_id,
        },
    ).mappings().first()
    data = dict(row or {})
    return {
        "is_pinned": bool(data.get("is_pinned")),
        "pinned_at": data.get("pinned_at"),
        "is_archived": bool(data.get("is_archived")),
        "archived_at": data.get("archived_at"),
        "is_muted": bool(data.get("is_muted")),
        "muted_at": data.get("muted_at"),
        "updated_at": data.get("updated_at"),
    }


def upsert_conversation_preferences(
    conn,
    *,
    user_id: int,
    conversation_type: str,
    conversation_id: int,
    is_pinned: bool | None = None,
    is_archived: bool | None = None,
    is_muted: bool | None = None,
) -> dict:
    normalized_type = normalize_conversation_type(conversation_type).upper()
    current = get_conversation_preferences(
        conn,
        user_id=user_id,
        conversation_type=normalized_type,
        conversation_id=conversation_id,
    )
    pinned = current["is_pinned"] if is_pinned is None else bool(is_pinned)
    archived = current["is_archived"] if is_archived is None else bool(is_archived)
    muted = current["is_muted"] if is_muted is None else bool(is_muted)
    row = conn.execute(
        text(
            """
            insert into message_conversation_preferences(
              user_id,
              conversation_type,
              conversation_id,
              is_pinned,
              pinned_at,
              is_archived,
              archived_at,
              is_muted,
              muted_at,
              updated_at
            )
            values (
              :user_id,
              :conversation_type,
              :conversation_id,
              :is_pinned,
              case when :is_pinned then now() else null end,
              :is_archived,
              case when :is_archived then now() else null end,
              :is_muted,
              case when :is_muted then now() else null end,
              now()
            )
            on conflict (user_id, conversation_type, conversation_id) do update
            set is_pinned = excluded.is_pinned,
                pinned_at = case
                  when excluded.is_pinned and message_conversation_preferences.is_pinned = false then now()
                  when excluded.is_pinned then coalesce(message_conversation_preferences.pinned_at, now())
                  else null
                end,
                is_archived = excluded.is_archived,
                archived_at = case
                  when excluded.is_archived and message_conversation_preferences.is_archived = false then now()
                  when excluded.is_archived then coalesce(message_conversation_preferences.archived_at, now())
                  else null
                end,
                is_muted = excluded.is_muted,
                muted_at = case
                  when excluded.is_muted and message_conversation_preferences.is_muted = false then now()
                  when excluded.is_muted then coalesce(message_conversation_preferences.muted_at, now())
                  else null
                end,
                updated_at = now()
            returning is_pinned, pinned_at, is_archived, archived_at, is_muted, muted_at, updated_at
            """
        ),
        {
            "user_id": user_id,
            "conversation_type": normalized_type,
            "conversation_id": conversation_id,
            "is_pinned": pinned,
            "is_archived": archived,
            "is_muted": muted,
        },
    ).mappings().first()
    return {
        "is_pinned": bool(row["is_pinned"]),
        "pinned_at": row["pinned_at"],
        "is_archived": bool(row["is_archived"]),
        "archived_at": row["archived_at"],
        "is_muted": bool(row["is_muted"]),
        "muted_at": row["muted_at"],
        "updated_at": row["updated_at"],
    }


def transfer_group_owner(conn, *, group_id: int, new_owner_id: int) -> None:
    if not group_member_exists(conn, group_id=group_id, user_id=new_owner_id):
        raise HTTPException(status_code=404, detail="Group member not found")
    conn.execute(
        text(
            """
            update message_group_members
            set role = case when user_id = :new_owner_id then 'OWNER' else 'MEMBER' end
            where group_id = :group_id
            """
        ),
        {"group_id": group_id, "new_owner_id": new_owner_id},
    )
    conn.execute(
        text(
            """
            update message_groups
            set owner_id = :new_owner_id,
                updated_at = now()
            where id = :group_id
            """
        ),
        {"group_id": group_id, "new_owner_id": new_owner_id},
    )


def choose_next_group_owner(conn, *, group_id: int, leaving_user_id: int) -> int | None:
    return conn.execute(
        text(
            """
            select user_id
            from message_group_members
            where group_id = :group_id
              and user_id <> :leaving_user_id
            order by joined_at asc, user_id asc
            limit 1
            """
        ),
        {"group_id": group_id, "leaving_user_id": leaving_user_id},
    ).scalar_one_or_none()


def extract_message_mentions(body: str) -> dict[str, object]:
    usernames: list[str] = []
    username_seen: set[str] = set()
    nicknames: list[str] = []
    nickname_seen: set[str] = set()
    mention_all = False

    for match in PLAIN_MENTION_PATTERN.finditer(body or ""):
        mention = str(match.group(1) or "").strip().lower()
        if not mention:
            continue
        if mention == "all":
            mention_all = True
            continue
        if mention in username_seen:
            continue
        username_seen.add(mention)
        usernames.append(mention)

    for match in BRACED_MENTION_PATTERN.finditer(body or ""):
        mention = str(match.group(1) or "").strip()
        if not mention:
            continue
        lowered = mention.lower()
        if lowered == "all":
            mention_all = True
            continue
        if lowered in nickname_seen:
            continue
        nickname_seen.add(lowered)
        nicknames.append(mention)

    return {"usernames": usernames, "nicknames": nicknames, "all": mention_all}


def notify_group_mentions(conn, *, group, body: str, sender) -> None:
    mentions = extract_message_mentions(body)
    if not mentions["all"] and not mentions["usernames"] and not mentions["nicknames"]:
        return

    members = list_group_members(conn, group["id"])
    by_username = {str(member["username"]).lower(): member for member in members}
    by_nickname = {
        str(member["group_nickname"]).strip().lower(): member
        for member in members
        if str(member["group_nickname"] or "").strip()
    }
    target_ids: set[int] = set()
    if mentions["all"]:
        target_ids.update(int(member["id"]) for member in members)
    for mention in mentions["usernames"]:
        member = by_username.get(mention)
        if member:
            target_ids.add(int(member["id"]))
    for mention in mentions["nicknames"]:
        member = by_nickname.get(str(mention).strip().lower())
        if member:
            target_ids.add(int(member["id"]))

    target_ids.discard(int(sender["id"]))
    if not target_ids:
        return

    snippet = str(body or "").replace("\n", " ").strip()
    if len(snippet) > 180:
        snippet = f"{snippet[:179]}…"
    title = f"{sender['username']} 在群聊「{group['name']}」提到了你"
    for target_id in sorted(target_ids):
        create_notification(
            conn,
            target_id,
            "GROUP_MENTION",
            title,
            snippet,
            f"/messages/groups/{group['id']}",
        )


def mark_group_messages_read(conn, *, group_id: int, user_id: int, joined_at):
    last_message_id = conn.execute(
        text(
            """
            select max(id)
            from group_messages
            where group_id = :group_id
              and created_at >= :joined_at
            """
        ),
        {"group_id": group_id, "joined_at": joined_at},
    ).scalar_one()

    conn.execute(
        text(
            """
            insert into group_message_reads(group_id, user_id, last_read_message_id, read_at)
            values (:group_id, :user_id, :last_message_id, now())
            on conflict (group_id, user_id) do update
            set last_read_message_id = nullif(
                  greatest(
                    coalesce(group_message_reads.last_read_message_id, 0),
                    coalesce(excluded.last_read_message_id, 0)
                  ),
                  0
                ),
                read_at = now()
            """
        ),
        {"group_id": group_id, "user_id": user_id, "last_message_id": last_message_id},
    )
    if last_message_id:
        conn.execute(
            text(
                """
                insert into group_message_read_receipts(group_message_id, user_id, read_at)
                select id, :user_id, now()
                from group_messages
                where group_id = :group_id
                  and created_at >= :joined_at
                  and id <= :last_message_id
                on conflict (group_message_id, user_id) do update
                set read_at = greatest(group_message_read_receipts.read_at, excluded.read_at)
                """
            ),
            {
                "group_id": group_id,
                "user_id": user_id,
                "joined_at": joined_at,
                "last_message_id": last_message_id,
            },
        )


def resolve_direct_reply_target(conn, *, current_user_id: int, peer_id: int, reply_to_message_id) -> int | None:
    target_id = normalize_message_cursor(reply_to_message_id)
    if target_id is None:
        return None
    row = conn.execute(
        text(
            """
            select id
            from direct_messages
            where id = :message_id
              and (
                (sender_id = :current_user_id and recipient_id = :peer_id)
                or (sender_id = :peer_id and recipient_id = :current_user_id)
              )
            """
        ),
        {"message_id": target_id, "current_user_id": current_user_id, "peer_id": peer_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Reply target not found")
    return int(row["id"])


def resolve_group_reply_target(conn, *, group_id: int, joined_at, reply_to_message_id) -> int | None:
    target_id = normalize_message_cursor(reply_to_message_id)
    if target_id is None:
        return None
    row = conn.execute(
        text(
            """
            select id
            from group_messages
            where id = :message_id
              and group_id = :group_id
              and created_at >= :joined_at
            """
        ),
        {"message_id": target_id, "group_id": group_id, "joined_at": joined_at},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Reply target not found")
    return int(row["id"])


def get_direct_message_for_user(conn, *, message_id: int, user_id: int):
    row = conn.execute(
        text(
            """
            select
              dm.*,
              case when dm.sender_id = :user_id then dm.recipient_id else dm.sender_id end as peer_id
            from direct_messages dm
            where dm.id = :message_id
              and (dm.sender_id = :user_id or dm.recipient_id = :user_id)
            """
        ),
        {"message_id": message_id, "user_id": user_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    return row


def get_group_message_for_user(conn, *, message_id: int, user_id: int):
    row = conn.execute(
        text(
            """
            select
              gm.*,
              mgm.role as current_member_role,
              mgm.joined_at as current_member_joined_at
            from group_messages gm
            join message_group_members mgm
              on mgm.group_id = gm.group_id
             and mgm.user_id = :user_id
            where gm.id = :message_id
              and gm.created_at >= mgm.joined_at
            """
        ),
        {"message_id": message_id, "user_id": user_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    return row


def hide_direct_message_for_user(conn, *, message_id: int, user_id: int) -> None:
    conn.execute(
        text(
            """
            insert into message_hidden_entries(user_id, direct_message_id)
            values (:user_id, :message_id)
            on conflict (user_id, direct_message_id) do update
            set hidden_at = excluded.hidden_at
            """
        ),
        {"user_id": user_id, "message_id": message_id},
    )


def hide_group_message_for_user(conn, *, message_id: int, user_id: int) -> None:
    conn.execute(
        text(
            """
            insert into message_hidden_entries(user_id, group_message_id)
            values (:user_id, :message_id)
            on conflict (user_id, group_message_id) do update
            set hidden_at = excluded.hidden_at
            """
        ),
        {"user_id": user_id, "message_id": message_id},
    )


def message_attachment_response(row):
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


def message_unread_counts(conn, *, user_id: int) -> dict:
    direct_unread_count = conn.execute(
        text(
            """
            select count(*) as n
            from direct_messages
            where recipient_id = :user_id
              and is_read = false
              and deleted_at is null
              and not exists (
                select 1
                from message_hidden_entries hidden
                where hidden.user_id = :user_id
                  and hidden.direct_message_id = direct_messages.id
              )
            """
        ),
        {"user_id": user_id},
    ).scalar_one()
    group_unread_count = conn.execute(
        text(
            """
            select count(*) as n
            from group_messages gm
            join message_group_members mgm
              on mgm.group_id = gm.group_id
             and mgm.user_id = :user_id
            left join group_message_reads gmr
              on gmr.group_id = gm.group_id
             and gmr.user_id = :user_id
            where gm.sender_id <> :user_id
              and gm.created_at >= mgm.joined_at
              and gm.id > coalesce(gmr.last_read_message_id, 0)
              and gm.deleted_at is null
              and not exists (
                select 1
                from message_hidden_entries hidden
                where hidden.user_id = :user_id
                  and hidden.group_message_id = gm.id
              )
            """
        ),
        {"user_id": user_id},
    ).scalar_one()
    direct_count = int(direct_unread_count or 0)
    group_count = int(group_unread_count or 0)
    return {
        "unread_count": direct_count + group_count,
        "direct_unread_count": direct_count,
        "group_unread_count": group_count,
    }


def message_activity_snapshot(conn, *, user_id: int, conversation_type: str | None = None, conversation_id: int | None = None) -> dict:
    direct_activity = conn.execute(
        text(
            """
            select
              coalesce(max(id), 0) as max_id,
              max(greatest(
                created_at,
                coalesce(edited_at, created_at),
                coalesce(deleted_at, created_at)
              )) as changed_at
            from direct_messages dm
            where (sender_id = :user_id or recipient_id = :user_id)
              and not exists (
                select 1
                from message_hidden_entries hidden
                where hidden.user_id = :user_id
                  and hidden.direct_message_id = dm.id
              )
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    group_activity = conn.execute(
        text(
            """
            select
              coalesce(max(gm.id), 0) as max_id,
              max(greatest(
                gm.created_at,
                coalesce(gm.edited_at, gm.created_at),
                coalesce(gm.deleted_at, gm.created_at)
              )) as changed_at
            from group_messages gm
            join message_group_members mgm
              on mgm.group_id = gm.group_id
             and mgm.user_id = :user_id
            where gm.created_at >= mgm.joined_at
              and not exists (
                select 1
                from message_hidden_entries hidden
                where hidden.user_id = :user_id
                  and hidden.group_message_id = gm.id
              )
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    typing_rows = []
    if conversation_type and conversation_id:
        typing_rows = conn.execute(
            text(
                """
                select u.id, u.username, mts.updated_at, mts.expires_at
                from message_typing_states mts
                join users u on u.id = mts.user_id
                where mts.conversation_type = :conversation_type
                  and mts.conversation_id = :conversation_id
                  and mts.user_id <> :user_id
                  and mts.expires_at > now()
                order by mts.updated_at desc
                limit 12
                """
            ),
            {
                "user_id": user_id,
                "conversation_type": normalize_conversation_type(conversation_type).upper(),
                "conversation_id": conversation_id,
            },
        ).mappings().all()
    return {
        "direct": dict(direct_activity or {}),
        "group": dict(group_activity or {}),
        "typing": [dict(row) for row in typing_rows],
    }


def message_reaction_summary(conn, *, conversation_type: str, message_id: int, user_id: int) -> list[dict]:
    column = "direct_message_id" if conversation_type == "direct" else "group_message_id"
    rows = conn.execute(
        text(
            f"""
            select
              emoji,
              count(*) as count,
              bool_or(user_id = :user_id) as reacted_by_me
            from message_reactions
            where {column} = :message_id
            group by emoji
            order by count(*) desc, emoji asc
            """
        ),
        {"message_id": message_id, "user_id": user_id},
    ).mappings().all()
    return [
        {
            "emoji": row["emoji"],
            "count": int(row["count"] or 0),
            "reacted_by_me": bool(row["reacted_by_me"]),
        }
        for row in rows
    ]


def sql_id_placeholders(prefix: str, values: list[int]) -> tuple[str, dict]:
    params = {f"{prefix}_{idx}": value for idx, value in enumerate(values)}
    placeholders = ", ".join(f":{prefix}_{idx}" for idx in range(len(values)))
    return placeholders, params


def message_row_conversation_type(row: dict) -> str:
    value = str(row.get("message_type") or row.get("attachment_scope") or "").strip().lower()
    if value in {"direct", "group"}:
        return value
    return "group" if row.get("group_id") is not None else "direct"


def hydrate_message_rows(conn, rows, *, user_id: int) -> list[dict]:
    hydrated = [dict(row) for row in rows]
    if not hydrated:
        return []

    direct_ids: list[int] = []
    group_ids: list[int] = []
    for row in hydrated:
        conversation_type = message_row_conversation_type(row)
        row["message_type"] = conversation_type
        row["attachment_scope"] = conversation_type
        row["reactions"] = []
        row["is_favorited"] = False
        if conversation_type == "group":
            group_ids.append(int(row["id"]))
            row["read_count"] = 0
            row["read_by_me"] = False
        else:
            direct_ids.append(int(row["id"]))

    reactions_by_key: dict[tuple[str, int], list[dict]] = {}
    favorites_by_key: set[tuple[str, int]] = set()
    reads_by_id: dict[int, dict] = {}

    def load_reactions(scope: str, ids: list[int]) -> None:
        if not ids:
            return
        column = "direct_message_id" if scope == "direct" else "group_message_id"
        placeholders, id_params = sql_id_placeholders(f"{scope}_reaction_id", ids)
        rows = conn.execute(
            text(
                f"""
                select
                  {column} as message_id,
                  emoji,
                  count(*) as count,
                  bool_or(user_id = :user_id) as reacted_by_me
                from message_reactions
                where {column} in ({placeholders})
                group by {column}, emoji
                order by count(*) desc, emoji asc
                """
            ),
            {"user_id": user_id, **id_params},
        ).mappings().all()
        for reaction in rows:
            reactions_by_key.setdefault((scope, int(reaction["message_id"])), []).append(
                {
                    "emoji": reaction["emoji"],
                    "count": int(reaction["count"] or 0),
                    "reacted_by_me": bool(reaction["reacted_by_me"]),
                }
            )

    def load_favorites(scope: str, ids: list[int]) -> None:
        if not ids:
            return
        column = "direct_message_id" if scope == "direct" else "group_message_id"
        placeholders, id_params = sql_id_placeholders(f"{scope}_favorite_id", ids)
        rows = conn.execute(
            text(
                f"""
                select {column} as message_id
                from message_favorites
                where user_id = :user_id
                  and {column} in ({placeholders})
                """
            ),
            {"user_id": user_id, **id_params},
        ).mappings().all()
        favorites_by_key.update((scope, int(row["message_id"])) for row in rows)

    load_reactions("direct", direct_ids)
    load_reactions("group", group_ids)
    load_favorites("direct", direct_ids)
    load_favorites("group", group_ids)

    if group_ids:
        placeholders, id_params = sql_id_placeholders("group_read_id", group_ids)
        read_rows = conn.execute(
            text(
                f"""
                select
                  group_message_id as message_id,
                  count(*) as read_count,
                  max(read_at) as last_read_at,
                  bool_or(user_id = :user_id) as read_by_me
                from group_message_read_receipts
                where group_message_id in ({placeholders})
                group by group_message_id
                """
            ),
            {"user_id": user_id, **id_params},
        ).mappings().all()
        reads_by_id = {
            int(row["message_id"]): {
                "read_count": int(row["read_count"] or 0),
                "last_read_at": row["last_read_at"],
                "read_by_me": bool(row["read_by_me"]),
            }
            for row in read_rows
        }

    for row in hydrated:
        conversation_type = message_row_conversation_type(row)
        message_id = int(row["id"])
        row["reactions"] = reactions_by_key.get((conversation_type, message_id), [])
        row["is_favorited"] = (conversation_type, message_id) in favorites_by_key
        if conversation_type == "group":
            row.update(reads_by_id.get(message_id, {}))
    return hydrated


def json_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str, ensure_ascii=False)}\n\n"


@router.get("/api/messages/unread-count")
def direct_message_unread_count(user=Depends(require_user)):
    with engine.connect() as conn:
        return message_unread_counts(conn, user_id=user["id"])


@router.get("/api/messages/events")
async def message_events(
    request: Request,
    conversation_type: str | None = None,
    conversation_id: int | None = None,
    user=Depends(require_user),
):
    normalized_type = normalize_conversation_type(conversation_type) if conversation_type else None
    normalized_id = int(conversation_id or 0) if conversation_id else None
    if normalized_type == "direct" and normalized_id == int(user["id"]):
        raise HTTPException(status_code=400, detail="Cannot watch a self conversation")

    async def event_stream():
        last_signature = ""
        while True:
            if await request.is_disconnected():
                break
            with engine.begin() as conn:
                touch_user_presence(conn, user["id"])
                payload = {
                    "unread": message_unread_counts(conn, user_id=user["id"]),
                    "activity": message_activity_snapshot(
                        conn,
                        user_id=user["id"],
                        conversation_type=normalized_type,
                        conversation_id=normalized_id,
                    ),
                }
            signature = json.dumps(payload, default=str, sort_keys=True)
            if signature != last_signature:
                last_signature = signature
                yield json_event("message-state", payload)
            else:
                yield json_event("heartbeat", {"ok": True})
            await asyncio.sleep(MESSAGE_EVENT_POLL_SECONDS)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/api/messages/presence/heartbeat")
def update_message_presence(user=Depends(require_user)):
    with engine.begin() as conn:
        touch_user_presence(conn, user["id"])
        row = conn.execute(
            text("select last_seen_at from users where id = :user_id"),
            {"user_id": user["id"]},
        ).mappings().first()
    return {"ok": True, **presence_payload(row)}


@router.get("/api/messages/preferences")
def get_my_message_preferences(user=Depends(require_user)):
    with engine.connect() as conn:
        return {"preferences": get_user_message_preferences(conn, user_id=user["id"])}


@router.patch("/api/messages/preferences")
def update_my_message_preferences(payload: dict, user=Depends(require_user)):
    dm_policy = normalize_dm_policy(payload.get("dm_policy")) if "dm_policy" in payload else None
    allow_group_invites = normalize_optional_bool(payload.get("allow_group_invites")) if "allow_group_invites" in payload else None
    dnd_start_time = normalize_optional_time(payload.get("dnd_start_time")) if "dnd_start_time" in payload else None
    dnd_end_time = normalize_optional_time(payload.get("dnd_end_time")) if "dnd_end_time" in payload else None
    with engine.begin() as conn:
        current = get_user_message_preferences(conn, user_id=user["id"])
        row = conn.execute(
            text(
                """
                insert into user_message_preferences(
                  user_id, dm_policy, allow_group_invites, dnd_start_time, dnd_end_time, updated_at
                )
                values (:user_id, :dm_policy, :allow_group_invites, :dnd_start_time, :dnd_end_time, now())
                on conflict (user_id) do update
                set dm_policy = excluded.dm_policy,
                    allow_group_invites = excluded.allow_group_invites,
                    dnd_start_time = excluded.dnd_start_time,
                    dnd_end_time = excluded.dnd_end_time,
                    updated_at = now()
                returning dm_policy, allow_group_invites, dnd_start_time, dnd_end_time, updated_at
                """
            ),
            {
                "user_id": user["id"],
                "dm_policy": dm_policy or current["dm_policy"],
                "allow_group_invites": current["allow_group_invites"] if allow_group_invites is None else allow_group_invites,
                "dnd_start_time": dnd_start_time if "dnd_start_time" in payload else current["dnd_start_time"],
                "dnd_end_time": dnd_end_time if "dnd_end_time" in payload else current["dnd_end_time"],
            },
        ).mappings().first()
    return {"ok": True, "preferences": dict(row)}


@router.post("/api/messages/typing")
def update_message_typing(payload: dict, user=Depends(require_user)):
    conversation_type = normalize_conversation_type(payload.get("conversation_type"))
    conversation_id = int(payload.get("conversation_id") or 0)
    if conversation_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid conversation id")
    with engine.begin() as conn:
        touch_user_presence(conn, user["id"])
        if conversation_type == "group":
            get_group_membership(conn, group_id=conversation_id, user_id=user["id"])
        else:
            if conversation_id == int(user["id"]):
                raise HTTPException(status_code=400, detail="Cannot type in a self conversation")
            peer = conn.execute(text("select id from users where id = :peer_id"), {"peer_id": conversation_id}).first()
            if not peer:
                raise HTTPException(status_code=404, detail="User not found")
        conn.execute(
            text(
                """
                insert into message_typing_states(user_id, conversation_type, conversation_id, updated_at, expires_at)
                values (:user_id, :conversation_type, :conversation_id, now(), now() + (:ttl * interval '1 second'))
                on conflict (user_id, conversation_type, conversation_id) do update
                set updated_at = now(),
                    expires_at = now() + (:ttl * interval '1 second')
                """
            ),
            {
                "user_id": user["id"],
                "conversation_type": conversation_type.upper(),
                "conversation_id": conversation_id,
                "ttl": MESSAGE_TYPING_TTL_SECONDS,
            },
        )
    return {"ok": True, "expires_in_seconds": MESSAGE_TYPING_TTL_SECONDS}


@router.get("/api/messages/users")
def search_message_users(q: str = "", limit: int = 20, user=Depends(require_user)):
    limit = clamp_limit(limit, default=20, max_value=50)
    query = str(q or "").strip()
    params = {"user_id": user["id"], "limit": limit}
    where_query = ""
    if query:
        where_query = "and u.username ilike :query"
        params["query"] = f"%{query}%"

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select u.id, u.username, u.role, u.avatar_object_key, u.avatar_updated_at, u.last_seen_at
                from users u
                where u.id <> :user_id
                  and coalesce(u.is_disabled, false) = false
                  and not exists (
                    select 1
                    from user_message_blocks umb
                    where umb.blocker_id = :user_id
                      and umb.blocked_user_id = u.id
                  )
                  and not exists (
                    select 1
                    from user_message_blocks umb
                    where umb.blocker_id = u.id
                      and umb.blocked_user_id = :user_id
                  )
                  {where_query}
                order by u.username asc, u.id asc
                limit :limit
                """
            ),
            params,
        ).mappings().all()
    return {"items": [serialize_user(row) for row in rows]}


@router.get("/api/messages/conversations")
def list_message_conversations(limit: int = 50, offset: int = 0, q: str = "", include_archived: bool = False, user=Depends(require_user)):
    limit = clamp_limit(limit, default=50, max_value=200)
    offset = normalize_offset(offset)
    query = str(q or "").strip()
    params = {"user_id": user["id"], "limit": limit + 1, "offset": offset}
    direct_search_filter = ""
    group_search_filter = ""
    archived_filter = "where coalesce(is_archived, false) = false"
    if include_archived:
        archived_filter = ""
    if query:
        params["query"] = f"%{query}%"
        direct_search_filter = "and (u.username ilike :query or contact_remark.remark_name ilike :query)"
        group_search_filter = "and g.name ilike :query"
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                with direct_rows as (
                  with scoped as (
                    select
                      dm.*,
                      case
                        when dm.sender_id = :user_id then dm.recipient_id
                        else dm.sender_id
                      end as peer_id
                    from direct_messages dm
                    where (
                        dm.sender_id = :user_id
                        or dm.recipient_id = :user_id
                      )
                      and {message_hidden_filter_sql("dm", scope="direct")}
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
                    select dm.sender_id as peer_id, count(*) as unread_count
                    from direct_messages dm
                    where dm.recipient_id = :user_id
                      and dm.is_read = false
                      and dm.deleted_at is null
                      and {message_hidden_filter_sql("dm", scope="direct")}
                    group by dm.sender_id
                  )
                  select
                    'direct' as conversation_type,
                    ('direct:' || ranked.peer_id::text) as conversation_key,
                    ranked.peer_id,
                    u.username as peer_username,
                    contact_remark.remark_name as peer_remark_name,
                    u.role as peer_role,
                    u.avatar_object_key as peer_avatar_object_key,
                    u.avatar_updated_at as peer_avatar_updated_at,
                    u.last_seen_at as peer_last_seen_at,
                    null::bigint as group_id,
                    null::text as group_name,
                    null::bigint as group_owner_id,
                    null::bigint as group_member_count,
                    ranked.id as last_message_id,
                    ranked.sender_id as last_sender_id,
                    sender_user.username as last_sender_username,
                    null::text as last_sender_group_nickname,
                    ranked.recipient_id as last_recipient_id,
                    ranked.body_md as last_body_md,
                    (ranked.attachment_object_key is not null and ranked.deleted_at is null) as last_has_attachment,
                    ranked.attachment_content_type as last_attachment_content_type,
                    ranked.attachment_filename as last_attachment_filename,
                    ranked.attachment_size_bytes as last_attachment_size_bytes,
                    ranked.is_read as last_is_read,
                    ranked.created_at as last_created_at,
                    ranked.read_at as last_read_at,
                    ranked.deleted_at as last_deleted_at,
                    coalesce(unread.unread_count, 0) as unread_count,
                    ranked.created_at as sort_at,
                    ranked.id as sort_id,
                    coalesce(prefs.is_pinned, false) as is_pinned,
                    prefs.pinned_at,
                    coalesce(prefs.is_archived, false) as is_archived,
                    prefs.archived_at,
                    coalesce(prefs.is_muted, false) as is_muted,
                    prefs.muted_at
                  from ranked
                  join users u on u.id = ranked.peer_id
                  join users sender_user on sender_user.id = ranked.sender_id
                  left join message_contact_remarks contact_remark
                    on contact_remark.user_id = :user_id
                   and contact_remark.contact_user_id = ranked.peer_id
                  left join unread on unread.peer_id = ranked.peer_id
                  left join message_conversation_preferences prefs
                    on prefs.user_id = :user_id
                   and prefs.conversation_type = 'DIRECT'
                   and prefs.conversation_id = ranked.peer_id
                  where ranked.rn = 1
                    {direct_search_filter}
                ),
                group_rows as (
                  with my_groups as (
                    select
                      g.id,
                      g.name,
                      g.owner_id,
                      g.created_at,
                      g.updated_at,
                      mgm.joined_at,
                      (
                        select count(*)
                        from message_group_members members
                        where members.group_id = g.id
                      ) as member_count
                    from message_groups g
                    join message_group_members mgm on mgm.group_id = g.id
                    where mgm.user_id = :user_id
                  ),
                  unread as (
                    select gm.group_id, count(*) as unread_count
                    from group_messages gm
                    join message_group_members mgm
                      on mgm.group_id = gm.group_id
                     and mgm.user_id = :user_id
                    left join group_message_reads gmr
                      on gmr.group_id = gm.group_id
                     and gmr.user_id = :user_id
                    where gm.sender_id <> :user_id
                      and gm.created_at >= mgm.joined_at
                      and gm.id > coalesce(gmr.last_read_message_id, 0)
                      and gm.deleted_at is null
                      and {message_hidden_filter_sql("gm", scope="group")}
                    group by gm.group_id
                  )
                  select
                    'group' as conversation_type,
                    ('group:' || g.id::text) as conversation_key,
                    null::bigint as peer_id,
                    null::text as peer_username,
                    null::text as peer_remark_name,
                    null::text as peer_role,
                    null::text as peer_avatar_object_key,
                    null::timestamptz as peer_avatar_updated_at,
                    null::timestamptz as peer_last_seen_at,
                    g.id as group_id,
                    g.name as group_name,
                    g.owner_id as group_owner_id,
                    g.member_count as group_member_count,
                    last_message.id as last_message_id,
                    last_message.sender_id as last_sender_id,
                    sender_user.username as last_sender_username,
                    coalesce(nullif(btrim(sender_member.group_nickname), ''), sender_user.username) as last_sender_group_nickname,
                    null::bigint as last_recipient_id,
                    last_message.body_md as last_body_md,
                    (last_message.attachment_object_key is not null and last_message.deleted_at is null) as last_has_attachment,
                    last_message.attachment_content_type as last_attachment_content_type,
                    last_message.attachment_filename as last_attachment_filename,
                    last_message.attachment_size_bytes as last_attachment_size_bytes,
                    null::boolean as last_is_read,
                    last_message.created_at as last_created_at,
                    null::timestamptz as last_read_at,
                    last_message.deleted_at as last_deleted_at,
                    coalesce(unread.unread_count, 0) as unread_count,
                    coalesce(last_message.created_at, g.created_at) as sort_at,
                    coalesce(last_message.id, 0) as sort_id,
                    coalesce(prefs.is_pinned, false) as is_pinned,
                    prefs.pinned_at,
                    coalesce(prefs.is_archived, false) as is_archived,
                    prefs.archived_at,
                    coalesce(prefs.is_muted, false) as is_muted,
                    prefs.muted_at
                  from my_groups g
                  left join lateral (
                    select gm.*
                    from group_messages gm
                    where gm.group_id = g.id
                      and gm.created_at >= g.joined_at
                      and {message_hidden_filter_sql("gm", scope="group")}
                    order by gm.created_at desc, gm.id desc
                    limit 1
                  ) last_message on true
                  left join users sender_user on sender_user.id = last_message.sender_id
                  left join message_group_members sender_member
                    on sender_member.group_id = g.id
                   and sender_member.user_id = last_message.sender_id
                  left join unread on unread.group_id = g.id
                  left join message_conversation_preferences prefs
                    on prefs.user_id = :user_id
                   and prefs.conversation_type = 'GROUP'
                   and prefs.conversation_id = g.id
                  where true
                    {group_search_filter}
                )
                select *
                from (
                  select * from direct_rows
                  union all
                  select * from group_rows
                ) conversations
                {archived_filter}
                order by
                  coalesce(is_pinned, false) desc,
                  pinned_at desc nulls last,
                  sort_at desc,
                  sort_id desc
                limit :limit
                offset :offset
                """
            ),
            params,
        ).mappings().all()
    page_rows = list(rows)[:limit]
    return {
        "items": [serialize_conversation_row(row) for row in page_rows],
        "has_more": len(rows) > limit,
        "next_offset": offset + len(page_rows),
    }


@router.get("/api/messages/conversations/{peer_id}")
def get_message_conversation(
    peer_id: int,
    limit: int = 100,
    before_id: int | None = None,
    user=Depends(require_user),
):
    if peer_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot open a conversation with yourself")

    limit = clamp_limit(limit, default=100, max_value=200)
    before_id = normalize_message_cursor(before_id)
    with engine.begin() as conn:
        peer = conn.execute(
            text(
                """
                select
                  u.id,
                  u.username,
                  u.role,
                  u.avatar_object_key,
                  u.avatar_updated_at,
                  u.last_seen_at,
                  coalesce(u.is_disabled, false) as is_disabled,
                  contact_remark.remark_name as peer_remark_name,
                  contact_remark.updated_at as peer_remark_updated_at
                from users u
                left join message_contact_remarks contact_remark
                  on contact_remark.user_id = :user_id
                 and contact_remark.contact_user_id = u.id
                where u.id = :peer_id
                """
            ),
            {"peer_id": peer_id, "user_id": user["id"]},
        ).mappings().first()
        if not peer:
            raise HTTPException(status_code=404, detail="User not found")
        block_state = get_user_block_state(conn, current_user_id=user["id"], other_user_id=peer_id)
        peer_message_preferences = get_user_message_preferences(conn, user_id=peer_id)
        preferences = get_conversation_preferences(conn, user_id=user["id"], conversation_type="direct", conversation_id=peer_id)
        peer_payload = apply_contact_remark_payload(
            apply_conversation_preferences_payload(serialize_user(peer), preferences),
            remark_name=peer.get("peer_remark_name"),
        )
        peer_payload["peer_remark_updated_at"] = peer.get("peer_remark_updated_at")
        peer_payload.update(block_state)
        peer_payload.update(presence_payload(peer))
        peer_payload["can_message"] = not (
            block_state["is_blocked_by_me"]
            or block_state["has_blocked_me"]
            or peer_message_preferences["dm_policy"] == "NOBODY"
        )

        params = {"user_id": user["id"], "peer_id": peer_id, "limit": limit + 1}
        before_filter = ""
        if before_id is not None:
            anchor = conn.execute(
                text(
                    f"""
                    select created_at
                    from direct_messages
                    where id = :before_id
                      and (
                        (sender_id = :user_id and recipient_id = :peer_id)
                        or (sender_id = :peer_id and recipient_id = :user_id)
                      )
                      and {message_hidden_filter_sql("direct_messages", scope="direct")}
                    """
                ),
                {"user_id": user["id"], "peer_id": peer_id, "before_id": before_id},
            ).mappings().first()
            if not anchor:
                return {"peer": peer_payload, "items": [], "has_more": False, "first_unread_message_id": None}
            params["before_id"] = before_id
            params["before_created_at"] = anchor["created_at"]
            before_filter = """
                  and (
                    dm.created_at < :before_created_at
                    or (dm.created_at = :before_created_at and dm.id < :before_id)
                  )
            """

        rows = conn.execute(
            text(
                f"""
                select *
                from (
                  select
                    dm.id,
                    'direct' as message_type,
                    'direct' as attachment_scope,
                    dm.sender_id,
                    su.username as sender_username,
                    sender_contact_remark.remark_name as sender_remark_name,
                    su.avatar_object_key as sender_avatar_object_key,
                    su.avatar_updated_at as sender_avatar_updated_at,
                    dm.recipient_id,
                    ru.username as recipient_username,
                    recipient_contact_remark.remark_name as recipient_remark_name,
                    ru.avatar_object_key as recipient_avatar_object_key,
                    ru.avatar_updated_at as recipient_avatar_updated_at,
                    dm.body_md,
                    dm.reply_to_message_id,
                    (dm.attachment_object_key is not null and dm.deleted_at is null) as has_attachment,
                    case when dm.attachment_object_key is not null and dm.deleted_at is null then dm.id end as attachment_id,
                    dm.attachment_content_type,
                    dm.attachment_filename,
                    dm.attachment_size_bytes,
                    dm.attachment_scan_status,
                    dm.attachment_thumbnail_object_key,
                    dm.is_read,
                    dm.delivered_at,
                    dm.created_at,
                    dm.read_at,
                    dm.edited_at,
                    dm.deleted_at,
                    dm.deleted_by_user_id,
                    reply.body_md as reply_to_body_md,
                    (reply.attachment_object_key is not null and reply.deleted_at is null) as reply_to_has_attachment,
                    reply.attachment_content_type as reply_to_attachment_content_type,
                    reply.attachment_filename as reply_to_attachment_filename,
                    reply.deleted_at as reply_to_deleted_at,
                    reply_sender.username as reply_to_sender_username
                  from direct_messages dm
                  join users su on su.id = dm.sender_id
                  join users ru on ru.id = dm.recipient_id
                  left join message_contact_remarks sender_contact_remark
                    on sender_contact_remark.user_id = :user_id
                   and sender_contact_remark.contact_user_id = dm.sender_id
                  left join message_contact_remarks recipient_contact_remark
                    on recipient_contact_remark.user_id = :user_id
                   and recipient_contact_remark.contact_user_id = dm.recipient_id
                  left join direct_messages reply on reply.id = dm.reply_to_message_id
                  left join users reply_sender on reply_sender.id = reply.sender_id
                  where (
                    (dm.sender_id = :user_id and dm.recipient_id = :peer_id)
                    or (dm.sender_id = :peer_id and dm.recipient_id = :user_id)
                  )
                  and {message_hidden_filter_sql("dm", scope="direct")}
                  {before_filter}
                  order by dm.created_at desc, dm.id desc
                  limit :limit
                ) recent
                order by created_at asc, id asc
                """
            ),
            params,
        ).mappings().all()

        trimmed_rows = trim_message_page(rows, limit)
        first_unread_message_id = None
        if before_id is None:
            unread_row = next(
                (
                    row
                    for row in trimmed_rows
                    if int(row["sender_id"]) == int(peer_id) and not bool(row["is_read"])
                ),
                None,
            )
            first_unread_message_id = int(unread_row["id"]) if unread_row else None
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

    with engine.connect() as conn:
        message_rows = hydrate_message_rows(conn, trimmed_rows, user_id=user["id"])

    return {
        "peer": peer_payload,
        "items": [serialize_message_row(row) for row in message_rows],
        "has_more": len(rows) > limit,
        "first_unread_message_id": first_unread_message_id,
    }


@router.post("/api/messages")
def send_direct_message(payload: dict, request: Request, user=Depends(require_user)):
    check_rate_limit(client_key(request, "message", str(user["id"])), max_calls=120, window_seconds=3600)
    body = normalize_message_body(payload.get("body_md") or payload.get("body"))
    recipient_id = payload.get("recipient_id")
    recipient_key = str(payload.get("recipient_username") or payload.get("recipient") or "").strip()
    reply_to_message_id = payload.get("reply_to_message_id")

    with engine.begin() as conn:
        recipient = resolve_recipient(
            conn,
            current_user_id=user["id"],
            recipient_id=recipient_id,
            recipient_key=recipient_key,
        )
        require_direct_message_allowed(conn, current_user_id=user["id"], other_user_id=recipient["id"])
        reply_target_id = resolve_direct_reply_target(
            conn,
            current_user_id=user["id"],
            peer_id=recipient["id"],
            reply_to_message_id=reply_to_message_id,
        )
        row = conn.execute(
            text(
                """
                with inserted as (
                  insert into direct_messages(sender_id, recipient_id, body_md, reply_to_message_id)
                  values (:sender_id, :recipient_id, :body_md, :reply_to_message_id)
                  returning id, sender_id, recipient_id, body_md, reply_to_message_id,
                            false as has_attachment,
                            null::bigint as attachment_id,
                            attachment_content_type, attachment_filename, attachment_size_bytes,
                            attachment_scan_status, attachment_thumbnail_object_key,
                            is_read, delivered_at, created_at, read_at, edited_at, deleted_at, deleted_by_user_id
                )
                select
                  inserted.id,
                  'direct' as message_type,
                  'direct' as attachment_scope,
                  inserted.sender_id,
                  su.username as sender_username,
                  su.avatar_object_key as sender_avatar_object_key,
                  su.avatar_updated_at as sender_avatar_updated_at,
                  inserted.recipient_id,
                  ru.username as recipient_username,
                  ru.avatar_object_key as recipient_avatar_object_key,
                  ru.avatar_updated_at as recipient_avatar_updated_at,
                  inserted.body_md,
                  inserted.reply_to_message_id,
                  inserted.has_attachment,
                  inserted.attachment_id,
                  inserted.attachment_content_type,
                  inserted.attachment_filename,
                  inserted.attachment_size_bytes,
                  inserted.attachment_scan_status,
                  inserted.attachment_thumbnail_object_key,
                  inserted.is_read,
                  inserted.delivered_at,
                  inserted.created_at,
                  inserted.read_at,
                  inserted.edited_at,
                  inserted.deleted_at,
                  inserted.deleted_by_user_id,
                  reply.body_md as reply_to_body_md,
                  (reply.attachment_object_key is not null and reply.deleted_at is null) as reply_to_has_attachment,
                  reply.attachment_content_type as reply_to_attachment_content_type,
                  reply.attachment_filename as reply_to_attachment_filename,
                  reply.deleted_at as reply_to_deleted_at,
                  reply_sender.username as reply_to_sender_username
                from inserted
                join users su on su.id = inserted.sender_id
                join users ru on ru.id = inserted.recipient_id
                left join direct_messages reply on reply.id = inserted.reply_to_message_id
                left join users reply_sender on reply_sender.id = reply.sender_id
                """
            ),
            {
                "sender_id": user["id"],
                "recipient_id": recipient["id"],
                "body_md": body,
                "reply_to_message_id": reply_target_id,
            },
        ).mappings().first()
        message_row = hydrate_message_rows(conn, [row], user_id=user["id"])[0]

    return {"ok": True, "message": serialize_message_row(message_row), "peer": recipient}


@router.post("/api/messages/groups")
def create_message_group(payload: dict, request: Request, user=Depends(require_user)):
    check_rate_limit(client_key(request, "message-group", str(user["id"])), max_calls=30, window_seconds=3600)
    name = normalize_group_name(payload.get("name") or payload.get("group_name"))
    member_ids = payload.get("member_ids") or payload.get("members") or []

    with engine.begin() as conn:
        invited_members = resolve_group_members(conn, current_user_id=user["id"], member_ids=member_ids)
        group = conn.execute(
            text(
                """
                insert into message_groups(name, owner_id)
                values (:name, :owner_id)
                returning id, name, owner_id, created_at, updated_at
                """
            ),
            {"name": name, "owner_id": user["id"]},
        ).mappings().first()

        member_rows = [
            {
                "group_id": group["id"],
                "user_id": user["id"],
                "role": "OWNER",
                "group_nickname": user["username"],
            },
            *[
                {
                    "group_id": group["id"],
                    "user_id": member["id"],
                    "role": "MEMBER",
                    "group_nickname": member["username"],
                }
                for member in invited_members
            ],
        ]
        conn.execute(
            text(
                """
                insert into message_group_members(group_id, user_id, role, group_nickname)
                values (:group_id, :user_id, :role, :group_nickname)
                on conflict (group_id, user_id) do nothing
                """
            ),
            member_rows,
        )
        members = list_group_members(conn, group["id"])

    group_payload = build_group_payload(
        {**dict(group), "member_role": "OWNER", "group_nickname": user["username"]},
        members,
    )
    return {"ok": True, "group": group_payload}


@router.get("/api/messages/groups/{group_id}")
def get_group_message_conversation(
    group_id: int,
    limit: int = 100,
    before_id: int | None = None,
    user=Depends(require_user),
):
    limit = clamp_limit(limit, default=100, max_value=200)
    before_id = normalize_message_cursor(before_id)

    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        preferences = get_conversation_preferences(conn, user_id=user["id"], conversation_type="group", conversation_id=group_id)
        members = list_group_members(conn, group_id)
        last_read_message_id = int(
            conn.execute(
                text(
                    """
                    select last_read_message_id
                    from group_message_reads
                    where group_id = :group_id
                      and user_id = :user_id
                    """
                ),
                {"group_id": group_id, "user_id": user["id"]},
            ).scalar() or 0
        )

        params = {
            "group_id": group_id,
            "joined_at": group["joined_at"],
            "user_id": user["id"],
            "last_read_message_id": last_read_message_id,
            "limit": limit + 1,
        }
        before_filter = ""
        if before_id is not None:
            anchor = conn.execute(
                text(
                    f"""
                    select created_at
                    from group_messages
                    where id = :before_id
                      and group_id = :group_id
                      and created_at >= :joined_at
                      and {message_hidden_filter_sql("group_messages", scope="group")}
                    """
                ),
                {"group_id": group_id, "joined_at": group["joined_at"], "before_id": before_id},
            ).mappings().first()
            if not anchor:
                group_payload = apply_conversation_preferences_payload(build_group_payload(group, members), preferences)
                return {"group": group_payload, "items": [], "has_more": False, "first_unread_message_id": None}
            params["before_id"] = before_id
            params["before_created_at"] = anchor["created_at"]
            before_filter = """
                  and (
                    gm.created_at < :before_created_at
                    or (gm.created_at = :before_created_at and gm.id < :before_id)
                  )
            """

        rows = conn.execute(
            text(
                f"""
                select *
                from (
                  select
                    gm.id,
                    'group' as message_type,
                    'group' as attachment_scope,
                    gm.group_id,
                    gm.sender_id,
                    su.username as sender_username,
                    su.avatar_object_key as sender_avatar_object_key,
                    su.avatar_updated_at as sender_avatar_updated_at,
                    coalesce(nullif(btrim(mgm.group_nickname), ''), su.username) as sender_group_nickname,
                    null::bigint as recipient_id,
                    null::text as recipient_username,
                    null::text as recipient_avatar_object_key,
                    null::timestamptz as recipient_avatar_updated_at,
                    gm.body_md,
                    gm.reply_to_message_id,
                    (gm.attachment_object_key is not null and gm.deleted_at is null) as has_attachment,
                    case when gm.attachment_object_key is not null and gm.deleted_at is null then gm.id end as attachment_id,
                    gm.attachment_content_type,
                    gm.attachment_filename,
                    gm.attachment_size_bytes,
                    gm.attachment_scan_status,
                    gm.attachment_thumbnail_object_key,
                    null::boolean as is_read,
                    gm.delivered_at,
                    gm.created_at,
                    null::timestamptz as read_at,
                    gm.edited_at,
                    gm.deleted_at,
                    gm.deleted_by_user_id,
                    case
                      when gm.sender_id <> :user_id
                       and gm.id > :last_read_message_id
                      then true
                      else false
                    end as was_unread,
                    reply.body_md as reply_to_body_md,
                    (reply.attachment_object_key is not null and reply.deleted_at is null) as reply_to_has_attachment,
                    reply.attachment_content_type as reply_to_attachment_content_type,
                    reply.attachment_filename as reply_to_attachment_filename,
                    reply.deleted_at as reply_to_deleted_at,
                    reply_sender.username as reply_to_sender_username
                  from group_messages gm
                  join users su on su.id = gm.sender_id
                  left join message_group_members mgm
                    on mgm.group_id = gm.group_id
                   and mgm.user_id = gm.sender_id
                  left join group_messages reply on reply.id = gm.reply_to_message_id
                  left join users reply_sender on reply_sender.id = reply.sender_id
                  where gm.group_id = :group_id
                    and gm.created_at >= :joined_at
                    and {message_hidden_filter_sql("gm", scope="group")}
                  {before_filter}
                  order by gm.created_at desc, gm.id desc
                  limit :limit
                ) recent
                order by created_at asc, id asc
                """
            ),
            params,
        ).mappings().all()

    trimmed_rows = trim_message_page(rows, limit)
    with engine.connect() as conn:
        message_rows = hydrate_message_rows(conn, trimmed_rows, user_id=user["id"])
    first_unread_message_id = None
    if before_id is None:
        unread_row = next((row for row in trimmed_rows if bool(row.get("was_unread"))), None)
        first_unread_message_id = int(unread_row["id"]) if unread_row else None
        with engine.begin() as conn:
            mark_group_messages_read(
                conn,
                group_id=group_id,
                user_id=user["id"],
                joined_at=group["joined_at"],
            )

    group_payload = apply_conversation_preferences_payload(build_group_payload(group, members), preferences)
    return {
        "group": group_payload,
        "items": [serialize_message_row(row) for row in message_rows],
        "has_more": len(rows) > limit,
        "first_unread_message_id": first_unread_message_id,
    }


@router.get("/api/messages/search")
def search_messages(
    q: str,
    conversation_type: str,
    conversation_id: int,
    limit: int = 50,
    user=Depends(require_user),
):
    query = str(q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query is required")
    limit = clamp_limit(limit, default=50, max_value=100)
    normalized_type = normalize_conversation_type(conversation_type)
    if int(conversation_id or 0) <= 0:
        raise HTTPException(status_code=400, detail="Invalid conversation id")
    params = {
        "user_id": user["id"],
        "conversation_id": conversation_id,
        "query": f"%{query}%",
        "limit": limit,
    }
    with engine.connect() as conn:
        if normalized_type == "direct":
            if conversation_id == int(user["id"]):
                raise HTTPException(status_code=400, detail="Cannot search a self conversation")
            rows = conn.execute(
                text(
                    f"""
                    select
                      dm.id,
                      'direct' as message_type,
                      'direct' as attachment_scope,
                      dm.sender_id,
                      su.username as sender_username,
                      su.avatar_object_key as sender_avatar_object_key,
                      su.avatar_updated_at as sender_avatar_updated_at,
                      dm.recipient_id,
                      ru.username as recipient_username,
                      ru.avatar_object_key as recipient_avatar_object_key,
                      ru.avatar_updated_at as recipient_avatar_updated_at,
                      dm.body_md,
                      dm.reply_to_message_id,
                      (dm.attachment_object_key is not null and dm.deleted_at is null) as has_attachment,
                      case when dm.attachment_object_key is not null and dm.deleted_at is null then dm.id end as attachment_id,
                      dm.attachment_content_type,
                      dm.attachment_filename,
                      dm.attachment_size_bytes,
                      dm.attachment_scan_status,
                      dm.attachment_thumbnail_object_key,
                      dm.is_read,
                      dm.delivered_at,
                      dm.created_at,
                      dm.read_at,
                      dm.edited_at,
                      dm.deleted_at,
                      dm.deleted_by_user_id
                    from direct_messages dm
                    join users su on su.id = dm.sender_id
                    join users ru on ru.id = dm.recipient_id
                    where (
                        (dm.sender_id = :user_id and dm.recipient_id = :conversation_id)
                        or (dm.sender_id = :conversation_id and dm.recipient_id = :user_id)
                      )
                      and dm.deleted_at is null
                      and {message_hidden_filter_sql("dm", scope="direct")}
                      and (dm.body_md ilike :query or dm.attachment_filename ilike :query)
                    order by dm.created_at desc, dm.id desc
                    limit :limit
                    """
                ),
                params,
            ).mappings().all()
        else:
            group = get_group_membership(conn, group_id=conversation_id, user_id=user["id"])
            rows = conn.execute(
                text(
                    f"""
                    select
                      gm.id,
                      'group' as message_type,
                      'group' as attachment_scope,
                      gm.group_id,
                      gm.sender_id,
                      su.username as sender_username,
                      su.avatar_object_key as sender_avatar_object_key,
                      su.avatar_updated_at as sender_avatar_updated_at,
                      coalesce(nullif(btrim(mgm.group_nickname), ''), su.username) as sender_group_nickname,
                      null::bigint as recipient_id,
                      null::text as recipient_username,
                      null::text as recipient_avatar_object_key,
                      null::timestamptz as recipient_avatar_updated_at,
                      gm.body_md,
                      gm.reply_to_message_id,
                      (gm.attachment_object_key is not null and gm.deleted_at is null) as has_attachment,
                      case when gm.attachment_object_key is not null and gm.deleted_at is null then gm.id end as attachment_id,
                      gm.attachment_content_type,
                      gm.attachment_filename,
                      gm.attachment_size_bytes,
                      gm.attachment_scan_status,
                      gm.attachment_thumbnail_object_key,
                      null::boolean as is_read,
                      gm.delivered_at,
                      gm.created_at,
                      null::timestamptz as read_at,
                      gm.edited_at,
                      gm.deleted_at,
                      gm.deleted_by_user_id
                    from group_messages gm
                    join users su on su.id = gm.sender_id
                    left join message_group_members mgm
                      on mgm.group_id = gm.group_id
                     and mgm.user_id = gm.sender_id
                    where gm.group_id = :conversation_id
                      and gm.created_at >= :joined_at
                      and gm.deleted_at is null
                      and {message_hidden_filter_sql("gm", scope="group")}
                      and (gm.body_md ilike :query or gm.attachment_filename ilike :query)
                    order by gm.created_at desc, gm.id desc
                    limit :limit
                    """
                ),
                {**params, "joined_at": group["joined_at"]},
            ).mappings().all()
        message_rows = hydrate_message_rows(conn, rows, user_id=user["id"])
    return {"items": [serialize_message_row(row) for row in message_rows]}


@router.get("/api/messages/groups/{group_id}/members")
def get_message_group_members(group_id: int, user=Depends(require_user)):
    with engine.connect() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        members = list_group_members(conn, group_id)
        preferences = get_conversation_preferences(conn, user_id=user["id"], conversation_type="group", conversation_id=group_id)
    return {"group": apply_conversation_preferences_payload(build_group_payload(group, members), preferences), "items": members}


@router.get("/api/messages/groups/{group_id}/announcements")
def list_message_group_announcements(group_id: int, user=Depends(require_user)):
    with engine.connect() as conn:
        get_group_membership(conn, group_id=group_id, user_id=user["id"])
        rows = conn.execute(
            text(
                """
                select mga.*, u.username as author_username
                from message_group_announcements mga
                left join users u on u.id = mga.author_id
                where mga.group_id = :group_id
                order by mga.is_pinned desc, mga.created_at desc, mga.id desc
                """
            ),
            {"group_id": group_id},
        ).mappings().all()
    return {"items": [dict(row) for row in rows]}


@router.post("/api/messages/groups/{group_id}/announcements")
def create_message_group_announcement(group_id: int, payload: dict, user=Depends(require_user)):
    body = normalize_optional_message_body(payload.get("body_md") or payload.get("body"))
    if not body:
        raise HTTPException(status_code=400, detail="Announcement body is required")
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_manager(group)
        row = conn.execute(
            text(
                """
                insert into message_group_announcements(group_id, author_id, body_md, is_pinned)
                values (:group_id, :author_id, :body_md, :is_pinned)
                returning *
                """
            ),
            {
                "group_id": group_id,
                "author_id": user["id"],
                "body_md": body,
                "is_pinned": normalize_optional_bool(payload.get("is_pinned")) if "is_pinned" in payload else True,
            },
        ).mappings().first()
    return {"ok": True, "announcement": dict(row)}


@router.delete("/api/messages/groups/{group_id}/announcements/{announcement_id}")
def delete_message_group_announcement(group_id: int, announcement_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_manager(group)
        result = conn.execute(
            text(
                """
                delete from message_group_announcements
                where id = :announcement_id
                  and group_id = :group_id
                """
            ),
            {"announcement_id": announcement_id, "group_id": group_id},
        )
    return {"ok": True, "deleted": int(result.rowcount or 0) > 0}


@router.post("/api/messages/groups/{group_id}/invites")
def create_message_group_invite(group_id: int, payload: dict, user=Depends(require_user)):
    max_uses = payload.get("max_uses")
    if max_uses not in (None, ""):
        max_uses = int(max_uses)
        if max_uses <= 0:
            raise HTTPException(status_code=400, detail="max_uses must be positive")
    else:
        max_uses = None
    expires_minutes = payload.get("expires_minutes")
    if expires_minutes not in (None, ""):
        expires_minutes = max(1, min(int(expires_minutes), 60 * 24 * 30))
    else:
        expires_minutes = None
    invite_code = secrets.token_urlsafe(18)
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_manager(group)
        row = conn.execute(
            text(
                """
                insert into message_group_invites(
                  group_id, invite_code, created_by_user_id, expires_at, max_uses
                )
                values (
                  :group_id,
                  :invite_code,
                  :created_by_user_id,
                  case when :expires_minutes is null then null else now() + (:expires_minutes * interval '1 minute') end,
                  :max_uses
                )
                returning *
                """
            ),
            {
                "group_id": group_id,
                "invite_code": invite_code,
                "created_by_user_id": user["id"],
                "expires_minutes": expires_minutes,
                "max_uses": max_uses,
            },
        ).mappings().first()
    return {"ok": True, "invite": dict(row)}


@router.post("/api/messages/group-invites/join")
def join_message_group_by_invite(payload: dict, user=Depends(require_user)):
    invite_code = str(payload.get("invite_code") or "").strip()
    if not invite_code:
        raise HTTPException(status_code=400, detail="Invite code is required")
    with engine.begin() as conn:
        prefs = get_user_message_preferences(conn, user_id=user["id"])
        if not prefs["allow_group_invites"]:
            raise HTTPException(status_code=403, detail="You disabled group invites")
        invite = conn.execute(
            text(
                """
                select *
                from message_group_invites
                where invite_code = :invite_code
                  and is_revoked = false
                  and (expires_at is null or expires_at > now())
                  and (max_uses is null or use_count < max_uses)
                """
            ),
            {"invite_code": invite_code},
        ).mappings().first()
        if not invite:
            raise HTTPException(status_code=404, detail="Invite is invalid or expired")
        existing_count = conn.execute(
            text("select count(*) from message_group_members where group_id = :group_id"),
            {"group_id": invite["group_id"]},
        ).scalar_one()
        if int(existing_count or 0) >= MAX_GROUP_MEMBERS:
            raise HTTPException(status_code=400, detail=f"Group can have at most {MAX_GROUP_MEMBERS} members")
        conn.execute(
            text(
                """
                insert into message_group_members(group_id, user_id, role, group_nickname)
                values (:group_id, :user_id, 'MEMBER', :group_nickname)
                on conflict (group_id, user_id) do nothing
                """
            ),
            {"group_id": invite["group_id"], "user_id": user["id"], "group_nickname": user["username"]},
        )
        conn.execute(
            text("update message_group_invites set use_count = use_count + 1 where id = :id"),
            {"id": invite["id"]},
        )
        group = get_group_membership(conn, group_id=invite["group_id"], user_id=user["id"])
        members = list_group_members(conn, invite["group_id"])
    return {"ok": True, "group": build_group_payload(group, members)}


@router.patch("/api/messages/groups/{group_id}")
def update_message_group(group_id: int, payload: dict, user=Depends(require_user)):
    raw_name = payload.get("name")
    if raw_name is None:
        raw_name = payload.get("group_name")
    raw_nickname = payload.get("group_nickname")
    if raw_nickname is None:
        raw_nickname = payload.get("nickname")

    has_name = raw_name is not None
    has_nickname = raw_nickname is not None
    if not has_name and not has_nickname:
        raise HTTPException(status_code=400, detail="Nothing to update")

    name = normalize_group_name(raw_name) if has_name else None
    group_nickname = normalize_group_nickname(raw_nickname, allow_empty=True) if has_nickname else None
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        if has_name:
            require_group_owner(group)
            conn.execute(
                text(
                    """
                    update message_groups
                    set name = :name,
                        updated_at = now()
                    where id = :group_id
                    """
                ),
                {"group_id": group_id, "name": name},
            )
        if has_nickname:
            conn.execute(
                text(
                    """
                    update message_group_members
                    set group_nickname = :group_nickname
                    where group_id = :group_id
                      and user_id = :user_id
                    """
                ),
                {"group_id": group_id, "user_id": user["id"], "group_nickname": group_nickname},
            )
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        members = list_group_members(conn, group_id)
    return {"ok": True, "group": build_group_payload(group, members)}


@router.post("/api/messages/groups/{group_id}/members")
def add_message_group_members(group_id: int, payload: dict, user=Depends(require_user)):
    member_ids = payload.get("member_ids") or payload.get("members") or []
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_owner(group)
        invited_members = resolve_group_members(conn, current_user_id=user["id"], member_ids=member_ids)
        existing_ids = {
            int(row["user_id"])
            for row in conn.execute(
                text("select user_id from message_group_members where group_id = :group_id"),
                {"group_id": group_id},
            ).mappings().all()
        }
        new_members = [member for member in invited_members if int(member["id"]) not in existing_ids]
        if len(existing_ids) + len(new_members) > MAX_GROUP_MEMBERS:
            raise HTTPException(status_code=400, detail=f"Group can have at most {MAX_GROUP_MEMBERS} members")

        if new_members:
            conn.execute(
                text(
                    """
                    insert into message_group_members(group_id, user_id, role, group_nickname)
                    values (:group_id, :user_id, 'MEMBER', :group_nickname)
                    on conflict (group_id, user_id) do nothing
                    """
                ),
                [
                    {
                        "group_id": group_id,
                        "user_id": member["id"],
                        "group_nickname": member["username"],
                    }
                    for member in new_members
                ],
            )
            conn.execute(
                text("update message_groups set updated_at = now() where id = :group_id"),
                {"group_id": group_id},
            )
            for member in new_members:
                create_notification(
                    conn,
                    member["id"],
                    "GROUP_MEMBER_ADDED",
                    f"你已加入群聊「{group['name']}」",
                    f"{user['username']} 将你加入了群聊。",
                    f"/messages/groups/{group_id}",
                )

        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        members = list_group_members(conn, group_id)
    return {"ok": True, "added": len(new_members), "group": build_group_payload(group, members)}


@router.patch("/api/messages/groups/{group_id}/members/{member_id}/role")
def update_message_group_member_role(group_id: int, member_id: int, payload: dict, user=Depends(require_user)):
    role = normalize_group_member_role(payload.get("role"))
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_owner(group)
        if member_id == int(group["owner_id"] or 0):
            raise HTTPException(status_code=400, detail="Cannot change the owner role")
        if not group_member_exists(conn, group_id=group_id, user_id=member_id):
            raise HTTPException(status_code=404, detail="Group member not found")
        conn.execute(
            text(
                """
                update message_group_members
                set role = :role
                where group_id = :group_id
                  and user_id = :member_id
                """
            ),
            {"group_id": group_id, "member_id": member_id, "role": role},
        )
        conn.execute(
            text(
                """
                insert into message_group_moderation_logs(group_id, actor_id, target_user_id, action, reason)
                values (:group_id, :actor_id, :target_user_id, :action, :reason)
                """
            ),
            {
                "group_id": group_id,
                "actor_id": user["id"],
                "target_user_id": member_id,
                "action": f"ROLE_{role}",
                "reason": normalize_optional_note(payload.get("reason"), max_length=500),
            },
        )
        members = list_group_members(conn, group_id)
    return {"ok": True, "members": members}


@router.post("/api/messages/groups/{group_id}/members/{member_id}/remove")
def remove_message_group_member_with_reason(group_id: int, member_id: int, payload: dict, user=Depends(require_user)):
    if member_id == user["id"]:
        raise HTTPException(status_code=400, detail="Use leave group instead")
    reason = normalize_optional_note(payload.get("reason"), max_length=500)
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_manager(group)
        target = conn.execute(
            text(
                """
                select role
                from message_group_members
                where group_id = :group_id
                  and user_id = :member_id
                """
            ),
            {"group_id": group_id, "member_id": member_id},
        ).mappings().first()
        if not target:
            raise HTTPException(status_code=404, detail="Group member not found")
        if target["role"] == "OWNER":
            raise HTTPException(status_code=400, detail="Cannot remove the group owner")
        if group["member_role"] == "ADMIN" and target["role"] == "ADMIN":
            raise HTTPException(status_code=403, detail="Admins can only remove regular members")
        result = conn.execute(
            text(
                """
                delete from message_group_members
                where group_id = :group_id
                  and user_id = :member_id
                """
            ),
            {"group_id": group_id, "member_id": member_id},
        )
        conn.execute(
            text(
                """
                insert into message_group_moderation_logs(group_id, actor_id, target_user_id, action, reason)
                values (:group_id, :actor_id, :target_user_id, 'REMOVE', :reason)
                """
            ),
            {"group_id": group_id, "actor_id": user["id"], "target_user_id": member_id, "reason": reason},
        )
        conn.execute(text("update message_groups set updated_at = now() where id = :group_id"), {"group_id": group_id})
        members = list_group_members(conn, group_id)
    return {"ok": True, "removed": int(result.rowcount or 0) > 0, "members": members}


@router.delete("/api/messages/groups/{group_id}/members/{member_id}")
def remove_message_group_member(group_id: int, member_id: int, user=Depends(require_user)):
    if member_id == user["id"]:
        raise HTTPException(status_code=400, detail="Use leave group instead")
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_owner(group)
        target = conn.execute(
            text(
                """
                select u.id, u.username, mgm.role as member_role
                from message_group_members mgm
                join users u on u.id = mgm.user_id
                where mgm.group_id = :group_id
                  and mgm.user_id = :member_id
                """
            ),
            {"group_id": group_id, "member_id": member_id},
        ).mappings().first()
        if not target:
            raise HTTPException(status_code=404, detail="Group member not found")
        if target["member_role"] == "OWNER":
            raise HTTPException(status_code=400, detail="Cannot remove the group owner")

        conn.execute(
            text(
                """
                delete from message_group_members
                where group_id = :group_id
                  and user_id = :member_id
                """
            ),
            {"group_id": group_id, "member_id": member_id},
        )
        conn.execute(text("update message_groups set updated_at = now() where id = :group_id"), {"group_id": group_id})
        create_notification(
            conn,
            member_id,
            "GROUP_MEMBER_REMOVED",
            f"你已被移出群聊「{group['name']}」",
            f"{user['username']} 将你移出了群聊。",
            None,
        )
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        members = list_group_members(conn, group_id)
    return {"ok": True, "removed": dict(target), "group": build_group_payload(group, members)}


@router.post("/api/messages/groups/{group_id}/transfer-owner")
def transfer_message_group_owner(group_id: int, payload: dict, user=Depends(require_user)):
    new_owner_id = normalize_recipient_id(payload.get("new_owner_id") or payload.get("user_id"))
    if new_owner_id is None:
        raise HTTPException(status_code=400, detail="new_owner_id is required")
    if new_owner_id == user["id"]:
        raise HTTPException(status_code=400, detail="New owner must be another group member")
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_owner(group)
        transfer_group_owner(conn, group_id=group_id, new_owner_id=new_owner_id)
        create_notification(
            conn,
            new_owner_id,
            "GROUP_OWNER_TRANSFERRED",
            f"你已成为群聊「{group['name']}」的群主",
            f"{user['username']} 已将群主转让给你。",
            f"/messages/groups/{group_id}",
        )
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        members = list_group_members(conn, group_id)
    return {"ok": True, "group": build_group_payload(group, members)}


@router.post("/api/messages/groups/{group_id}/leave")
def leave_message_group(group_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        if group["member_role"] == "OWNER":
            next_owner_id = choose_next_group_owner(conn, group_id=group_id, leaving_user_id=user["id"])
            if next_owner_id is None:
                conn.execute(text("delete from message_groups where id = :group_id"), {"group_id": group_id})
                return {"ok": True, "deleted": True}
            transfer_group_owner(conn, group_id=group_id, new_owner_id=next_owner_id)
            create_notification(
                conn,
                next_owner_id,
                "GROUP_OWNER_TRANSFERRED",
                f"你已成为群聊「{group['name']}」的群主",
                f"{user['username']} 退出群聊后，群主已自动转让给你。",
                f"/messages/groups/{group_id}",
            )

        conn.execute(
            text(
                """
                delete from message_group_members
                where group_id = :group_id
                  and user_id = :user_id
                """
            ),
            {"group_id": group_id, "user_id": user["id"]},
        )
        conn.execute(text("update message_groups set updated_at = now() where id = :group_id"), {"group_id": group_id})
    return {"ok": True, "left": True}


@router.delete("/api/messages/groups/{group_id}")
def delete_message_group(group_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        require_group_owner(group)
        members = list_group_members(conn, group_id)
        for member in members:
            if int(member["id"]) == int(user["id"]):
                continue
            create_notification(
                conn,
                member["id"],
                "GROUP_DELETED",
                f"群聊「{group['name']}」已解散",
                f"{user['username']} 解散了该群聊。",
                None,
            )
        conn.execute(text("delete from message_groups where id = :group_id"), {"group_id": group_id})
    return {"ok": True, "deleted": True}


@router.post("/api/messages/groups/{group_id}/messages")
def send_group_message(group_id: int, payload: dict, request: Request, user=Depends(require_user)):
    check_rate_limit(client_key(request, "message", str(user["id"])), max_calls=120, window_seconds=3600)
    body = normalize_message_body(payload.get("body_md") or payload.get("body"))
    reply_to_message_id = payload.get("reply_to_message_id")

    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        reply_target_id = resolve_group_reply_target(
            conn,
            group_id=group_id,
            joined_at=group["joined_at"],
            reply_to_message_id=reply_to_message_id,
        )
        row = conn.execute(
            text(
                """
                with inserted as (
                  insert into group_messages(group_id, sender_id, body_md, reply_to_message_id)
                  values (:group_id, :sender_id, :body_md, :reply_to_message_id)
                  returning id, group_id, sender_id, body_md, reply_to_message_id,
                            false as has_attachment,
                            null::bigint as attachment_id,
                            attachment_content_type, attachment_filename, attachment_size_bytes,
                            attachment_scan_status, attachment_thumbnail_object_key,
                            delivered_at, created_at, edited_at, deleted_at, deleted_by_user_id
                )
                select
                  inserted.id,
                  'group' as message_type,
                  'group' as attachment_scope,
                  inserted.group_id,
                  inserted.sender_id,
                  su.username as sender_username,
                  su.avatar_object_key as sender_avatar_object_key,
                  su.avatar_updated_at as sender_avatar_updated_at,
                  coalesce(nullif(btrim(mgm.group_nickname), ''), su.username) as sender_group_nickname,
                  null::bigint as recipient_id,
                   null::text as recipient_username,
                   null::text as recipient_avatar_object_key,
                   null::timestamptz as recipient_avatar_updated_at,
                   inserted.body_md,
                   inserted.reply_to_message_id,
                   inserted.has_attachment,
                   inserted.attachment_id,
                   inserted.attachment_content_type,
                   inserted.attachment_filename,
                   inserted.attachment_size_bytes,
                   inserted.attachment_scan_status,
                   inserted.attachment_thumbnail_object_key,
                   null::boolean as is_read,
                   inserted.delivered_at,
                   inserted.created_at,
                   null::timestamptz as read_at,
                   inserted.edited_at,
                   inserted.deleted_at,
                   inserted.deleted_by_user_id,
                   reply.body_md as reply_to_body_md,
                   (reply.attachment_object_key is not null and reply.deleted_at is null) as reply_to_has_attachment,
                   reply.attachment_content_type as reply_to_attachment_content_type,
                   reply.attachment_filename as reply_to_attachment_filename,
                   reply.deleted_at as reply_to_deleted_at,
                   reply_sender.username as reply_to_sender_username
                from inserted
                join users su on su.id = inserted.sender_id
                left join message_group_members mgm
                  on mgm.group_id = inserted.group_id
                 and mgm.user_id = inserted.sender_id
                left join group_messages reply on reply.id = inserted.reply_to_message_id
                left join users reply_sender on reply_sender.id = reply.sender_id
                """
            ),
            {
                "group_id": group_id,
                "sender_id": user["id"],
                "body_md": body,
                "reply_to_message_id": reply_target_id,
            },
        ).mappings().first()
        conn.execute(
            text("update message_groups set updated_at = now() where id = :group_id"),
            {"group_id": group_id},
        )
        conn.execute(
            text(
                """
                insert into group_message_reads(group_id, user_id, last_read_message_id, read_at)
                values (:group_id, :user_id, :message_id, now())
                on conflict (group_id, user_id) do update
                set last_read_message_id = greatest(
                      coalesce(group_message_reads.last_read_message_id, 0),
                      excluded.last_read_message_id
                    ),
                    read_at = now()
                """
            ),
            {"group_id": group_id, "user_id": user["id"], "message_id": row["id"]},
        )
        notify_group_mentions(conn, group=group, body=body, sender=user)
        message_row = hydrate_message_rows(conn, [row], user_id=user["id"])[0]

    return {"ok": True, "message": serialize_message_row(message_row), "group": build_group_payload(group)}


@router.post("/api/messages/groups/{group_id}/files")
async def send_group_message_file(
    group_id: int,
    request: Request,
    body_md: str = Form(""),
    reply_to_message_id: int | None = Form(None),
    file: UploadFile = File(...),
    user=Depends(require_user),
):
    check_rate_limit(client_key(request, "message-file", str(user["id"])), max_calls=60, window_seconds=3600)
    body = normalize_optional_message_body(body_md)
    file_bytes = await file.read()
    content_type, suffix = validate_file_upload(file.filename, file.content_type, file_bytes)
    scan_result = scan_message_attachment(file_bytes, content_type)
    if scan_result != "CLEAN":
        raise HTTPException(status_code=400, detail="Attachment failed security scan")
    object_key = f"messages/groups/{group_id}/{user['id']}/{uuid4().hex}{suffix}"
    filename = safe_attachment_filename(file.filename, suffix)
    thumbnail_object_key = object_key if content_type in IMAGE_CONTENT_TYPES else None

    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        reply_target_id = resolve_group_reply_target(
            conn,
            group_id=group_id,
            joined_at=group["joined_at"],
            reply_to_message_id=reply_to_message_id,
        )
        row = conn.execute(
            text(
                """
                with inserted as (
                  insert into group_messages(
                    group_id,
                    sender_id,
                    body_md,
                    reply_to_message_id,
                    attachment_object_key,
                    attachment_content_type,
                    attachment_filename,
                    attachment_size_bytes,
                    attachment_scan_status,
                    attachment_thumbnail_object_key
                  )
                  values (
                    :group_id,
                    :sender_id,
                    :body_md,
                    :reply_to_message_id,
                    :attachment_object_key,
                    :attachment_content_type,
                    :attachment_filename,
                    :attachment_size_bytes,
                    :attachment_scan_status,
                    :attachment_thumbnail_object_key
                  )
                  returning id, group_id, sender_id, body_md, reply_to_message_id,
                            true as has_attachment,
                            id as attachment_id,
                            attachment_content_type, attachment_filename, attachment_size_bytes,
                            attachment_scan_status, attachment_thumbnail_object_key,
                            delivered_at, created_at, edited_at, deleted_at, deleted_by_user_id
                )
                select
                  inserted.id,
                  'group' as message_type,
                  'group' as attachment_scope,
                  inserted.group_id,
                  inserted.sender_id,
                  su.username as sender_username,
                  su.avatar_object_key as sender_avatar_object_key,
                  su.avatar_updated_at as sender_avatar_updated_at,
                  coalesce(nullif(btrim(mgm.group_nickname), ''), su.username) as sender_group_nickname,
                  null::bigint as recipient_id,
                   null::text as recipient_username,
                   null::text as recipient_avatar_object_key,
                   null::timestamptz as recipient_avatar_updated_at,
                   inserted.body_md,
                   inserted.reply_to_message_id,
                   inserted.has_attachment,
                   inserted.attachment_id,
                   inserted.attachment_content_type,
                   inserted.attachment_filename,
                   inserted.attachment_size_bytes,
                   inserted.attachment_scan_status,
                   inserted.attachment_thumbnail_object_key,
                   null::boolean as is_read,
                   inserted.delivered_at,
                   inserted.created_at,
                   null::timestamptz as read_at,
                   inserted.edited_at,
                   inserted.deleted_at,
                   inserted.deleted_by_user_id,
                   reply.body_md as reply_to_body_md,
                   (reply.attachment_object_key is not null and reply.deleted_at is null) as reply_to_has_attachment,
                   reply.attachment_content_type as reply_to_attachment_content_type,
                   reply.attachment_filename as reply_to_attachment_filename,
                   reply.deleted_at as reply_to_deleted_at,
                   reply_sender.username as reply_to_sender_username
                from inserted
                join users su on su.id = inserted.sender_id
                left join message_group_members mgm
                  on mgm.group_id = inserted.group_id
                 and mgm.user_id = inserted.sender_id
                left join group_messages reply on reply.id = inserted.reply_to_message_id
                left join users reply_sender on reply_sender.id = reply.sender_id
                """
            ),
            {
                "group_id": group_id,
                "sender_id": user["id"],
                "body_md": body,
                "reply_to_message_id": reply_target_id,
                "attachment_object_key": object_key,
                "attachment_content_type": content_type,
                "attachment_filename": filename,
                "attachment_size_bytes": len(file_bytes),
                "attachment_scan_status": "PENDING",
                "attachment_thumbnail_object_key": thumbnail_object_key,
            },
        ).mappings().first()
        conn.execute(
            text(
                """
                insert into message_attachment_jobs(
                  group_message_id, object_key, status, scan_result, thumbnail_object_key
                )
                values (:message_id, :object_key, 'PENDING', :scan_result, :thumbnail_object_key)
                """
            ),
            {
                "message_id": row["id"],
                "object_key": object_key,
                "scan_result": scan_result,
                "thumbnail_object_key": thumbnail_object_key,
            },
        )
        conn.execute(
            text("update message_groups set updated_at = now() where id = :group_id"),
            {"group_id": group_id},
        )

    try:
        put_bytes(S3_BUCKET_MESSAGES, object_key, file_bytes, content_type)
    except Exception as exc:
        with engine.begin() as conn:
            conn.execute(text("delete from group_messages where id = :id"), {"id": row["id"]})
        raise HTTPException(status_code=500, detail="Failed to store message file") from exc
    else:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    update group_messages
                    set attachment_scan_status = :scan_result,
                        attachment_thumbnail_object_key = :thumbnail_object_key
                    where id = :message_id
                    """
                ),
                {"message_id": row["id"], "scan_result": scan_result, "thumbnail_object_key": thumbnail_object_key},
            )
            conn.execute(
                text(
                    """
                    update message_attachment_jobs
                    set status = 'STORED',
                        scan_result = :scan_result,
                        thumbnail_object_key = :thumbnail_object_key,
                        updated_at = now()
                    where group_message_id = :message_id
                    """
                ),
                {"message_id": row["id"], "scan_result": scan_result, "thumbnail_object_key": thumbnail_object_key},
            )

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                insert into group_message_reads(group_id, user_id, last_read_message_id, read_at)
                values (:group_id, :user_id, :message_id, now())
                on conflict (group_id, user_id) do update
                set last_read_message_id = greatest(
                      coalesce(group_message_reads.last_read_message_id, 0),
                      excluded.last_read_message_id
                    ),
                    read_at = now()
                """
            ),
            {"group_id": group_id, "user_id": user["id"], "message_id": row["id"]},
        )
        notify_group_mentions(conn, group=group, body=body, sender=user)

    row = {
        **dict(row),
        "attachment_scan_status": scan_result,
        "attachment_thumbnail_object_key": thumbnail_object_key,
    }
    with engine.connect() as conn:
        message_row = hydrate_message_rows(conn, [row], user_id=user["id"])[0]

    return {"ok": True, "message": serialize_message_row(message_row), "group": build_group_payload(group)}


@router.post("/api/messages/files")
async def send_direct_message_file(
    request: Request,
    recipient_id: int | None = Form(None),
    recipient: str | None = Form(None),
    recipient_username: str | None = Form(None),
    body_md: str = Form(""),
    reply_to_message_id: int | None = Form(None),
    file: UploadFile = File(...),
    user=Depends(require_user),
):
    check_rate_limit(client_key(request, "message-file", str(user["id"])), max_calls=60, window_seconds=3600)
    body = normalize_optional_message_body(body_md)
    file_bytes = await file.read()
    content_type, suffix = validate_file_upload(file.filename, file.content_type, file_bytes)
    scan_result = scan_message_attachment(file_bytes, content_type)
    if scan_result != "CLEAN":
        raise HTTPException(status_code=400, detail="Attachment failed security scan")
    object_key = f"messages/{user['id']}/{uuid4().hex}{suffix}"
    filename = safe_attachment_filename(file.filename, suffix)
    thumbnail_object_key = object_key if content_type in IMAGE_CONTENT_TYPES else None

    with engine.begin() as conn:
        peer = resolve_recipient(
            conn,
            current_user_id=user["id"],
            recipient_id=recipient_id,
            recipient_key=recipient_username or recipient or "",
        )
        require_direct_message_allowed(conn, current_user_id=user["id"], other_user_id=peer["id"])
        reply_target_id = resolve_direct_reply_target(
            conn,
            current_user_id=user["id"],
            peer_id=peer["id"],
            reply_to_message_id=reply_to_message_id,
        )
        row = conn.execute(
            text(
                """
                with inserted as (
                  insert into direct_messages(
                    sender_id,
                    recipient_id,
                    body_md,
                    reply_to_message_id,
                    attachment_object_key,
                    attachment_content_type,
                    attachment_filename,
                    attachment_size_bytes,
                    attachment_scan_status,
                    attachment_thumbnail_object_key
                  )
                  values (
                    :sender_id,
                    :recipient_id,
                    :body_md,
                    :reply_to_message_id,
                    :attachment_object_key,
                    :attachment_content_type,
                    :attachment_filename,
                    :attachment_size_bytes,
                    :attachment_scan_status,
                    :attachment_thumbnail_object_key
                  )
                  returning id, sender_id, recipient_id, body_md, reply_to_message_id,
                            true as has_attachment,
                            id as attachment_id,
                            attachment_content_type, attachment_filename, attachment_size_bytes,
                            attachment_scan_status, attachment_thumbnail_object_key,
                            is_read, delivered_at, created_at, read_at, edited_at, deleted_at, deleted_by_user_id
                )
                select
                  inserted.id,
                  'direct' as message_type,
                  'direct' as attachment_scope,
                  inserted.sender_id,
                  su.username as sender_username,
                  su.avatar_object_key as sender_avatar_object_key,
                  su.avatar_updated_at as sender_avatar_updated_at,
                  inserted.recipient_id,
                  ru.username as recipient_username,
                  ru.avatar_object_key as recipient_avatar_object_key,
                  ru.avatar_updated_at as recipient_avatar_updated_at,
                  inserted.body_md,
                  inserted.reply_to_message_id,
                  inserted.has_attachment,
                  inserted.attachment_id,
                  inserted.attachment_content_type,
                  inserted.attachment_filename,
                  inserted.attachment_size_bytes,
                  inserted.attachment_scan_status,
                  inserted.attachment_thumbnail_object_key,
                  inserted.is_read,
                  inserted.delivered_at,
                  inserted.created_at,
                  inserted.read_at,
                  inserted.edited_at,
                  inserted.deleted_at,
                  inserted.deleted_by_user_id,
                  reply.body_md as reply_to_body_md,
                  (reply.attachment_object_key is not null and reply.deleted_at is null) as reply_to_has_attachment,
                  reply.attachment_content_type as reply_to_attachment_content_type,
                  reply.attachment_filename as reply_to_attachment_filename,
                  reply.deleted_at as reply_to_deleted_at,
                  reply_sender.username as reply_to_sender_username
                from inserted
                join users su on su.id = inserted.sender_id
                join users ru on ru.id = inserted.recipient_id
                left join direct_messages reply on reply.id = inserted.reply_to_message_id
                left join users reply_sender on reply_sender.id = reply.sender_id
                """
            ),
            {
                "sender_id": user["id"],
                "recipient_id": peer["id"],
                "body_md": body,
                "reply_to_message_id": reply_target_id,
                "attachment_object_key": object_key,
                "attachment_content_type": content_type,
                "attachment_filename": filename,
                "attachment_size_bytes": len(file_bytes),
                "attachment_scan_status": "PENDING",
                "attachment_thumbnail_object_key": thumbnail_object_key,
            },
        ).mappings().first()
        conn.execute(
            text(
                """
                insert into message_attachment_jobs(
                  direct_message_id, object_key, status, scan_result, thumbnail_object_key
                )
                values (:message_id, :object_key, 'PENDING', :scan_result, :thumbnail_object_key)
                """
            ),
            {
                "message_id": row["id"],
                "object_key": object_key,
                "scan_result": scan_result,
                "thumbnail_object_key": thumbnail_object_key,
            },
        )

    try:
        put_bytes(S3_BUCKET_MESSAGES, object_key, file_bytes, content_type)
    except Exception as exc:
        with engine.begin() as conn:
            conn.execute(text("delete from direct_messages where id = :id"), {"id": row["id"]})
        raise HTTPException(status_code=500, detail="Failed to store message file") from exc
    else:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    update direct_messages
                    set attachment_scan_status = :scan_result,
                        attachment_thumbnail_object_key = :thumbnail_object_key
                    where id = :message_id
                    """
                ),
                {"message_id": row["id"], "scan_result": scan_result, "thumbnail_object_key": thumbnail_object_key},
            )
            conn.execute(
                text(
                    """
                    update message_attachment_jobs
                    set status = 'STORED',
                        scan_result = :scan_result,
                        thumbnail_object_key = :thumbnail_object_key,
                        updated_at = now()
                    where direct_message_id = :message_id
                    """
                ),
                {"message_id": row["id"], "scan_result": scan_result, "thumbnail_object_key": thumbnail_object_key},
            )

    row = {
        **dict(row),
        "attachment_scan_status": scan_result,
        "attachment_thumbnail_object_key": thumbnail_object_key,
    }
    with engine.connect() as conn:
        message_row = hydrate_message_rows(conn, [row], user_id=user["id"])[0]

    return {"ok": True, "message": serialize_message_row(message_row), "peer": peer}


@router.post("/api/messages/images")
async def send_direct_message_image(
    request: Request,
    recipient_id: int | None = Form(None),
    recipient: str | None = Form(None),
    recipient_username: str | None = Form(None),
    body_md: str = Form(""),
    reply_to_message_id: int | None = Form(None),
    image: UploadFile = File(...),
    user=Depends(require_user),
):
    return await send_direct_message_file(
        request=request,
        recipient_id=recipient_id,
        recipient=recipient,
        recipient_username=recipient_username,
        body_md=body_md,
        reply_to_message_id=reply_to_message_id,
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
                  and deleted_at is null
                  and not exists (
                    select 1
                    from message_hidden_entries hidden
                    where hidden.user_id = :user_id
                      and hidden.direct_message_id = direct_messages.id
                  )
                """
            ),
            {"message_id": message_id, "user_id": user["id"]},
        ).mappings().first()

    return message_attachment_response(row)


@router.get("/api/messages/{message_id}/image")
def get_direct_message_image(message_id: int, user=Depends(require_user)):
    return get_direct_message_attachment(message_id, user)


@router.get("/api/messages/group-messages/{message_id}/attachment")
def get_group_message_attachment(message_id: int, user=Depends(require_user)):
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select gm.attachment_object_key, gm.attachment_content_type, gm.attachment_filename
                from group_messages gm
                join message_group_members mgm
                  on mgm.group_id = gm.group_id
                 and mgm.user_id = :user_id
                where gm.id = :message_id
                  and gm.created_at >= mgm.joined_at
                  and gm.attachment_object_key is not null
                  and gm.deleted_at is null
                  and not exists (
                    select 1
                    from message_hidden_entries hidden
                    where hidden.user_id = :user_id
                      and hidden.group_message_id = gm.id
                  )
                """
            ),
            {"message_id": message_id, "user_id": user["id"]},
        ).mappings().first()

    return message_attachment_response(row)


@router.get("/api/messages/group-messages/{message_id}/image")
def get_group_message_image(message_id: int, user=Depends(require_user)):
    return get_group_message_attachment(message_id, user)


@router.get("/api/messages/group-messages/{message_id}/reads")
def get_group_message_reads(message_id: int, user=Depends(require_user)):
    with engine.connect() as conn:
        message = get_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
        rows = conn.execute(
            text(
                """
                select
                  u.id,
                  u.username,
                  u.role,
                  u.avatar_object_key,
                  u.avatar_updated_at,
                  u.last_seen_at,
                  gmrr.read_at
                from group_message_read_receipts gmrr
                join users u on u.id = gmrr.user_id
                join message_group_members mgm
                  on mgm.group_id = :group_id
                 and mgm.user_id = gmrr.user_id
                where gmrr.group_message_id = :message_id
                order by gmrr.read_at desc
                """
            ),
            {"message_id": message_id, "group_id": message["group_id"]},
        ).mappings().all()
    return {"items": [{**serialize_user(row), "read_at": row["read_at"]} for row in rows]}


@router.patch("/api/messages/conversation-preferences/{conversation_type}/{conversation_id}")
def update_message_conversation_preferences(conversation_type: str, conversation_id: int, payload: dict, user=Depends(require_user)):
    if int(conversation_id or 0) <= 0:
        raise HTTPException(status_code=400, detail="Invalid conversation id")
    normalized_type = normalize_conversation_type(conversation_type)
    if normalized_type == "direct" and conversation_id == int(user["id"]):
        raise HTTPException(status_code=400, detail="Cannot update self conversation preferences")
    is_pinned = normalize_optional_bool(payload.get("is_pinned")) if "is_pinned" in payload else None
    is_archived = normalize_optional_bool(payload.get("is_archived")) if "is_archived" in payload else None
    is_muted = normalize_optional_bool(payload.get("is_muted")) if "is_muted" in payload else None

    with engine.begin() as conn:
        if normalized_type == "direct":
            peer = conn.execute(
                text("select id from users where id = :peer_id"),
                {"peer_id": conversation_id},
            ).mappings().first()
            if not peer:
                raise HTTPException(status_code=404, detail="User not found")
        else:
            get_group_membership(conn, group_id=conversation_id, user_id=user["id"])
        prefs = upsert_conversation_preferences(
            conn,
            user_id=user["id"],
            conversation_type=normalized_type,
            conversation_id=conversation_id,
            is_pinned=is_pinned,
            is_archived=is_archived,
            is_muted=is_muted,
        )
    return {"ok": True, "conversation_type": normalized_type, "conversation_id": conversation_id, "preferences": prefs}


@router.patch("/api/messages/contact-remarks/{contact_user_id}")
def update_message_contact_remark(contact_user_id: int, payload: dict, user=Depends(require_user)):
    if int(contact_user_id or 0) <= 0:
        raise HTTPException(status_code=400, detail="Invalid contact user id")
    if int(contact_user_id) == int(user["id"]):
        raise HTTPException(status_code=400, detail="Cannot set a remark for yourself")
    remark_name = normalize_contact_remark(
        payload.get("remark_name") if "remark_name" in payload else payload.get("name")
    )

    with engine.begin() as conn:
        contact = conn.execute(
            text(
                """
                select
                  id,
                  username,
                  role,
                  avatar_object_key,
                  avatar_updated_at,
                  last_seen_at,
                  coalesce(is_disabled, false) as is_disabled
                from users
                where id = :contact_user_id
                """
            ),
            {"contact_user_id": contact_user_id},
        ).mappings().first()
        if not contact:
            raise HTTPException(status_code=404, detail="User not found")
        remark = upsert_contact_remark(
            conn,
            user_id=user["id"],
            contact_user_id=contact_user_id,
            remark_name=remark_name,
        )

    contact_payload = apply_contact_remark_payload(
        serialize_user(contact),
        remark_name=remark["remark_name"],
    )
    contact_payload["peer_remark_updated_at"] = remark["updated_at"]
    return {"ok": True, "contact_user_id": contact_user_id, "remark": remark, "contact": contact_payload}


@router.get("/api/messages/blocks")
def list_message_blocks(user=Depends(require_user)):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select
                  u.id,
                  u.username,
                  u.role,
                  u.avatar_object_key,
                  u.avatar_updated_at,
                  umb.created_at as blocked_at
                from user_message_blocks umb
                join users u on u.id = umb.blocked_user_id
                where umb.blocker_id = :user_id
                order by umb.created_at desc, u.username asc
                """
            ),
            {"user_id": user["id"]},
        ).mappings().all()
    return {
        "items": [
            {**serialize_user(row), "blocked_at": row["blocked_at"]}
            for row in rows
        ]
    }


@router.post("/api/messages/blocks")
def create_message_block(payload: dict, user=Depends(require_user)):
    blocked_user_id = payload.get("blocked_user_id") or payload.get("user_id")
    blocked_user_key = str(payload.get("username") or payload.get("recipient") or "").strip()
    with engine.begin() as conn:
        blocked_user = resolve_recipient(
            conn,
            current_user_id=user["id"],
            recipient_id=blocked_user_id,
            recipient_key=blocked_user_key,
        )
        conn.execute(
            text(
                """
                insert into user_message_blocks(blocker_id, blocked_user_id)
                values (:blocker_id, :blocked_user_id)
                on conflict (blocker_id, blocked_user_id) do nothing
                """
            ),
            {"blocker_id": user["id"], "blocked_user_id": blocked_user["id"]},
        )
    return {"ok": True, "user": blocked_user}


@router.delete("/api/messages/blocks/{blocked_user_id}")
def delete_message_block(blocked_user_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                delete from user_message_blocks
                where blocker_id = :blocker_id
                  and blocked_user_id = :blocked_user_id
                """
            ),
            {"blocker_id": user["id"], "blocked_user_id": blocked_user_id},
        )
    return {"ok": True, "deleted": int(result.rowcount or 0) > 0}


@router.post("/api/messages/reports")
def report_message(payload: dict, user=Depends(require_user)):
    conversation_type = normalize_conversation_type(payload.get("conversation_type") or payload.get("scope"))
    message_id = normalize_message_cursor(payload.get("message_id"))
    reason = normalize_report_reason(payload.get("reason"))
    details = normalize_report_details(payload.get("details"))
    if message_id is None:
        raise HTTPException(status_code=400, detail="message_id is required")

    with engine.begin() as conn:
        if conversation_type == "direct":
            message = get_direct_message_for_user(conn, message_id=message_id, user_id=user["id"])
            if int(message["sender_id"]) == int(user["id"]):
                raise HTTPException(status_code=400, detail="Cannot report your own message")
            row = conn.execute(
                text(
                    """
                    insert into message_reports(reporter_id, direct_message_id, reason, details)
                    values (:reporter_id, :message_id, :reason, :details)
                    returning id, status, created_at
                    """
                ),
                {"reporter_id": user["id"], "message_id": message_id, "reason": reason, "details": details},
            ).mappings().first()
        else:
            message = get_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
            if int(message["sender_id"]) == int(user["id"]):
                raise HTTPException(status_code=400, detail="Cannot report your own message")
            row = conn.execute(
                text(
                    """
                    insert into message_reports(reporter_id, group_message_id, reason, details)
                    values (:reporter_id, :message_id, :reason, :details)
                    returning id, status, created_at
                    """
                ),
                {"reporter_id": user["id"], "message_id": message_id, "reason": reason, "details": details},
            ).mappings().first()
    return {"ok": True, "report": dict(row)}


@router.get("/api/admin/messages/reports")
def admin_list_message_reports(status: str = "OPEN", limit: int = 50, user=Depends(require_admin)):
    limit = clamp_limit(limit, default=50, max_value=200)
    status_filter = str(status or "").strip().upper()
    params = {"limit": limit}
    where_status = ""
    if status_filter and status_filter != "ALL":
        if status_filter not in {"OPEN", "REVIEWED", "DISMISSED"}:
            raise HTTPException(status_code=400, detail="Invalid report status")
        where_status = "where mr.status = :status"
        params["status"] = status_filter
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select
                  mr.*,
                  reporter.username as reporter_username,
                  coalesce(dm.sender_id, gm.sender_id) as message_sender_id,
                  sender.username as message_sender_username,
                  coalesce(dm.body_md, gm.body_md) as message_body_md,
                  coalesce(dm.created_at, gm.created_at) as message_created_at,
                  case when mr.direct_message_id is not null then 'direct' else 'group' end as conversation_type,
                  gm.group_id
                from message_reports mr
                join users reporter on reporter.id = mr.reporter_id
                left join direct_messages dm on dm.id = mr.direct_message_id
                left join group_messages gm on gm.id = mr.group_message_id
                left join users sender on sender.id = coalesce(dm.sender_id, gm.sender_id)
                {where_status}
                order by mr.created_at desc, mr.id desc
                limit :limit
                """
            ),
            params,
        ).mappings().all()
    return {"items": [dict(row) for row in rows]}


@router.patch("/api/admin/messages/reports/{report_id}")
def admin_update_message_report(report_id: int, payload: dict, user=Depends(require_admin)):
    status = str(payload.get("status") or "").strip().upper()
    if status not in {"REVIEWED", "DISMISSED"}:
        raise HTTPException(status_code=400, detail="Status must be REVIEWED or DISMISSED")
    action_taken = str(payload.get("action_taken") or "NONE").strip().upper()
    if action_taken not in {"NONE", "WARN_SENDER", "DISABLE_SENDER"}:
        raise HTTPException(status_code=400, detail="Invalid action")
    resolution_note = normalize_optional_note(payload.get("resolution_note"), max_length=2000)
    with engine.begin() as conn:
        report = conn.execute(
            text(
                """
                select
                  mr.*,
                  coalesce(dm.sender_id, gm.sender_id) as message_sender_id
                from message_reports mr
                left join direct_messages dm on dm.id = mr.direct_message_id
                left join group_messages gm on gm.id = mr.group_message_id
                where mr.id = :report_id
                """
            ),
            {"report_id": report_id},
        ).mappings().first()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        sender_id = report["message_sender_id"]
        if action_taken == "WARN_SENDER" and sender_id:
            create_notification(
                conn,
                sender_id,
                "MESSAGE_REPORT_WARNING",
                "你的消息已被管理员提醒",
                resolution_note or "请遵守平台聊天规则。",
                "/messages",
            )
        elif action_taken == "DISABLE_SENDER" and sender_id:
            conn.execute(text("update users set is_disabled = true where id = :user_id"), {"user_id": sender_id})
        row = conn.execute(
            text(
                """
                update message_reports
                set status = :status,
                    reviewed_at = now(),
                    reviewed_by_user_id = :reviewed_by_user_id,
                    resolution_note = :resolution_note,
                    action_taken = :action_taken
                where id = :report_id
                returning *
                """
            ),
            {
                "report_id": report_id,
                "status": status,
                "reviewed_by_user_id": user["id"],
                "resolution_note": resolution_note,
                "action_taken": action_taken,
            },
        ).mappings().first()
        audit_log(
            conn,
            user_id=user["id"],
            action="admin.message_report.update",
            resource_type="message_report",
            resource_id=report_id,
            metadata={"status": status, "action_taken": action_taken, "message_sender_id": sender_id},
        )
    return {"ok": True, "report": dict(row)}


@router.post("/api/messages/reactions")
def set_message_reaction(payload: dict, user=Depends(require_user)):
    conversation_type = normalize_conversation_type(payload.get("conversation_type") or payload.get("scope"))
    message_id = normalize_message_cursor(payload.get("message_id"))
    emoji = normalize_reaction_emoji(payload.get("emoji"))
    active = normalize_optional_bool(payload.get("active")) if "active" in payload else True
    if message_id is None:
        raise HTTPException(status_code=400, detail="message_id is required")
    column = "direct_message_id" if conversation_type == "direct" else "group_message_id"
    with engine.begin() as conn:
        if conversation_type == "direct":
            get_direct_message_for_user(conn, message_id=message_id, user_id=user["id"])
        else:
            get_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
        if active:
            conn.execute(
                text(
                    f"""
                    insert into message_reactions(user_id, {column}, emoji)
                    values (:user_id, :message_id, :emoji)
                    on conflict do nothing
                    """
                ),
                {"user_id": user["id"], "message_id": message_id, "emoji": emoji},
            )
        else:
            conn.execute(
                text(
                    f"""
                    delete from message_reactions
                    where user_id = :user_id
                      and {column} = :message_id
                      and emoji = :emoji
                    """
                ),
                {"user_id": user["id"], "message_id": message_id, "emoji": emoji},
            )
        reactions = message_reaction_summary(conn, conversation_type=conversation_type, message_id=message_id, user_id=user["id"])
    return {"ok": True, "message_id": message_id, "reactions": reactions}


@router.get("/api/messages/favorites")
def list_message_favorites(limit: int = 50, user=Depends(require_user)):
    limit = clamp_limit(limit, default=50, max_value=200)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select
                  mf.id as favorite_id,
                  mf.created_at as favorited_at,
                  case when mf.direct_message_id is not null then 'direct' else 'group' end as conversation_type,
                  case
                    when mf.direct_message_id is not null then
                      case when dm.sender_id = :user_id then dm.recipient_id else dm.sender_id end
                    else gm.group_id
                  end as conversation_id,
                  coalesce(mf.direct_message_id, mf.group_message_id) as message_id,
                  coalesce(dm.body_md, gm.body_md) as body_md,
                  coalesce(dm.attachment_filename, gm.attachment_filename) as attachment_filename
                from message_favorites mf
                left join direct_messages dm on dm.id = mf.direct_message_id
                left join group_messages gm on gm.id = mf.group_message_id
                where mf.user_id = :user_id
                order by mf.created_at desc, mf.id desc
                limit :limit
                """
            ),
            {"user_id": user["id"], "limit": limit},
        ).mappings().all()
    return {"items": [dict(row) for row in rows]}


@router.post("/api/messages/favorites")
def create_message_favorite(payload: dict, user=Depends(require_user)):
    conversation_type = normalize_conversation_type(payload.get("conversation_type") or payload.get("scope"))
    message_id = normalize_message_cursor(payload.get("message_id"))
    if message_id is None:
        raise HTTPException(status_code=400, detail="message_id is required")
    column = "direct_message_id" if conversation_type == "direct" else "group_message_id"
    with engine.begin() as conn:
        if conversation_type == "direct":
            get_direct_message_for_user(conn, message_id=message_id, user_id=user["id"])
        else:
            get_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
        conn.execute(
            text(
                f"""
                insert into message_favorites(user_id, {column})
                values (:user_id, :message_id)
                on conflict do nothing
                """
            ),
            {"user_id": user["id"], "message_id": message_id},
        )
    return {"ok": True, "message_id": message_id, "is_favorited": True}


@router.delete("/api/messages/favorites/{conversation_type}/{message_id}")
def delete_message_favorite(conversation_type: str, message_id: int, user=Depends(require_user)):
    normalized_type = normalize_conversation_type(conversation_type)
    column = "direct_message_id" if normalized_type == "direct" else "group_message_id"
    with engine.begin() as conn:
        result = conn.execute(
            text(
                f"""
                delete from message_favorites
                where user_id = :user_id
                  and {column} = :message_id
                """
            ),
            {"user_id": user["id"], "message_id": message_id},
        )
    return {"ok": True, "message_id": message_id, "deleted": int(result.rowcount or 0) > 0}


@router.patch("/api/messages/direct-messages/{message_id}")
def edit_direct_message(message_id: int, payload: dict, user=Depends(require_user)):
    with engine.begin() as conn:
        message = get_direct_message_for_user(conn, message_id=message_id, user_id=user["id"])
        if int(message["sender_id"]) != int(user["id"]):
            raise HTTPException(status_code=403, detail="Only the sender can edit this message")
        require_message_mutation_window(message, action="edited")
        body = normalize_edited_message_body(message, payload)
        conn.execute(
            text(
                """
                update direct_messages
                set body_md = :body_md,
                    edited_at = now(),
                    deleted_at = null,
                    deleted_by_user_id = null
                where id = :message_id
                """
            ),
            {"message_id": message_id, "body_md": body},
        )
    return {"ok": True, "message_id": message_id}


@router.post("/api/messages/direct-messages/{message_id}/recall")
def recall_direct_message(message_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        message = get_direct_message_for_user(conn, message_id=message_id, user_id=user["id"])
        if int(message["sender_id"]) != int(user["id"]):
            raise HTTPException(status_code=403, detail="Only the sender can recall this message")
        if message["deleted_at"]:
            return {"ok": True, "message_id": message_id, "recalled": True}
        require_message_mutation_window(message, action="recalled")
        conn.execute(
            text(
                """
                update direct_messages
                set deleted_at = now(),
                    deleted_by_user_id = :user_id
                where id = :message_id
                """
            ),
            {"message_id": message_id, "user_id": user["id"]},
        )
    return {"ok": True, "message_id": message_id, "recalled": True}


@router.delete("/api/messages/direct-messages/{message_id}")
def delete_direct_message(message_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        get_direct_message_for_user(conn, message_id=message_id, user_id=user["id"])
        hide_direct_message_for_user(conn, message_id=message_id, user_id=user["id"])
    return {"ok": True, "message_id": message_id, "deleted_for_me": True}


@router.patch("/api/messages/group-messages/{message_id}")
def edit_group_message(message_id: int, payload: dict, user=Depends(require_user)):
    with engine.begin() as conn:
        message = get_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
        if int(message["sender_id"]) != int(user["id"]):
            raise HTTPException(status_code=403, detail="Only the sender can edit this message")
        require_message_mutation_window(message, action="edited")
        body = normalize_edited_message_body(message, payload)
        conn.execute(
            text(
                """
                update group_messages
                set body_md = :body_md,
                    edited_at = now(),
                    deleted_at = null,
                    deleted_by_user_id = null
                where id = :message_id
                """
            ),
            {"message_id": message_id, "body_md": body},
        )
    return {"ok": True, "message_id": message_id}


@router.post("/api/messages/group-messages/{message_id}/recall")
def recall_group_message(message_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        message = get_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
        if int(message["sender_id"]) != int(user["id"]):
            raise HTTPException(status_code=403, detail="Only the sender can recall this message")
        if message["deleted_at"]:
            return {"ok": True, "message_id": message_id, "recalled": True}
        require_message_mutation_window(message, action="recalled")
        conn.execute(
            text(
                """
                update group_messages
                set deleted_at = now(),
                    deleted_by_user_id = :user_id
                where id = :message_id
                """
            ),
            {"message_id": message_id, "user_id": user["id"]},
        )
    return {"ok": True, "message_id": message_id, "recalled": True}


@router.delete("/api/messages/group-messages/{message_id}")
def delete_group_message(message_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        get_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
        hide_group_message_for_user(conn, message_id=message_id, user_id=user["id"])
    return {"ok": True, "message_id": message_id, "deleted_for_me": True}


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


@router.post("/api/messages/groups/{group_id}/read")
def mark_group_message_conversation_read(group_id: int, user=Depends(require_user)):
    with engine.begin() as conn:
        group = get_group_membership(conn, group_id=group_id, user_id=user["id"])
        mark_group_messages_read(
            conn,
            group_id=group_id,
            user_id=user["id"],
            joined_at=group["joined_at"],
        )
    return {"ok": True}
