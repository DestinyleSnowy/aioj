import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine
from app.dependencies import require_user
from app.rate_limit import check_rate_limit, client_key
from app.security import hash_password, make_token, verify_password
from app.services.audit import audit_log
from app.services.system_settings import get_setting_bool
from app.storage import S3_BUCKET_AVATARS, delete_object, get_bytes, put_bytes
from app.user_profiles import normalize_signature, serialize_user, validate_avatar_upload, validate_username

router = APIRouter()
logger = logging.getLogger(__name__)


def _request_host(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _normalize_registration_email(value: str | None) -> str:
    email = str(value or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if len(email) > 254 or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    return email


def _registration_conflict_detail(exc: IntegrityError) -> str:
    diag = getattr(getattr(exc, "orig", None), "diag", None)
    constraint_name = str(getattr(diag, "constraint_name", "") or "").lower()
    message = str(getattr(exc, "orig", exc)).lower()

    if constraint_name == "users_username_key" or "users_username_key" in message or "key (username)" in message:
        return "Username already exists"
    if constraint_name == "users_email_key" or "users_email_key" in message or "key (email)" in message:
        return "Email already exists"
    return "Username or email already exists"


@router.post("/api/auth/register")
def register(payload: dict, request: Request):
    username = validate_username(payload.get("username"))
    email = _normalize_registration_email(payload.get("email"))
    password = payload.get("password") or ""
    check_rate_limit(client_key(request, "auth-register", username.lower()), max_calls=5, window_seconds=600)

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
                    returning id, username, email, role, signature, created_at, avatar_object_key, avatar_updated_at
                    """
                ),
                {"username": username, "email": email, "password_hash": hash_password(password)},
            ).mappings().first()
        except IntegrityError as exc:
            logger.info(
                "Registration rejected for username=%s email=%s host=%s reason=%s",
                username,
                email,
                _request_host(request),
                str(getattr(exc, "orig", exc)),
            )
            raise HTTPException(status_code=400, detail=_registration_conflict_detail(exc)) from exc
        except Exception as exc:
            logger.exception(
                "Registration failed for username=%s email=%s host=%s",
                username,
                email,
                _request_host(request),
            )
            raise HTTPException(status_code=500, detail="Registration failed, please retry later") from exc

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
                  signature,
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


@router.post("/api/auth/change-username")
def auth_change_username(payload: dict, request: Request, user=Depends(require_user)):
    username = validate_username(payload.get("username"))
    check_rate_limit(client_key(request, "auth-username", str(user["id"])), max_calls=10, window_seconds=3600)

    if username == user["username"]:
        return {
            "ok": True,
            "token": make_token(user["id"], user["username"], user["role"]),
            "user": user,
        }

    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    """
                    update users
                    set username = :username
                    where id = :id
                    returning id, username, email, role, signature, created_at, avatar_object_key, avatar_updated_at
                    """
                ),
                {"id": user["id"], "username": username},
            ).mappings().first()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")

            conn.execute(
                text("update leaderboard_entries set username = :username where user_id = :id"),
                {"id": user["id"], "username": username},
            )
            audit_log(
                conn,
                user_id=user["id"],
                action="auth.username.update",
                resource_type="user",
                resource_id=user["id"],
                metadata={"old_username": user["username"], "new_username": username},
            )
    except IntegrityError as exc:
        raise HTTPException(status_code=400, detail="Username already exists") from exc

    updated_user = serialize_user(row)
    return {
        "ok": True,
        "token": make_token(updated_user["id"], updated_user["username"], updated_user["role"]),
        "user": updated_user,
    }


@router.post("/api/auth/signature")
def auth_update_signature(payload: dict, request: Request, user=Depends(require_user)):
    signature = normalize_signature(payload.get("signature"))
    check_rate_limit(client_key(request, "auth-signature", str(user["id"])), max_calls=30, window_seconds=3600)

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update users
                set signature = :signature
                where id = :id
                returning id, username, email, role, signature, created_at, avatar_object_key, avatar_updated_at
                """
            ),
            {"id": user["id"], "signature": signature},
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        audit_log(
            conn,
            user_id=user["id"],
            action="auth.signature.update",
            resource_type="user",
            resource_id=user["id"],
            metadata={"signature_length": len(signature)},
        )

    return {"ok": True, "user": serialize_user(row)}


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
                    returning id, username, email, role, signature, created_at, avatar_object_key, avatar_updated_at
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


@router.get("/api/users/{username}/profile")
def get_user_profile(username: str):
    username = validate_username(username)
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select
                  id,
                  username,
                  role,
                  signature,
                  created_at,
                  avatar_object_key,
                  avatar_updated_at,
                  coalesce(is_disabled, false) as is_disabled
                from users
                where username = :username
                limit 1
                """
            ),
            {"username": username},
        ).mappings().first()

        if not row or bool(row["is_disabled"]):
            raise HTTPException(status_code=404, detail="User not found")

        stats = conn.execute(
            text(
                """
                select
                  (select count(*)
                   from problems
                   where status = 'PUBLIC' and active_version_id is not null) as total_public_problems,
                  count(s.id) filter (where s.status not like 'TEST_%') as submission_count,
                  count(s.id) filter (where s.status = 'ACCEPTED') as accepted_submission_count,
                  count(distinct s.problem_id) filter (where s.status = 'ACCEPTED') as solved_count,
                  max(s.created_at) filter (where s.status not like 'TEST_%') as last_submission_at
                from submissions s
                where s.user_id = :user_id
                """
            ),
            {"user_id": row["id"]},
        ).mappings().first()

        best_rows = conn.execute(
            text(
                """
                select
                  p.slug as problem_slug,
                  p.title as problem_title,
                  le.best_submission_id,
                  le.public_score,
                  le.updated_at
                from leaderboard_entries le
                join problems p on p.id = le.problem_id
                where le.user_id = :user_id
                  and p.status = 'PUBLIC'
                  and p.active_version_id is not null
                order by le.updated_at desc, le.id desc
                limit 8
                """
            ),
            {"user_id": row["id"]},
        ).mappings().all()

        recent_rows = conn.execute(
            text(
                """
                select
                  s.id,
                  p.slug as problem_slug,
                  p.title as problem_title,
                  s.status,
                  s.public_score,
                  s.runtime_ms,
                  s.memory_peak_mb,
                  s.created_at,
                  s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                where s.user_id = :user_id
                  and s.status not like 'TEST_%'
                  and p.status = 'PUBLIC'
                  and p.active_version_id is not null
                order by s.created_at desc, s.id desc
                limit 10
                """
            ),
            {"user_id": row["id"]},
        ).mappings().all()

    public_user = serialize_user(row)
    public_user.pop("email", None)
    public_user.pop("is_disabled", None)
    return {
        "user": public_user,
        "stats": dict(stats or {}),
        "best_results": [dict(r) for r in best_rows],
        "recent_submissions": [dict(r) for r in recent_rows],
    }


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
