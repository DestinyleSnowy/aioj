"""Add message workflows, preferences, blocks, and reports.

Revision ID: 20260605_0014
Revises: 20260605_0013
Create Date: 2026-06-05 23:20:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260605_0014"
down_revision = "20260605_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table direct_messages
          add column if not exists reply_to_message_id bigint references direct_messages(id) on delete set null,
          add column if not exists edited_at timestamptz,
          add column if not exists deleted_at timestamptz,
          add column if not exists deleted_by_user_id bigint references users(id) on delete set null;

        alter table group_messages
          add column if not exists reply_to_message_id bigint references group_messages(id) on delete set null,
          add column if not exists edited_at timestamptz,
          add column if not exists deleted_at timestamptz,
          add column if not exists deleted_by_user_id bigint references users(id) on delete set null;

        create table if not exists message_conversation_preferences (
          user_id bigint not null references users(id) on delete cascade,
          conversation_type text not null,
          conversation_id bigint not null,
          is_pinned boolean not null default false,
          pinned_at timestamptz,
          is_archived boolean not null default false,
          archived_at timestamptz,
          is_muted boolean not null default false,
          muted_at timestamptz,
          updated_at timestamptz not null default now(),
          primary key (user_id, conversation_type, conversation_id),
          constraint message_conversation_preferences_type_check
            check (conversation_type in ('DIRECT', 'GROUP'))
        );

        create table if not exists user_message_blocks (
          blocker_id bigint not null references users(id) on delete cascade,
          blocked_user_id bigint not null references users(id) on delete cascade,
          created_at timestamptz not null default now(),
          primary key (blocker_id, blocked_user_id),
          constraint user_message_blocks_no_self_check check (blocker_id <> blocked_user_id)
        );

        create table if not exists message_reports (
          id bigserial primary key,
          reporter_id bigint not null references users(id) on delete cascade,
          direct_message_id bigint references direct_messages(id) on delete cascade,
          group_message_id bigint references group_messages(id) on delete cascade,
          reason text not null,
          details text not null default '',
          status text not null default 'OPEN',
          created_at timestamptz not null default now(),
          reviewed_at timestamptz,
          constraint message_reports_scope_check check (
            ((direct_message_id is not null)::integer + (group_message_id is not null)::integer) = 1
          ),
          constraint message_reports_reason_length_check check (
            length(btrim(reason)) between 1 and 80
          ),
          constraint message_reports_details_length_check check (
            length(details) <= 2000
          ),
          constraint message_reports_status_check check (
            status in ('OPEN', 'REVIEWED', 'DISMISSED')
          )
        );

        create index if not exists idx_direct_messages_reply_to
          on direct_messages(reply_to_message_id);
        create index if not exists idx_group_messages_reply_to
          on group_messages(reply_to_message_id);
        create index if not exists idx_message_conversation_preferences_user_flags
          on message_conversation_preferences(user_id, is_archived, is_pinned, is_muted, updated_at desc);
        create index if not exists idx_user_message_blocks_blocked
          on user_message_blocks(blocked_user_id, blocker_id);
        create index if not exists idx_message_reports_reporter_created
          on message_reports(reporter_id, created_at desc, id desc);
        create index if not exists idx_message_reports_status_created
          on message_reports(status, created_at desc, id desc);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_message_reports_status_created;
        drop index if exists idx_message_reports_reporter_created;
        drop index if exists idx_user_message_blocks_blocked;
        drop index if exists idx_message_conversation_preferences_user_flags;
        drop index if exists idx_group_messages_reply_to;
        drop index if exists idx_direct_messages_reply_to;

        drop table if exists message_reports;
        drop table if exists user_message_blocks;
        drop table if exists message_conversation_preferences;

        alter table group_messages
          drop column if exists deleted_by_user_id,
          drop column if exists deleted_at,
          drop column if exists edited_at,
          drop column if exists reply_to_message_id;

        alter table direct_messages
          drop column if exists deleted_by_user_id,
          drop column if exists deleted_at,
          drop column if exists edited_at,
          drop column if exists reply_to_message_id;
        """
    )
