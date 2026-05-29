"""Add judge scheduler tag metadata and indexes.

Revision ID: 20260529_0002
Revises: 20260529_0001
Create Date: 2026-05-29 18:00:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260529_0002"
down_revision = "20260529_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table problem_versions
        add column if not exists required_tags text[] not null default '{}';

        create index if not exists judge_jobs_claimed_by_status_idx on judge_jobs(claimed_by, status, id);
        create index if not exists judge_nodes_status_heartbeat_idx on judge_nodes(status, last_heartbeat_at desc);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists judge_nodes_status_heartbeat_idx;
        drop index if exists judge_jobs_claimed_by_status_idx;
        alter table problem_versions drop column if exists required_tags;
        """
    )
