import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import Header, HTTPException

from app.settings import settings


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return f"pbkdf2$200000${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False

    parts = stored.split("$")
    if len(parts) == 4 and parts[0] == "pbkdf2":
        try:
            rounds = int(parts[1])
            salt = parts[2]
            expected = parts[3]
            digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), rounds).hex()
            return hmac.compare_digest(digest, expected)
        except Exception:
            return False

    if len(parts) == 3 and parts[0] == "sha256":
        salt = parts[1]
        expected = parts[2]
        digest = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
        return hmac.compare_digest(digest, expected)

    return False


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def unb64url(data: str) -> bytes:
    data += "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data.encode("ascii"))


def make_token(
    user_id: int,
    username: str,
    role: str,
    *,
    issued_at: datetime | None = None,
    exp_seconds: int | None = None,
) -> str:
    issued_at = issued_at or now_utc()
    iat = int(issued_at.timestamp())
    lifetime = exp_seconds if exp_seconds is not None else settings.jwt_exp_seconds
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "iat": iat,
        "exp": iat + max(1, int(lifetime)),
    }
    body = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(settings.jwt_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return body + "." + b64url(sig)


def verify_token(token: str, *, now_ts: int | None = None) -> dict[str, Any] | None:
    try:
        body, sig = token.split(".", 1)
        expected = b64url(hmac.new(settings.jwt_secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(unb64url(body))
        if not isinstance(payload, dict):
            return None
        exp = int(payload.get("exp", 0))
        if exp <= (now_ts if now_ts is not None else int(time.time())):
            return None
        return payload
    except Exception:
        return None


def validate_internal_token(token: str | None) -> None:
    if not token or not hmac.compare_digest(token, settings.internal_api_token):
        raise HTTPException(status_code=401, detail="Invalid internal token")


def require_internal_token(x_internal_token: str | None = Header(None)) -> None:
    validate_internal_token(x_internal_token)
