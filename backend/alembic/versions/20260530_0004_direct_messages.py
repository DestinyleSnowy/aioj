"""Add user direct messages.

Revision ID: 20260530_0004
Revises: 20260530_0003
Create Date: 2026-05-30 21:00:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260530_0004"
down_revision = "20260530_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists direct_messages (
          id bigserial primary key,
          sender_id bigint not null references users(id) on delete cascade,
          recipient_id bigint not null references users(id) on delete cascade,
          body_md text not null,
          is_read boolean not null default false,
          created_at timestamptz not null default now(),
          read_at timestamptz,
          constraint direct_messages_no_self_check check (sender_id <> recipient_id),
          constraint direct_messages_body_length_check check (
            length(btrim(body_md)) between 1 and 4000
          )
        );

        create index if not exists idx_direct_messages_recipient_unread
          on direct_messages(recipient_id, is_read, created_at desc, id desc);
        create index if not exists idx_direct_messages_sender_created
          on direct_messages(sender_id, created_at desc, id desc);
        create index if not exists idx_direct_messages_conversation
          on direct_messages(
            least(sender_id, recipient_id),
            greatest(sender_id, recipient_id),
            created_at desc,
            id desc
          );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_direct_messages_conversation;
        drop index if exists idx_direct_messages_sender_created;
        drop index if exists idx_direct_messages_recipient_unread;
        drop table if exists direct_messages;
        """
    )
