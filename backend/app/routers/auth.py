import re
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_user
from app.rate_limit import check_rate_limit, client_key
from app.security import hash_password, make_token, verify_password
from app.services.audit import audit_log
from app.services.system_settings import get_setting_bool
from app.storage import S3_BUCKET_AVATARS, delete_object, get_bytes, put_bytes
from app.user_profiles import serialize_user, validate_avatar_upload

router = APIRouter()

USERNAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,49}")


@router.post("/api/auth/register")
def register(payload: dict, request: Request):
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip() or None
    password = payload.get("password") or ""
    check_rate_limit(client_key(request, "auth-register", username.lower()), max_calls=5, window_seconds=600)

    if not USERNAME_PATTERN.fullmatch(username):
        raise HTTPException(status_code=400, detail="Invalid username")
    if email and (len(email) > 254 or "@" not in email):
        raise HTTPException(status_code=400, detail="Invalid email")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not get_setting_bool("registration_enabled", True):
        raise HTTPException(status_code=403, detail="Registration is disabled")

    with engine.begin() as conn:
        try:
            row = conn.execute(
                text(
                    """
                    insert into users(username, email, password_hash, role)
                    values (:username, :email, :password_hash, 'USER')
                    returning id, username, email, role, created_at, avatar_object_key, avatar_updated_at
                    """
                ),
                {"username": username, "email": email, "password_hash": hash_password(password)},
            ).mappings().first()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Username or email already exists") from exc

    user = serialize_user(row)
    return {"token": make_token(user["id"], user["username"], user["role"]), "user": user}


@router.post("/api/auth/login")
def login(payload: dict, request: Request):
    key = (payload.get("username_or_email") or "").strip()
    password = payload.get("password") or ""
    check_rate_limit(client_key(request, "auth-login", key.lower()), max_calls=10, window_seconds=300)

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                select
                  id,
                  username,
                  email,
                  password_hash,
                  role,
                  created_at,
                  avatar_object_key,
                  avatar_updated_at,
                  coalesce(is_disabled, false) as is_disabled
                from users
                where username = :key or email = :key
                limit 1
                """
            ),
            {"key": key},
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        if bool(row["is_disabled"]):
            raise HTTPException(status_code=403, detail="User is disabled")
        if not verify_password(password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid username or password")

    user = serialize_user(row)
    return {"token": make_token(user["id"], user["username"], user["role"]), "user": user}


@router.get("/api/auth/me")
def auth_me(user=Depends(require_user)):
    return {"user": user}


@router.post("/api/auth/change-password")
def auth_change_password(payload: dict, user=Depends(require_user)):
    old_password = payload.get("old_password") or ""
    new_password = payload.get("new_password") or ""

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    with engine.begin() as conn:
        row = conn.execute(
            text("select id, password_hash from users where id = :id"),
            {"id": user["id"]},
        ).mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        if not verify_password(old_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        conn.execute(
            text("update users set password_hash = :password_hash where id = :id"),
            {"id": user["id"], "password_hash": hash_password(new_password)},
        )

    return {"ok": True}


@router.post("/api/auth/avatar")
async def auth_update_avatar(
    request: Request,
    avatar: UploadFile = File(...),
    user=Depends(require_user),
):
    check_rate_limit(client_key(request, "auth-avatar", str(user["id"])), max_calls=20, window_seconds=3600)
    avatar_bytes = await avatar.read()
    content_type, suffix = validate_avatar_upload(avatar.filename, avatar.content_type, avatar_bytes)
    object_key = f"avatars/{user['id']}/{uuid4().hex}{suffix}"

    try:
        put_bytes(S3_BUCKET_AVATARS, object_key, avatar_bytes, content_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to store avatar") from exc

    previous_avatar = None
    try:
        with engine.begin() as conn:
            previous_avatar = conn.execute(
                text(
                    """
                    select avatar_object_key, avatar_content_type, avatar_updated_at
                    from users
                    where id = :id
                    """
                ),
                {"id": user["id"]},
            ).mappings().first()

            row = conn.execute(
                text(
                    """
                    update users
                    set avatar_object_key = :avatar_object_key,
                        avatar_content_type = :avatar_content_type,
                        avatar_updated_at = now()
                    where id = :id
                    returning id, username, email, role, created_at, avatar_object_key, avatar_updated_at
                    """
                ),
                {
                    "id": user["id"],
                    "avatar_object_key": object_key,
                    "avatar_content_type": content_type,
                },
            ).mappings().first()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")

            audit_log(
                conn,
                user_id=user["id"],
                action="auth.avatar.update",
                resource_type="user",
                resource_id=user["id"],
                metadata={"content_type": content_type, "size_bytes": len(avatar_bytes)},
            )
    except Exception:
        try:
            delete_object(S3_BUCKET_AVATARS, object_key)
        except Exception:
            pass
        raise

    previous_key = (previous_avatar or {}).get("avatar_object_key")
    if previous_key and previous_key != object_key:
        try:
            delete_object(S3_BUCKET_AVATARS, previous_key)
        except Exception:
            pass

    return {"ok": True, "user": serialize_user(row)}


@router.get("/api/users/{user_id}/avatar")
def get_user_avatar(user_id: int):
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select avatar_object_key, avatar_content_type
                from users
                where id = :id
                  and avatar_object_key is not null
                """
            ),
            {"id": user_id},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Avatar not found")

    try:
        avatar_bytes = get_bytes(S3_BUCKET_AVATARS, row["avatar_object_key"])
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Avatar not found") from exc

    return Response(
        content=avatar_bytes,
        media_type=row["avatar_content_type"] or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=86400"},
    )
