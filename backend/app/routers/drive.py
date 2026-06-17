import mimetypes
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine
from app.dependencies import require_user
from app.rate_limit import check_rate_limit, client_key
from app.services.audit import audit_log
from app.settings import settings
from app.storage import S3_BUCKET_DRIVE, delete_object, get_object, put_bytes

router = APIRouter()

DRIVE_FOLDER_KIND = "FOLDER"
DRIVE_FILE_KIND = "FILE"
DRIVE_NAME_MAX_LENGTH = 180


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


def ensure_name_available(conn, user_id: int, parent_id: int | None, name: str, *, exclude_id: int | None = None) -> None:
    row = conn.execute(
        text(
            """
            select id
            from drive_items
            where owner_id = :owner_id
              and lower(name) = lower(:name)
              and ((parent_id is null and :parent_id is null) or parent_id = :parent_id)
              and (:exclude_id is null or id <> :exclude_id)
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
    with engine.connect() as conn:
        return {"usage": usage_payload(conn, user)}


@router.get("/api/drive/items")
def list_drive_items(parent_id: str | None = Query(None), user=Depends(require_user)):
    user_id = int(user["id"])
    normalized_parent_id = normalize_optional_drive_id(parent_id)

    with engine.connect() as conn:
        parent = require_parent_folder(conn, user_id, normalized_parent_id)
        rows = conn.execute(
            text(
                """
                select id, owner_id, parent_id, kind, name, object_key, content_type, size_bytes, created_at, updated_at
                from drive_items
                where owner_id = :owner_id
                  and ((parent_id is null and :parent_id is null) or parent_id = :parent_id)
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


@router.post("/api/drive/folders")
def create_drive_folder(payload: dict, request: Request, user=Depends(require_user)):
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


@router.patch("/api/drive/items/{item_id}")
def update_drive_item(item_id: int, payload: dict, request: Request, user=Depends(require_user)):
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
    user_id = int(user["id"])
    item_id = parse_item_id(item_id)
    with engine.connect() as conn:
        item = require_drive_item(conn, user_id, item_id)
        if item["kind"] != DRIVE_FILE_KIND:
            raise HTTPException(status_code=400, detail="Folders cannot be downloaded directly")

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
