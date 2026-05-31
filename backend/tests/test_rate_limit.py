import pytest
from fastapi import HTTPException

from app.rate_limit import check_rate_limit


def test_check_rate_limit_rejects_after_threshold():
    key = "test-rate-limit-key"

    check_rate_limit(key, max_calls=2, window_seconds=60)
    check_rate_limit(key, max_calls=2, window_seconds=60)

    with pytest.raises(HTTPException) as excinfo:
        check_rate_limit(key, max_calls=2, window_seconds=60)

    assert excinfo.value.status_code == 429
