from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.user_profiles import (
    avatar_url_for_user,
    normalize_signature,
    serialize_user,
    validate_avatar_upload,
    validate_username,
)


def test_validate_username_accepts_existing_registration_format():
    assert validate_username("Alice_2026") == "Alice_2026"
    assert validate_username(" bob.dev ") == "bob.dev"


def test_validate_username_rejects_short_long_or_invalid_values():
    for value in ("ab", "-alice", "alice!", "a" * 51):
        with pytest.raises(HTTPException) as excinfo:
            validate_username(value)
        assert excinfo.value.status_code == 400


def test_normalize_signature_trims_newlines_and_limits_length():
    assert normalize_signature("  keep moving\nforward  ") == "keep moving forward"
    assert normalize_signature(None) == ""

    with pytest.raises(HTTPException) as excinfo:
        normalize_signature("x" * 161)
    assert excinfo.value.status_code == 400


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
            "signature": "AI explorer",
            "created_at": created_at,
            "avatar_object_key": "avatars/3/current.png",
            "avatar_updated_at": updated_at,
        }
    )

    assert payload["created_at"] == created_at
    assert payload["signature"] == "AI explorer"
    assert payload["avatar_url"] == "/api/users/3/avatar?v=1780488000"
