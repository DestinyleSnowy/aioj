"""Add group chats to messages.

Revision ID: 20260603_0009
Revises: 20260601_0008
Create Date: 2026-06-03 20:45:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260603_0009"
down_revision = "20260601_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists message_groups (
          id bigserial primary key,
          name text not null,
          owner_id bigint references users(id) on delete set null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint message_groups_name_length_check check (
            length(btrim(name)) between 1 and 80
          )
        );

        create table if not exists message_group_members (
          group_id bigint not null references message_groups(id) on delete cascade,
          user_id bigint not null references users(id) on delete cascade,
          role text not null default 'MEMBER',
          joined_at timestamptz not null default now(),
          primary key (group_id, user_id),
          constraint message_group_members_role_check check (role in ('OWNER', 'MEMBER'))
        );

        create table if not exists group_messages (
          id bigserial primary key,
          group_id bigint not null references message_groups(id) on delete cascade,
          sender_id bigint not null references users(id) on delete cascade,
          body_md text not null default '',
          attachment_object_key text,
          attachment_content_type text,
          attachment_filename text,
          attachment_size_bytes integer,
          created_at timestamptz not null default now(),
          constraint group_messages_content_check check (
            length(btrim(body_md)) between 1 and 4000
            or attachment_object_key is not null
          ),
          constraint group_messages_attachment_size_check check (
            attachment_size_bytes is null or attachment_size_bytes between 1 and 20971520
          )
        );

        create table if not exists group_message_reads (
          group_id bigint not null references message_groups(id) on delete cascade,
          user_id bigint not null references users(id) on delete cascade,
          last_read_message_id bigint references group_messages(id) on delete set null,
          read_at timestamptz not null default now(),
          primary key (group_id, user_id)
        );

        create index if not exists idx_message_group_members_user
          on message_group_members(user_id, joined_at desc, group_id);
        create index if not exists idx_group_messages_group_created
          on group_messages(group_id, created_at desc, id desc);
        create index if not exists idx_group_messages_sender_created
          on group_messages(sender_id, created_at desc, id desc);
        create index if not exists idx_group_message_reads_user
          on group_message_reads(user_id, group_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_group_message_reads_user;
        drop index if exists idx_group_messages_sender_created;
        drop index if exists idx_group_messages_group_created;
        drop index if exists idx_message_group_members_user;
        drop table if exists group_message_reads;
        drop table if exists group_messages;
        drop table if exists message_group_members;
        drop table if exists message_groups;
        """
    )
