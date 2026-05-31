from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin

router = APIRouter()


@router.get("/api/admin/audit-logs")
def admin_audit_logs(limit: int = 100, user=Depends(require_admin)):
    limit = max(1, min(int(limit or 100), 500))
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select
                    al.id,
                    al.user_id,
                    coalesce(u.username, 'system') as username,
                    al.action,
                    al.resource_type,
                    al.resource_id,
                    al.metadata,
                    al.created_at
                from audit_logs al
                left join users u on u.id = al.user_id
                order by al.created_at desc, al.id desc
                limit :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return {"items": [dict(row) for row in rows]}
