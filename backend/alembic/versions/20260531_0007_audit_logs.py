"""Add admin audit logs.

Revision ID: 20260531_0007
Revises: 20260530_0006
Create Date: 2026-05-31 16:00:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260531_0007"
down_revision = "20260530_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists audit_logs (
          id bigserial primary key,
          user_id bigint references users(id) on delete set null,
          action text not null,
          resource_type text not null,
          resource_id text,
          metadata jsonb not null default '{}',
          created_at timestamptz not null default now()
        );

        create index if not exists idx_audit_logs_created_desc
          on audit_logs(created_at desc, id desc);
        create index if not exists idx_audit_logs_user_created
          on audit_logs(user_id, created_at desc, id desc);
        create index if not exists idx_audit_logs_resource
          on audit_logs(resource_type, resource_id, created_at desc);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_audit_logs_resource;
        drop index if exists idx_audit_logs_user_created;
        drop index if exists idx_audit_logs_created_desc;
        drop table if exists audit_logs;
        """
    )
