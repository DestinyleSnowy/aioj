import json
from typing import Any

from sqlalchemy import text


def audit_log(
    conn,
    *,
    user_id: int | None,
    action: str,
    resource_type: str,
    resource_id: str | int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        text(
            """
            insert into audit_logs(user_id, action, resource_type, resource_id, metadata)
            values (:user_id, :action, :resource_type, :resource_id, cast(:metadata as jsonb))
            """
        ),
        {
            "user_id": user_id,
            "action": str(action or "").strip()[:120],
            "resource_type": str(resource_type or "").strip()[:80],
            "resource_id": str(resource_id)[:120] if resource_id is not None else None,
            "metadata": json.dumps(metadata or {}),
        },
    )
