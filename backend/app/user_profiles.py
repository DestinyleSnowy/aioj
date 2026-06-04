import mimetypes
import re
from typing import Any

from fastapi import HTTPException

MAX_AVATAR_BYTES = 5 * 1024 * 1024
MAX_SIGNATURE_CHARS = 160
USERNAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,49}")
AVATAR_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def validate_username(value: str | None) -> str:
    username = str(value or "").strip()
    if not USERNAME_PATTERN.fullmatch(username):
        raise HTTPException(status_code=400, detail="Invalid username")
    return username


def normalize_signature(value: str | None) -> str:
    signature = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(signature) > MAX_SIGNATURE_CHARS:
        raise HTTPException(status_code=400, detail=f"Signature must be at most {MAX_SIGNATURE_CHARS} characters")
    return signature


def normalize_avatar_content_type(filename: str | None, content_type: str | None) -> str:
    normalized = str(content_type or "").split(";", 1)[0].strip().lower()
    if normalized == "image/jpg":
        normalized = "image/jpeg"
    if normalized in AVATAR_CONTENT_TYPES:
        return normalized

    guessed, _ = mimetypes.guess_type(filename or "")
    guessed = str(guessed or "").strip().lower()
    if guessed == "image/jpg":
        guessed = "image/jpeg"
    if guessed in AVATAR_CONTENT_TYPES:
        return guessed

    raise HTTPException(status_code=400, detail="Avatar must be PNG, JPG, GIF, or WebP")


def validate_avatar_upload(filename: str | None, content_type: str | None, data: bytes) -> tuple[str, str]:
    if not data:
        raise HTTPException(status_code=400, detail="Avatar file is empty")
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Avatar must be at most 5 MB")

    normalized_type = normalize_avatar_content_type(filename, content_type)
    return normalized_type, AVATAR_CONTENT_TYPES[normalized_type]


def avatar_url_for_user(user_id: Any, avatar_updated_at, avatar_object_key: str | None = None) -> str | None:
    try:
        normalized_user_id = int(user_id or 0)
    except (TypeError, ValueError):
        normalized_user_id = 0

    if normalized_user_id <= 0 or (not avatar_updated_at and not avatar_object_key):
        return None

    url = f"/api/users/{normalized_user_id}/avatar"
    if avatar_updated_at and hasattr(avatar_updated_at, "timestamp"):
        return f"{url}?v={int(avatar_updated_at.timestamp())}"
    return url


def serialize_user(row) -> dict[str, Any]:
    if not row:
        return {}

    data = dict(row)
    user = {
        key: data.get(key)
        for key in ("id", "username", "email", "role", "signature", "created_at")
        if key in data
    }
    if "is_disabled" in data:
        user["is_disabled"] = bool(data.get("is_disabled"))
    user["avatar_url"] = avatar_url_for_user(
        data.get("id"),
        data.get("avatar_updated_at"),
        data.get("avatar_object_key"),
    )
    return user
