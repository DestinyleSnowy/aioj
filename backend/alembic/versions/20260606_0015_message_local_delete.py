"""Add per-user message hiding for local delete.

Revision ID: 20260606_0015
Revises: 20260605_0014
Create Date: 2026-06-06 10:30:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260606_0015"
down_revision = "20260605_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists message_hidden_entries (
          id bigserial primary key,
          user_id bigint not null references users(id) on delete cascade,
          direct_message_id bigint references direct_messages(id) on delete cascade,
          group_message_id bigint references group_messages(id) on delete cascade,
          hidden_at timestamptz not null default now(),
          constraint message_hidden_entries_scope_check check (
            ((direct_message_id is not null)::integer + (group_message_id is not null)::integer) = 1
          ),
          constraint message_hidden_entries_unique_direct unique (user_id, direct_message_id),
          constraint message_hidden_entries_unique_group unique (user_id, group_message_id)
        );

        create index if not exists idx_message_hidden_entries_hidden_at
          on message_hidden_entries(user_id, hidden_at desc, id desc);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_message_hidden_entries_hidden_at;
        drop table if exists message_hidden_entries;
        """
    )
