from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy import text

from app.db import engine
from app.security import verify_token


def get_optional_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        return None

    payload = verify_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        return None

    with engine.connect() as conn:
        row = conn.execute(
            text("select id, username, email, role from users where id = :id"),
            {"id": payload["sub"]},
        ).mappings().first()
    return dict(row) if row else None


def require_user(user=Depends(get_optional_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def require_admin(user=Depends(require_user)):
    if user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin required")
    return user
