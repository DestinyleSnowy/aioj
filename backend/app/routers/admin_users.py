from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin
from app.security import hash_password
from app.services.audit import audit_log
from app.user_profiles import serialize_user

router = APIRouter()


@router.get("/api/admin/users")
def admin_users(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select
                  id,
                  username,
                  email,
                  role,
                  signature,
                  coalesce(is_disabled, false) as is_disabled,
                  created_at,
                  avatar_object_key,
                  avatar_updated_at
                from users
                order by id asc
                """
            )
        ).mappings().all()
    return {"items": [serialize_user(r) for r in rows]}


@router.post("/api/admin/users/{user_id}/role")
def admin_set_user_role(user_id: int, payload: dict, user=Depends(require_admin)):
    role = str(payload.get("role") or "").upper()
    if role not in {"USER", "ADMIN"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if user_id == user["id"] and role != "ADMIN":
        raise HTTPException(status_code=400, detail="Cannot demote yourself")
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update users
                set role = :role
                where id = :id
                returning
                  id,
                  username,
                  email,
                  role,
                  signature,
                  coalesce(is_disabled, false) as is_disabled,
                  created_at,
                  avatar_object_key,
                  avatar_updated_at
                """
            ),
            {"id": user_id, "role": role},
        ).mappings().first()
        if row:
            audit_log(
                conn,
                user_id=user["id"],
                action="admin.user.role",
                resource_type="user",
                resource_id=user_id,
                metadata={"role": role},
            )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "user": serialize_user(row)}


@router.post("/api/admin/users/{user_id}/disabled")
def admin_set_user_disabled(user_id: int, payload: dict, user=Depends(require_admin)):
    is_disabled = bool(payload.get("is_disabled"))
    if user_id == user["id"] and is_disabled:
        raise HTTPException(status_code=400, detail="Cannot disable yourself")
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update users
                set is_disabled = :is_disabled
                where id = :id
                returning
                  id,
                  username,
                  email,
                  role,
                  signature,
                  coalesce(is_disabled, false) as is_disabled,
                  created_at,
                  avatar_object_key,
                  avatar_updated_at
                """
            ),
            {"id": user_id, "is_disabled": is_disabled},
        ).mappings().first()
        if row:
            audit_log(
                conn,
                user_id=user["id"],
                action="admin.user.disabled",
                resource_type="user",
                resource_id=user_id,
                metadata={"is_disabled": is_disabled},
            )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "user": serialize_user(row)}


@router.post("/api/admin/users/{user_id}/password")
def admin_reset_user_password(user_id: int, payload: dict, user=Depends(require_admin)):
    new_password = payload.get("new_password") or ""
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update users
                set password_hash = :password_hash
                where id = :id
                returning id, username, email, role, signature, created_at, avatar_object_key, avatar_updated_at
                """
            ),
            {"id": user_id, "password_hash": hash_password(new_password)},
        ).mappings().first()
        if row:
            audit_log(
                conn,
                user_id=user["id"],
                action="admin.user.password_reset",
                resource_type="user",
                resource_id=user_id,
            )

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "user": serialize_user(row)}
