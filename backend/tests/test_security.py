from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.security import make_token, validate_internal_token, verify_token


def test_make_token_sets_exp_and_verify_token_rejects_expired_tokens():
    issued_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    token = make_token(1, "alice", "USER", issued_at=issued_at, exp_seconds=60)

    payload = verify_token(token, now_ts=int(issued_at.timestamp()) + 30)

    assert payload is not None
    assert payload["sub"] == 1
    assert payload["exp"] == int(issued_at.timestamp()) + 60
    assert verify_token(token, now_ts=int(issued_at.timestamp()) + 61) is None


def test_validate_internal_token_rejects_invalid_value():
    with pytest.raises(HTTPException) as excinfo:
        validate_internal_token("wrong-token")

    assert excinfo.value.status_code == 401
