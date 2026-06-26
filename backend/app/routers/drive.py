import io
import mimetypes
import secrets
import zipfile
from datetime import datetime, timedelta, timezone
from threading import Lock
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine
from app.dependencies import require_admin, require_user
from app.migrations import ensure_drive_schema_compatibility
from app.rate_limit import check_rate_limit, client_key
from app.security import hash_password, verify_password
from app.services.audit import audit_log
from app.settings import settings
from app.storage import S3_BUCKET_DRIVE, delete_object, get_bytes, get_object, put_bytes

router = APIRouter()

DRIVE_FOLDER_KIND = "FOLDER"
DRIVE_FILE_KIND = "FILE"
DRIVE_NAME_MAX_LENGTH = 180
DRIVE_SHARE_TOKEN_BYTES = 24
DRIVE_SHARE_MAX_DAYS = 365
DRIVE_BATCH_MAX_ITEMS = 100
_drive_schema_ready = False
_drive_schema_lock = Lock()


def ensure_drive_schema_ready() -> None:
    global _drive_schema_ready
    if _drive_schema_ready:
        return
    with _drive_schema_lock:
        if _drive_schema_ready:
            return
        ensure_drive_schema_compatibility()
        _drive_schema_ready = True


def normalize_drive_name(value: str | None, *, fallback: str = "Untitled") -> str:
    raw = str(value or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not raw:
        raw = fallback
    name = "".join(ch for ch in raw if ch >= " " and ch not in {"/", "\\", "\x7f"}).strip()
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid item name")
    if len(name) > DRIVE_NAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Item name must be at most {DRIVE_NAME_MAX_LENGTH} characters")
    return name


def normalize_optional_drive_id(value) -> int | None:
    if value in (None, "", "null", "undefined"):
        return None
    try:
        item_id = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid folder id")
    if item_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid folder id")
    return item_id


def drive_parent_filter(parent_id: int | None) -> str:
    return "parent_id is null" if parent_id is None else "parent_id = :parent_id"


def normalize_content_type(filename: str | None, content_type: str | None) -> str:
    normalized = str(content_type or "").split(";", 1)[0].strip().lower()
    if normalized and normalized != "application/octet-stream":
        return normalized
    guessed, _ = mimetypes.guess_type(filename or "")
    return guessed or "application/octet-stream"


def drive_quota_bytes(user: dict) -> int:
    if user.get("role") == "ADMIN":
        return settings.drive_admin_quota_bytes
    return settings.drive_user_quota_bytes


def drive_usage(conn, user_id: int) -> dict:
    row = conn.execute(
        text(
            """
            select
              coalesce(sum(size_bytes) filter (where kind = 'FILE'), 0)::bigint as used_bytes,
              count(*) filter (where kind = 'FILE')::int as file_count,
              count(*) filter (where kind = 'FOLDER')::int as folder_count
            from drive_items
            where owner_id = :owner_id
            """
        ),
        {"owner_id": user_id},
    ).mappings().first()
    return {
        "used_bytes": int(row["used_bytes"] or 0),
        "file_count": int(row["file_count"] or 0),
        "folder_count": int(row["folder_count"] or 0),
    }


def usage_payload(conn, user: dict) -> dict:
    usage = drive_usage(conn, int(user["id"]))
    quota = drive_quota_bytes(user)
    usage["quota_bytes"] = quota
    usage["remaining_bytes"] = max(0, quota - usage["used_bytes"])
    return usage


def row_to_item(row) -> dict:
    if not row:
        return {}
    item = dict(row)
    item["id"] = int(item["id"])
    item["owner_id"] = int(item["owner_id"])
    item["parent_id"] = int(item["parent_id"]) if item.get("parent_id") is not None else None
    item["size_bytes"] = int(item.get("size_bytes") or 0)
    if item.get("kind") == DRIVE_FILE_KIND:
        item["download_url"] = f"/api/drive/items/{item['id']}/download"
    return item


def share_row_to_payload(row, request: Request | None = None) -> dict:
    share = dict(row)
    share["id"] = int(share["id"])
    share["owner_id"] = int(share["owner_id"])
    share["item_id"] = int(share["item_id"])
    share["download_count"] = int(share.get("download_count") or 0)
    share["max_downloads"] = int(share["max_downloads"]) if share.get("max_downloads") is not None else None
    share["requires_password"] = bool(share.get("password_hash"))
    share.pop("password_hash", None)
    share["active"] = is_share_active(share)
    token = share.get("token")
    if token:
        share["page_url"] = public_share_page_url(request, token) if request else f"/share/{token}"
        share["download_url"] = f"/api/drive/shares/{token}/download"
    return share


def public_share_page_url(request: Request | None, token: str) -> str:
    if request is None:
        return f"/share/{token}"
    return f"{request.url.scheme}://{request.url.netloc}/share/{token}"


def parse_datetime(value) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def is_share_expired(expires_at) -> bool:
    expires = parse_datetime(expires_at)
    if expires is None:
        return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires <= datetime.now(timezone.utc)


def is_share_active(row) -> bool:
    if row.get("revoked_at") is not None:
        return False
    if is_share_expired(row.get("expires_at")):
        return False
    max_downloads = row.get("max_downloads")
    if max_downloads is not None and int(row.get("download_count") or 0) >= int(max_downloads):
        return False
    return True


def normalize_share_days(value) -> int | None:
    if value in (None, "", "never", "none"):
        return None
    try:
        days = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid share expiry")
    if days <= 0 or days > DRIVE_SHARE_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Share expiry must be between 1 and {DRIVE_SHARE_MAX_DAYS} days")
    return days


def normalize_max_downloads(value) -> int | None:
    if value in (None, "", 0, "0"):
        return None
    try:
        max_downloads = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid download limit")
    if max_downloads <= 0 or max_downloads > 100000:
        raise HTTPException(status_code=400, detail="Download limit must be between 1 and 100000")
    return max_downloads


def normalize_batch_item_ids(value) -> list[int]:
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="item_ids must be a list")
    item_ids: list[int] = []
    seen: set[int] = set()
    for raw in value:
        item_id = parse_item_id(raw)
        if item_id not in seen:
            item_ids.append(item_id)
            seen.add(item_id)
    if not item_ids:
        raise HTTPException(status_code=400, detail="No drive items selected")
    if len(item_ids) > DRIVE_BATCH_MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"At most {DRIVE_BATCH_MAX_ITEMS} items can be selected")
    return item_ids


def previewable_content_type(content_type: str | None) -> bool:
    value = str(content_type or "").split(";", 1)[0].lower()
    if value.startswith("image/") or value.startswith("text/"):
        return True
    return value in {
        "application/pdf",
        "application/json",
        "application/javascript",
        "application/xml",
        "application/x-javascript",
        "image/svg+xml",
    }


def safe_zip_part(name: str | None, fallback: str = "item") -> str:
    raw = normalize_drive_name(name, fallback=fallback)
    return raw.replace("/", "_").replace("\\", "_")


def unique_zip_name(used: set[str], name: str) -> str:
    candidate = name
    stem = Path(name).stem or name
    suffix = Path(name).suffix
    index = 2
    while candidate.lower() in used:
        candidate = f"{stem} ({index}){suffix}"
        index += 1
    used.add(candidate.lower())
    return candidate


def folder_zip_name(name: str | None) -> str:
    base = Path(safe_zip_part(name, fallback="folder")).stem or "folder"
    return f"{base}.zip"


def drive_tree_rows(conn, user_id: int, item_id: int) -> list[dict]:
    rows = conn.execute(
        text(
            """
            with recursive tree as (
              select id, parent_id, kind, name, object_key, content_type, size_bytes, name::text as rel_path
              from drive_items
              where owner_id = :owner_id and id = :item_id
              union all
              select child.id, child.parent_id, child.kind, child.name, child.object_key, child.content_type,
                     child.size_bytes, tree.rel_path || '/' || child.name
              from drive_items child
              join tree on child.parent_id = tree.id
              where child.owner_id = :owner_id
            )
            select id, parent_id, kind, name, object_key, content_type, size_bytes, rel_path
            from tree
            order by rel_path
            """
        ),
        {"owner_id": user_id, "item_id": item_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def drive_zip_response(rows: list[dict], filename: str) -> StreamingResponse:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for row in rows:
            rel_path = str(row.get("rel_path") or row.get("name") or "item").strip("/")
            if not rel_path:
                continue
            if row.get("kind") == DRIVE_FOLDER_KIND:
                archive.writestr(rel_path.rstrip("/") + "/", b"")
                continue
            archive.writestr(rel_path, get_bytes(S3_BUCKET_DRIVE, row["object_key"]))
    buf.seek(0)
    headers = {
        "Content-Disposition": content_disposition(filename),
        "Content-Length": str(buf.getbuffer().nbytes),
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(iter([buf.getvalue()]), media_type="application/zip", headers=headers)


def selected_items_zip_response(conn, user_id: int, items: list[dict], filename: str = "drive-selection.zip") -> StreamingResponse:
    used_roots: set[str] = set()
    rows: list[dict] = []
    for item in items:
        tree_rows = drive_tree_rows(conn, user_id, int(item["id"]))
        if not tree_rows:
            continue
        old_root = str(tree_rows[0].get("name") or "item")
        new_root = unique_zip_name(used_roots, safe_zip_part(old_root, fallback="item"))
        for row in tree_rows:
            rel_path = str(row.get("rel_path") or row.get("name") or "item")
            if rel_path == old_root:
                row["rel_path"] = new_root
            elif rel_path.startswith(old_root + "/"):
                row["rel_path"] = new_root + rel_path[len(old_root):]
            rows.append(row)
    return drive_zip_response(rows, filename)


def require_parent_folder(conn, user_id: int, parent_id: int | None) -> dict | None:
    if parent_id is None:
        return None
    row = conn.execute(
        text(
            """
            select id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
            from drive_items
            where owner_id = :owner_id and id = :parent_id and kind = 'FOLDER'
            """
        ),
        {"owner_id": user_id, "parent_id": parent_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Folder not found")
    return row_to_item(row)


def require_drive_item(conn, user_id: int, item_id: int):
    row = conn.execute(
        text(
            """
            select id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
            from drive_items
            where owner_id = :owner_id and id = :item_id
            """
        ),
        {"owner_id": user_id, "item_id": item_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Drive item not found")
    return row


def require_drive_items(conn, user_id: int, item_ids: list[int]) -> list[dict]:
    rows = []
    for item_id in item_ids:
        rows.append(row_to_item(require_drive_item(conn, user_id, item_id)))
    return rows


def require_share_for_owner(conn, user_id: int, share_id: int):
    row = conn.execute(
        text(
            """
            select s.id, s.owner_id, s.item_id, s.token, s.password_hash, s.expires_at, s.max_downloads,
                   s.download_count, s.created_at, s.revoked_at,
                   i.kind, i.name, i.content_type, i.size_bytes
            from drive_shares s
            join drive_items i on i.id = s.item_id and i.owner_id = s.owner_id
            where s.owner_id = :owner_id and s.id = :share_id
            """
        ),
        {"owner_id": user_id, "share_id": share_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Share not found")
    return row


def require_share_by_token(conn, token: str):
    row = conn.execute(
        text(
            """
            select s.id, s.owner_id, s.item_id, s.token, s.password_hash, s.expires_at, s.max_downloads,
                   s.download_count, s.created_at, s.revoked_at,
                   i.parent_id, i.kind, i.name, i.object_key, i.content_type, i.size_bytes,
                   u.username as owner_username
            from drive_shares s
            join drive_items i on i.id = s.item_id and i.owner_id = s.owner_id
            join users u on u.id = s.owner_id
            where s.token = :token
            """
        ),
        {"token": token},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Share not found")
    if row["revoked_at"] is not None:
        raise HTTPException(status_code=404, detail="Share not found")
    if is_share_expired(row["expires_at"]):
        raise HTTPException(status_code=410, detail="Share has expired")
    if row["max_downloads"] is not None and int(row["download_count"] or 0) >= int(row["max_downloads"]):
        raise HTTPException(status_code=410, detail="Share download limit reached")
    return row


def ensure_share_password(row, password: str | None) -> None:
    stored = row.get("password_hash")
    if not stored:
        return
    if not password or not verify_password(password, stored):
        raise HTTPException(status_code=403, detail="Invalid share password")


def ensure_name_available(conn, user_id: int, parent_id: int | None, name: str, *, exclude_id: int | None = None) -> None:
    parent_filter = drive_parent_filter(parent_id)
    exclude_filter = "and id <> :exclude_id" if exclude_id is not None else ""
    row = conn.execute(
        text(
            f"""
            select id
            from drive_items
            where owner_id = :owner_id
              and lower(name) = lower(:name)
              and {parent_filter}
              {exclude_filter}
            limit 1
            """
        ),
        {"owner_id": user_id, "parent_id": parent_id, "name": name, "exclude_id": exclude_id},
    ).first()
    if row:
        raise HTTPException(status_code=409, detail="An item with this name already exists in the folder")


def ensure_not_descendant(conn, user_id: int, item_id: int, parent_id: int | None) -> None:
    if parent_id is None:
        return
    row = conn.execute(
        text(
            """
            with recursive tree as (
              select id
              from drive_items
              where owner_id = :owner_id and id = :item_id
              union all
              select child.id
              from drive_items child
              join tree on child.parent_id = tree.id
              where child.owner_id = :owner_id
            )
            select id from tree where id = :parent_id limit 1
            """
        ),
        {"owner_id": user_id, "item_id": item_id, "parent_id": parent_id},
    ).first()
    if row:
        raise HTTPException(status_code=400, detail="Cannot move a folder into itself")


def content_disposition(filename: str | None) -> str:
    name = normalize_drive_name(filename, fallback="download")
    ascii_name = "".join(ch if 32 <= ord(ch) < 127 and ch not in {'"', "\\"} else "_" for ch in name)
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(name)}'


def object_suffix(filename: str, content_type: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if not suffix or len(suffix) > 24:
        suffix = mimetypes.guess_extension(content_type) or ".bin"
    if suffix == ".jpeg":
        suffix = ".jpg"
    return suffix


def parse_item_id(item_id: int) -> int:
    if int(item_id) <= 0:
        raise HTTPException(status_code=400, detail="Invalid item id")
    return int(item_id)


@router.get("/api/drive/summary")
def drive_summary(user=Depends(require_user)):
    ensure_drive_schema_ready()
    with engine.connect() as conn:
        return {"usage": usage_payload(conn, user)}


@router.get("/api/admin/drive/overview")
def admin_drive_overview(user=Depends(require_admin)):
    ensure_drive_schema_ready()
    user_quota = settings.drive_user_quota_bytes
    admin_quota = settings.drive_admin_quota_bytes

    with engine.connect() as conn:
        summary = conn.execute(
            text(
                """
                with item_counts as (
                  select
                    coalesce(sum(size_bytes) filter (where kind = 'FILE'), 0)::bigint as used_bytes,
                    count(*) filter (where kind = 'FILE')::int as file_count,
                    count(*) filter (where kind = 'FOLDER')::int as folder_count,
                    count(distinct owner_id)::int as user_count,
                    count(*) filter (where kind = 'FILE' and created_at::date = current_date)::int as today_file_count,
                    coalesce(sum(size_bytes) filter (where kind = 'FILE' and created_at::date = current_date), 0)::bigint as today_uploaded_bytes
                  from drive_items
                ),
                share_counts as (
                  select
                    count(*)::int as share_count,
                    count(*) filter (
                      where revoked_at is null
                        and (expires_at is null or expires_at > now())
                        and (max_downloads is null or download_count < max_downloads)
                    )::int as active_share_count,
                    count(*) filter (where revoked_at is not null)::int as revoked_share_count,
                    count(*) filter (where revoked_at is null and expires_at is not null and expires_at <= now())::int as expired_share_count,
                    coalesce(sum(download_count), 0)::int as share_download_count
                  from drive_shares
                ),
                quota_risk as (
                  select count(*)::int as near_quota_user_count
                  from (
                    select
                      u.id,
                      coalesce(sum(di.size_bytes) filter (where di.kind = 'FILE'), 0)::bigint as used_bytes,
                      (case when u.role = 'ADMIN' then :admin_quota else :user_quota end)::bigint as quota_bytes
                    from users u
                    left join drive_items di on di.owner_id = u.id
                    group by u.id, u.role
                  ) usage
                  where quota_bytes > 0 and used_bytes::numeric / quota_bytes::numeric >= 0.8
                )
                select *
                from item_counts, share_counts, quota_risk
                """
            ),
            {"user_quota": user_quota, "admin_quota": admin_quota},
        ).mappings().first()

        daily_uploads = conn.execute(
            text(
                """
                select created_at::date as day,
                       count(*)::int as file_count,
                       coalesce(sum(size_bytes), 0)::bigint as uploaded_bytes
                from drive_items
                where kind = 'FILE' and created_at >= current_date - interval '6 days'
                group by created_at::date
                order by day
                """
            )
        ).mappings().all()

        file_type_counts = conn.execute(
            text(
                """
                select
                  case
                    when content_type is null or content_type = '' then 'other'
                    when split_part(content_type, '/', 1) in ('image', 'video', 'audio', 'text') then split_part(content_type, '/', 1)
                    when content_type = 'application/pdf' then 'pdf'
                    when content_type like 'application/zip%' then 'archive'
                    else 'other'
                  end as type,
                  count(*)::int as count,
                  coalesce(sum(size_bytes), 0)::bigint as bytes
                from drive_items
                where kind = 'FILE'
                group by type
                order by bytes desc, count desc, type asc
                """
            )
        ).mappings().all()

        share_status_counts = conn.execute(
            text(
                """
                select status, count(*)::int as count
                from (
                  select
                    case
                      when revoked_at is not null then 'REVOKED'
                      when expires_at is not null and expires_at <= now() then 'EXPIRED'
                      when max_downloads is not null and download_count >= max_downloads then 'LIMITED'
                      else 'ACTIVE'
                    end as status
                  from drive_shares
                ) statuses
                group by status
                order by status
                """
            )
        ).mappings().all()

        top_users = conn.execute(
            text(
                """
                select
                  u.id,
                  u.username,
                  u.role,
                  coalesce(sum(di.size_bytes) filter (where di.kind = 'FILE'), 0)::bigint as used_bytes,
                  count(di.id) filter (where di.kind = 'FILE')::int as file_count,
                  (case when u.role = 'ADMIN' then :admin_quota else :user_quota end)::bigint as quota_bytes
                from users u
                left join drive_items di on di.owner_id = u.id
                group by u.id, u.username, u.role
                having coalesce(sum(di.size_bytes) filter (where di.kind = 'FILE'), 0) > 0
                order by used_bytes desc, u.id asc
                limit 8
                """
            ),
            {"user_quota": user_quota, "admin_quota": admin_quota},
        ).mappings().all()

        heavy_shares = conn.execute(
            text(
                """
                select
                  s.id,
                  s.created_at,
                  s.download_count,
                  s.max_downloads,
                  s.expires_at,
                  i.name,
                  i.kind,
                  i.size_bytes,
                  u.username as owner_username,
                  case
                    when s.revoked_at is not null then 'REVOKED'
                    when s.expires_at is not null and s.expires_at <= now() then 'EXPIRED'
                    when s.max_downloads is not null and s.download_count >= s.max_downloads then 'LIMITED'
                    else 'ACTIVE'
                  end as status
                from drive_shares s
                join drive_items i on i.id = s.item_id and i.owner_id = s.owner_id
                join users u on u.id = s.owner_id
                order by s.download_count desc, s.created_at desc, s.id desc
                limit 8
                """
            )
        ).mappings().all()

        recent_audit = conn.execute(
            text(
                """
                select a.id, a.created_at, a.action, a.resource_type, a.resource_id, u.username
                from audit_logs a
                left join users u on u.id = a.user_id
                where a.action like 'drive.%'
                order by a.created_at desc, a.id desc
                limit 8
                """
            )
        ).mappings().all()

    return {
        "summary": dict(summary or {}),
        "daily_uploads": [dict(row) for row in daily_uploads],
        "file_type_counts": [dict(row) for row in file_type_counts],
        "share_status_counts": [dict(row) for row in share_status_counts],
        "top_users": [dict(row) for row in top_users],
        "heavy_shares": [dict(row) for row in heavy_shares],
        "recent_audit": [dict(row) for row in recent_audit],
    }


@router.get("/api/drive/items")
def list_drive_items(parent_id: str | None = Query(None), user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    normalized_parent_id = normalize_optional_drive_id(parent_id)

    with engine.connect() as conn:
        parent = require_parent_folder(conn, user_id, normalized_parent_id)
        parent_filter = drive_parent_filter(normalized_parent_id)
        rows = conn.execute(
            text(
                f"""
                select id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
                from drive_items
                where owner_id = :owner_id
                  and {parent_filter}
                order by case when kind = 'FOLDER' then 0 else 1 end, lower(name), id
                """
            ),
            {"owner_id": user_id, "parent_id": normalized_parent_id},
        ).mappings().all()

        breadcrumbs = [{"id": None, "name": "My Drive"}]
        if normalized_parent_id is not None:
            crumb_rows = conn.execute(
                text(
                    """
                    with recursive crumbs as (
                      select id, parent_id, name, 0 as depth
                      from drive_items
                      where owner_id = :owner_id and id = :parent_id and kind = 'FOLDER'
                      union all
                      select parent.id, parent.parent_id, parent.name, crumbs.depth + 1
                      from drive_items parent
                      join crumbs on crumbs.parent_id = parent.id
                      where parent.owner_id = :owner_id
                    )
                    select id, name
                    from crumbs
                    order by depth desc
                    """
                ),
                {"owner_id": user_id, "parent_id": normalized_parent_id},
            ).mappings().all()
            breadcrumbs.extend({"id": int(row["id"]), "name": row["name"]} for row in crumb_rows)

        return {
            "parent": parent,
            "breadcrumbs": breadcrumbs,
            "items": [row_to_item(row) for row in rows],
            "usage": usage_payload(conn, user),
        }


@router.get("/api/drive/search")
def search_drive_items(q: str = Query(..., min_length=1), user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query is required")
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
                from drive_items
                where owner_id = :owner_id
                  and lower(name) like lower(:pattern)
                order by updated_at desc, lower(name), id
                limit 100
                """
            ),
            {"owner_id": user_id, "pattern": f"%{query}%"},
        ).mappings().all()
        return {"items": [row_to_item(row) for row in rows]}


@router.post("/api/drive/batch/move")
def move_drive_items(payload: dict, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    check_rate_limit(client_key(request, "drive-batch-move", str(user_id)), max_calls=120, window_seconds=3600)
    item_ids = normalize_batch_item_ids(payload.get("item_ids"))
    parent_id = normalize_optional_drive_id(payload.get("parent_id"))

    with engine.begin() as conn:
        require_parent_folder(conn, user_id, parent_id)
        items = require_drive_items(conn, user_id, item_ids)
        selected_names: set[str] = set()
        for item in items:
            name_key = str(item["name"]).lower()
            if name_key in selected_names:
                raise HTTPException(status_code=409, detail="Selected items contain duplicate names")
            selected_names.add(name_key)
            if item["kind"] == DRIVE_FOLDER_KIND:
                ensure_not_descendant(conn, user_id, int(item["id"]), parent_id)
            ensure_name_available(conn, user_id, parent_id, item["name"], exclude_id=int(item["id"]))
        rows = []
        for item in items:
            row = conn.execute(
                text(
                    """
                    update drive_items
                    set parent_id = :parent_id, updated_at = now()
                    where owner_id = :owner_id and id = :item_id
                    returning id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
                    """
                ),
                {"owner_id": user_id, "item_id": int(item["id"]), "parent_id": parent_id},
            ).mappings().first()
            rows.append(row_to_item(row))
        audit_log(
            conn,
            user_id=user_id,
            action="drive.items.move",
            resource_type="drive_item",
            metadata={"item_ids": item_ids, "parent_id": parent_id},
        )
        return {"items": rows, "usage": usage_payload(conn, user)}


@router.post("/api/drive/batch/delete")
def delete_drive_items(payload: dict, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    check_rate_limit(client_key(request, "drive-batch-delete", str(user_id)), max_calls=120, window_seconds=3600)
    item_ids = normalize_batch_item_ids(payload.get("item_ids"))

    with engine.begin() as conn:
        items = require_drive_items(conn, user_id, item_ids)
        object_keys: set[str] = set()
        for item in items:
            for row in drive_tree_rows(conn, user_id, int(item["id"])):
                if row["kind"] == DRIVE_FILE_KIND and row.get("object_key"):
                    object_keys.add(row["object_key"])
        for item in items:
            conn.execute(
                text("delete from drive_items where owner_id = :owner_id and id = :item_id"),
                {"owner_id": user_id, "item_id": int(item["id"])},
            )
        audit_log(
            conn,
            user_id=user_id,
            action="drive.items.delete",
            resource_type="drive_item",
            metadata={"item_ids": item_ids, "object_count": len(object_keys)},
        )
        usage = usage_payload(conn, user)

    for object_key in object_keys:
        try:
            delete_object(S3_BUCKET_DRIVE, object_key)
        except Exception:
            pass
    return {"ok": True, "deleted_item_count": len(items), "deleted_object_count": len(object_keys), "usage": usage}


@router.post("/api/drive/batch/download")
def download_drive_items_zip(payload: dict, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    item_ids = normalize_batch_item_ids(payload.get("item_ids"))
    with engine.connect() as conn:
        items = require_drive_items(conn, user_id, item_ids)
        return selected_items_zip_response(conn, user_id, items)


@router.post("/api/drive/folders")
def create_drive_folder(payload: dict, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    check_rate_limit(client_key(request, "drive-folder", str(user_id)), max_calls=120, window_seconds=3600)
    parent_id = normalize_optional_drive_id(payload.get("parent_id"))
    name = normalize_drive_name(payload.get("name"), fallback="New Folder")

    try:
        with engine.begin() as conn:
            require_parent_folder(conn, user_id, parent_id)
            ensure_name_available(conn, user_id, parent_id, name)
            row = conn.execute(
                text(
                    """
                    insert into drive_items(owner_id, parent_id, kind, name)
                    values (:owner_id, :parent_id, 'FOLDER', :name)
                    returning id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
                    """
                ),
                {"owner_id": user_id, "parent_id": parent_id, "name": name},
            ).mappings().first()
            audit_log(
                conn,
                user_id=user_id,
                action="drive.folder.create",
                resource_type="drive_item",
                resource_id=row["id"],
                metadata={"parent_id": parent_id, "name": name},
            )
            return {"item": row_to_item(row), "usage": usage_payload(conn, user)}
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="An item with this name already exists in the folder") from exc


@router.post("/api/drive/files")
async def upload_drive_file(
    request: Request,
    parent_id: str | None = Form(None),
    file: UploadFile = File(...),
    user=Depends(require_user),
):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    check_rate_limit(client_key(request, "drive-upload", str(user_id)), max_calls=120, window_seconds=3600)
    normalized_parent_id = normalize_optional_drive_id(parent_id)
    filename = normalize_drive_name(file.filename, fallback="upload.bin")
    content_type = normalize_content_type(filename, file.content_type)
    data = await file.read()

    if len(data) > settings.max_drive_file_bytes:
        limit_mb = settings.max_drive_file_mb
        raise HTTPException(status_code=400, detail=f"File must be at most {limit_mb} MB")

    with engine.connect() as conn:
        require_parent_folder(conn, user_id, normalized_parent_id)
        ensure_name_available(conn, user_id, normalized_parent_id, filename)
        usage = usage_payload(conn, user)
        if usage["used_bytes"] + len(data) > usage["quota_bytes"]:
            raise HTTPException(status_code=400, detail="Drive quota exceeded")

    suffix = object_suffix(filename, content_type)
    object_key = f"drive/{user_id}/{uuid4().hex}{suffix}"
    try:
        put_bytes(S3_BUCKET_DRIVE, object_key, data, content_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to store file") from exc

    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    """
                    insert into drive_items(owner_id, parent_id, kind, name, object_key, content_type, size_bytes)
                    values (:owner_id, :parent_id, 'FILE', :name, :object_key, :content_type, :size_bytes)
                    returning id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
                    """
                ),
                {
                    "owner_id": user_id,
                    "parent_id": normalized_parent_id,
                    "name": filename,
                    "object_key": object_key,
                    "content_type": content_type,
                    "size_bytes": len(data),
                },
            ).mappings().first()
            audit_log(
                conn,
                user_id=user_id,
                action="drive.file.upload",
                resource_type="drive_item",
                resource_id=row["id"],
                metadata={"parent_id": normalized_parent_id, "name": filename, "size_bytes": len(data)},
            )
            return {"item": row_to_item(row), "usage": usage_payload(conn, user)}
    except IntegrityError as exc:
        try:
            delete_object(S3_BUCKET_DRIVE, object_key)
        except Exception:
            pass
        raise HTTPException(status_code=409, detail="An item with this name already exists in the folder") from exc


@router.get("/api/drive/items/{item_id}/preview")
def preview_drive_item(item_id: int, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    item_id = parse_item_id(item_id)
    with engine.connect() as conn:
        item = require_drive_item(conn, user_id, item_id)
        if item["kind"] != DRIVE_FILE_KIND:
            raise HTTPException(status_code=400, detail="Folders cannot be previewed")
        if not previewable_content_type(item["content_type"]):
            raise HTTPException(status_code=400, detail="This file type cannot be previewed")

    try:
        obj = get_object(S3_BUCKET_DRIVE, item["object_key"])
    except ClientError as exc:
        raise HTTPException(status_code=404, detail="Stored file not found") from exc

    headers = {
        "Content-Disposition": f"inline; {content_disposition(item['name']).split('; ', 1)[1]}",
        "Content-Length": str(int(item["size_bytes"] if item["size_bytes"] is not None else obj.get("ContentLength") or 0)),
    }
    return StreamingResponse(
        obj["Body"].iter_chunks(chunk_size=1024 * 256),
        media_type=item["content_type"] or "application/octet-stream",
        headers=headers,
    )


@router.get("/api/drive/items/{item_id}/shares")
def list_drive_shares(item_id: int, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    item_id = parse_item_id(item_id)
    with engine.connect() as conn:
        require_drive_item(conn, user_id, item_id)
        rows = conn.execute(
            text(
                """
                select id, owner_id, item_id, token, password_hash, expires_at, max_downloads,
                       download_count, created_at, revoked_at
                from drive_shares
                where owner_id = :owner_id and item_id = :item_id and revoked_at is null
                order by created_at desc, id desc
                """
            ),
            {"owner_id": user_id, "item_id": item_id},
        ).mappings().all()
        return {"shares": [share_row_to_payload(row, request) for row in rows]}


@router.post("/api/drive/items/{item_id}/shares")
def create_drive_share(item_id: int, payload: dict, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    item_id = parse_item_id(item_id)
    check_rate_limit(client_key(request, "drive-share", str(user_id)), max_calls=120, window_seconds=3600)
    expires_in_days = normalize_share_days(payload.get("expires_in_days"))
    max_downloads = normalize_max_downloads(payload.get("max_downloads"))
    password = str(payload.get("password") or "").strip()
    password_hash = hash_password(password) if password else None
    expires_at = datetime.now(timezone.utc) + timedelta(days=expires_in_days) if expires_in_days else None
    token = secrets.token_urlsafe(DRIVE_SHARE_TOKEN_BYTES)

    with engine.begin() as conn:
        item = require_drive_item(conn, user_id, item_id)
        row = conn.execute(
            text(
                """
                insert into drive_shares(owner_id, item_id, token, password_hash, expires_at, max_downloads)
                values (:owner_id, :item_id, :token, :password_hash, :expires_at, :max_downloads)
                returning id, owner_id, item_id, token, password_hash, expires_at, max_downloads,
                          download_count, created_at, revoked_at
                """
            ),
            {
                "owner_id": user_id,
                "item_id": item_id,
                "token": token,
                "password_hash": password_hash,
                "expires_at": expires_at,
                "max_downloads": max_downloads,
            },
        ).mappings().first()
        audit_log(
            conn,
            user_id=user_id,
            action="drive.share.create",
            resource_type="drive_item",
            resource_id=item_id,
            metadata={
                "name": item["name"],
                "kind": item["kind"],
                "expires_at": expires_at.isoformat() if expires_at else None,
                "max_downloads": max_downloads,
                "password": bool(password_hash),
            },
        )
        return {"share": share_row_to_payload(row, request)}


@router.delete("/api/drive/shares/{share_id}")
def revoke_drive_share(share_id: int, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    share_id = parse_item_id(share_id)
    check_rate_limit(client_key(request, "drive-share-revoke", str(user_id)), max_calls=120, window_seconds=3600)
    with engine.begin() as conn:
        row = require_share_for_owner(conn, user_id, share_id)
        conn.execute(
            text("update drive_shares set revoked_at = now() where owner_id = :owner_id and id = :share_id"),
            {"owner_id": user_id, "share_id": share_id},
        )
        audit_log(
            conn,
            user_id=user_id,
            action="drive.share.revoke",
            resource_type="drive_share",
            resource_id=share_id,
            metadata={"item_id": int(row["item_id"]), "token": row["token"]},
        )
    return {"ok": True}


@router.get("/api/drive/shares/{token}")
def public_drive_share(token: str):
    ensure_drive_schema_ready()
    with engine.connect() as conn:
        row = require_share_by_token(conn, token)
        return {
            "share": {
                "token": row["token"],
                "name": row["name"],
                "kind": row["kind"],
                "content_type": row["content_type"],
                "size_bytes": int(row["size_bytes"] or 0),
                "owner_username": row["owner_username"],
                "expires_at": row["expires_at"],
                "max_downloads": int(row["max_downloads"]) if row["max_downloads"] is not None else None,
                "download_count": int(row["download_count"] or 0),
                "requires_password": bool(row["password_hash"]),
                "previewable": row["kind"] == DRIVE_FILE_KIND and previewable_content_type(row["content_type"]),
                "download_url": f"/api/drive/shares/{token}/download",
                "preview_url": f"/api/drive/shares/{token}/preview",
            }
        }


@router.get("/api/drive/shares/{token}/preview")
def preview_public_drive_share(token: str, password: str | None = Query(None)):
    ensure_drive_schema_ready()
    with engine.connect() as conn:
        row = require_share_by_token(conn, token)
        ensure_share_password(row, password)
        if row["kind"] != DRIVE_FILE_KIND:
            raise HTTPException(status_code=400, detail="Folders cannot be previewed")
        if not previewable_content_type(row["content_type"]):
            raise HTTPException(status_code=400, detail="This file type cannot be previewed")

    try:
        obj = get_object(S3_BUCKET_DRIVE, row["object_key"])
    except ClientError as exc:
        raise HTTPException(status_code=404, detail="Stored file not found") from exc
    headers = {
        "Content-Disposition": f"inline; {content_disposition(row['name']).split('; ', 1)[1]}",
        "Content-Length": str(int(row["size_bytes"] if row["size_bytes"] is not None else obj.get("ContentLength") or 0)),
    }
    return StreamingResponse(
        obj["Body"].iter_chunks(chunk_size=1024 * 256),
        media_type=row["content_type"] or "application/octet-stream",
        headers=headers,
    )


@router.get("/api/drive/shares/{token}/download")
def download_public_drive_share(token: str, password: str | None = Query(None)):
    ensure_drive_schema_ready()
    with engine.begin() as conn:
        row = require_share_by_token(conn, token)
        ensure_share_password(row, password)
        updated = conn.execute(
            text(
                """
                update drive_shares
                set download_count = download_count + 1
                where id = :share_id
                  and revoked_at is null
                  and (expires_at is null or expires_at > now())
                  and (max_downloads is null or download_count < max_downloads)
                returning download_count
                """
            ),
            {"share_id": int(row["id"])},
        ).first()
        if not updated:
            raise HTTPException(status_code=410, detail="Share is no longer available")
        item = dict(row)
        if item["kind"] == DRIVE_FOLDER_KIND:
            rows = drive_tree_rows(conn, int(item["owner_id"]), int(item["item_id"]))
            return drive_zip_response(rows, folder_zip_name(item["name"]))

    try:
        obj = get_object(S3_BUCKET_DRIVE, item["object_key"])
    except ClientError as exc:
        raise HTTPException(status_code=404, detail="Stored file not found") from exc
    headers = {
        "Content-Disposition": content_disposition(item["name"]),
        "Content-Length": str(int(item["size_bytes"] if item["size_bytes"] is not None else obj.get("ContentLength") or 0)),
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(
        obj["Body"].iter_chunks(chunk_size=1024 * 256),
        media_type=item["content_type"] or "application/octet-stream",
        headers=headers,
    )


@router.patch("/api/drive/items/{item_id}")
def update_drive_item(item_id: int, payload: dict, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    item_id = parse_item_id(item_id)
    check_rate_limit(client_key(request, "drive-update", str(user_id)), max_calls=240, window_seconds=3600)

    with engine.begin() as conn:
        item = require_drive_item(conn, user_id, item_id)
        new_name = normalize_drive_name(payload.get("name", item["name"]), fallback=item["name"])
        has_parent = "parent_id" in payload
        new_parent_id = normalize_optional_drive_id(payload.get("parent_id")) if has_parent else item["parent_id"]
        require_parent_folder(conn, user_id, new_parent_id)
        if item["kind"] == DRIVE_FOLDER_KIND:
            ensure_not_descendant(conn, user_id, item_id, new_parent_id)
        ensure_name_available(conn, user_id, new_parent_id, new_name, exclude_id=item_id)
        row = conn.execute(
            text(
                """
                update drive_items
                set name = :name,
                    parent_id = :parent_id,
                    updated_at = now()
                where owner_id = :owner_id and id = :item_id
                returning id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
                """
            ),
            {
                "owner_id": user_id,
                "item_id": item_id,
                "name": new_name,
                "parent_id": new_parent_id,
            },
        ).mappings().first()
        audit_log(
            conn,
            user_id=user_id,
            action="drive.item.update",
            resource_type="drive_item",
            resource_id=item_id,
            metadata={"name": new_name, "parent_id": new_parent_id},
        )
        return {"item": row_to_item(row), "usage": usage_payload(conn, user)}


@router.delete("/api/drive/items/{item_id}")
def delete_drive_item(item_id: int, request: Request, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    item_id = parse_item_id(item_id)
    check_rate_limit(client_key(request, "drive-delete", str(user_id)), max_calls=120, window_seconds=3600)

    with engine.begin() as conn:
        root = require_drive_item(conn, user_id, item_id)
        rows = conn.execute(
            text(
                """
                with recursive tree as (
                  select id, kind, object_key
                  from drive_items
                  where owner_id = :owner_id and id = :item_id
                  union all
                  select child.id, child.kind, child.object_key
                  from drive_items child
                  join tree on child.parent_id = tree.id
                  where child.owner_id = :owner_id
                )
                select id, kind, object_key from tree
                """
            ),
            {"owner_id": user_id, "item_id": item_id},
        ).mappings().all()
        object_keys = [row["object_key"] for row in rows if row["kind"] == DRIVE_FILE_KIND and row["object_key"]]
        conn.execute(
            text("delete from drive_items where owner_id = :owner_id and id = :item_id"),
            {"owner_id": user_id, "item_id": item_id},
        )
        audit_log(
            conn,
            user_id=user_id,
            action="drive.item.delete",
            resource_type="drive_item",
            resource_id=item_id,
            metadata={"name": root["name"], "kind": root["kind"], "object_count": len(object_keys)},
        )
        usage = usage_payload(conn, user)

    for object_key in object_keys:
        try:
            delete_object(S3_BUCKET_DRIVE, object_key)
        except Exception:
            pass
    return {"ok": True, "deleted_object_count": len(object_keys), "usage": usage}


@router.get("/api/drive/items/{item_id}/download")
def download_drive_item(item_id: int, user=Depends(require_user)):
    ensure_drive_schema_ready()
    user_id = int(user["id"])
    item_id = parse_item_id(item_id)
    with engine.connect() as conn:
        item = require_drive_item(conn, user_id, item_id)
        if item["kind"] == DRIVE_FOLDER_KIND:
            rows = drive_tree_rows(conn, user_id, item_id)
            return drive_zip_response(rows, folder_zip_name(item["name"]))

    try:
        obj = get_object(S3_BUCKET_DRIVE, item["object_key"])
    except ClientError as exc:
        raise HTTPException(status_code=404, detail="Stored file not found") from exc

    headers = {
        "Content-Disposition": content_disposition(item["name"]),
        "Content-Length": str(int(item["size_bytes"] if item["size_bytes"] is not None else obj.get("ContentLength") or 0)),
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(
        obj["Body"].iter_chunks(chunk_size=1024 * 256),
        media_type=item["content_type"] or "application/octet-stream",
        headers=headers,
    )
