import pytest
from fastapi import HTTPException

from app.routers.messages import clamp_limit, normalize_message_body


def test_normalize_message_body_trims_and_limits_length():
    assert normalize_message_body("  hello  ") == "hello"

    with pytest.raises(HTTPException) as empty:
        normalize_message_body("   ")
    assert empty.value.status_code == 400

    with pytest.raises(HTTPException) as too_long:
        normalize_message_body("x" * 4001)
    assert too_long.value.status_code == 400


def test_clamp_limit_handles_invalid_and_bounds():
    assert clamp_limit("bad", default=20, max_value=50) == 20
    assert clamp_limit(0, default=20, max_value=50) == 20
    assert clamp_limit(500, default=20, max_value=50) == 50
    assert clamp_limit(12, default=20, max_value=50) == 12
