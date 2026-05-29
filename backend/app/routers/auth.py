from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_user
from app.security import hash_password, make_token, verify_password
from app.services.system_settings import get_setting_bool

router = APIRouter()


@router.post("/api/auth/register")
def register(payload: dict):
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip() or None
    password = payload.get("password") or ""

    if not username or len(username) > 50:
        raise HTTPException(status_code=400, detail="Invalid username")
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
                    returning id, username, email, role
                    """
                ),
                {"username": username, "email": email, "password_hash": hash_password(password)},
            ).mappings().first()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Username or email already exists") from exc

    user = dict(row)
    return {"token": make_token(user["id"], user["username"], user["role"]), "user": user}


@router.post("/api/auth/login")
def login(payload: dict):
    key = (payload.get("username_or_email") or "").strip()
    password = payload.get("password") or ""

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                select id, username, email, password_hash, role, coalesce(is_disabled, false) as is_disabled
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

    user = {"id": row["id"], "username": row["username"], "email": row["email"], "role": row["role"]}
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
