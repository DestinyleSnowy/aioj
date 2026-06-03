from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.user_profiles import avatar_url_for_user, serialize_user, validate_avatar_upload


def test_validate_avatar_upload_accepts_supported_image_types():
    assert validate_avatar_upload("avatar.png", "image/png", b"png-bytes") == ("image/png", ".png")
    assert validate_avatar_upload("avatar.jpeg", "image/jpeg", b"jpg-bytes") == ("image/jpeg", ".jpg")
    assert validate_avatar_upload("avatar.webp", "", b"webp-bytes") == ("image/webp", ".webp")


def test_validate_avatar_upload_rejects_empty_large_or_unsupported_files():
    with pytest.raises(HTTPException) as empty_exc:
        validate_avatar_upload("avatar.png", "image/png", b"")
    assert empty_exc.value.status_code == 400

    with pytest.raises(HTTPException) as size_exc:
        validate_avatar_upload("avatar.png", "image/png", b"x" * (5 * 1024 * 1024 + 1))
    assert size_exc.value.status_code == 400

    with pytest.raises(HTTPException) as type_exc:
        validate_avatar_upload("avatar.txt", "text/plain", b"hello")
    assert type_exc.value.status_code == 400


def test_avatar_url_for_user_uses_version_when_timestamp_is_present():
    updated_at = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)

    assert avatar_url_for_user(7, updated_at) == "/api/users/7/avatar?v=1780488000"
    assert avatar_url_for_user(7, None, "avatars/7/demo.png") == "/api/users/7/avatar"
    assert avatar_url_for_user(0, updated_at) is None


def test_serialize_user_includes_avatar_url_and_created_at():
    updated_at = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
    created_at = datetime(2026, 6, 1, 8, 30, tzinfo=timezone.utc)

    payload = serialize_user(
        {
            "id": 3,
            "username": "alice",
            "email": "alice@example.com",
            "role": "USER",
            "created_at": created_at,
            "avatar_object_key": "avatars/3/current.png",
            "avatar_updated_at": updated_at,
        }
    )

    assert payload["created_at"] == created_at
    assert payload["avatar_url"] == "/api/users/3/avatar?v=1780488000"
