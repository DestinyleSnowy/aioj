from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy import text

from app.db import engine
from app.security import verify_token
from app.user_profiles import serialize_user


def get_optional_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        return None

    payload = verify_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        return None

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select
                  id,
                  username,
                  email,
                  role,
                  signature,
                  created_at,
                  avatar_object_key,
                  avatar_updated_at,
                  coalesce(is_disabled, false) as is_disabled
                from users
                where id = :id
                """
            ),
            {"id": payload["sub"]},
        ).mappings().first()
    if not row or bool(row["is_disabled"]):
        return None
    data = serialize_user(row)
    data.pop("is_disabled", None)
    return data


def require_user(user=Depends(get_optional_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def require_admin(user=Depends(require_user)):
    if user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin required")
    return user
