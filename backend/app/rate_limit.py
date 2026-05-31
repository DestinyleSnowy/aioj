import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_buckets: dict[str, deque[float]] = defaultdict(deque)


def client_key(request: Request, namespace: str, subject: str = "") -> str:
    host = request.client.host if request.client else "unknown"
    return f"{namespace}:{host}:{subject}"


def check_rate_limit(key: str, *, max_calls: int, window_seconds: int) -> None:
    now = time.monotonic()
    bucket = _buckets[key]
    cutoff = now - window_seconds
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()
    if len(bucket) >= max_calls:
        raise HTTPException(status_code=429, detail="Too many requests; please retry later")
    bucket.append(now)
