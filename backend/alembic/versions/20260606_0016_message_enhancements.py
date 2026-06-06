"""Add extended chat workflows and realtime metadata.

Revision ID: 20260606_0016
Revises: 20260606_0015
Create Date: 2026-06-06 13:30:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260606_0016"
down_revision = "20260606_0015"
branch_labels = None
depends_on = None


MESSAGE_ENHANCEMENTS_SQL = """
alter table users
  add column if not exists last_seen_at timestamptz;

alter table direct_messages
  add column if not exists delivered_at timestamptz not null default now(),
  add column if not exists attachment_scan_status text not null default 'PENDING',
  add column if not exists attachment_thumbnail_object_key text;

alter table group_messages
  add column if not exists delivered_at timestamptz not null default now(),
  add column if not exists attachment_scan_status text not null default 'PENDING',
  add column if not exists attachment_thumbnail_object_key text;

alter table message_reports
  add column if not exists reviewed_by_user_id bigint references users(id) on delete set null,
  add column if not exists resolution_note text not null default '',
  add column if not exists action_taken text not null default 'NONE';

alter table message_group_members
  drop constraint if exists message_group_members_role_check;

alter table message_group_members
  add constraint message_group_members_role_check check (role in ('OWNER', 'ADMIN', 'MEMBER'));

create table if not exists user_message_preferences (
  user_id bigint primary key references users(id) on delete cascade,
  dm_policy text not null default 'EVERYONE',
  allow_group_invites boolean not null default true,
  dnd_start_time time,
  dnd_end_time time,
  updated_at timestamptz not null default now(),
  constraint user_message_preferences_dm_policy_check
    check (dm_policy in ('EVERYONE', 'NOBODY'))
);

create table if not exists message_typing_states (
  user_id bigint not null references users(id) on delete cascade,
  conversation_type text not null,
  conversation_id bigint not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, conversation_type, conversation_id),
  constraint message_typing_states_type_check check (conversation_type in ('DIRECT', 'GROUP'))
);

create table if not exists group_message_read_receipts (
  group_message_id bigint not null references group_messages(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (group_message_id, user_id)
);

create table if not exists message_reactions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  direct_message_id bigint references direct_messages(id) on delete cascade,
  group_message_id bigint references group_messages(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint message_reactions_scope_check check (
    ((direct_message_id is not null)::integer + (group_message_id is not null)::integer) = 1
  ),
  constraint message_reactions_emoji_length_check check (
    length(btrim(emoji)) between 1 and 16
  )
);

create unique index if not exists idx_message_reactions_unique_direct
  on message_reactions(user_id, direct_message_id, emoji)
  where direct_message_id is not null;
create unique index if not exists idx_message_reactions_unique_group
  on message_reactions(user_id, group_message_id, emoji)
  where group_message_id is not null;

create table if not exists message_favorites (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  direct_message_id bigint references direct_messages(id) on delete cascade,
  group_message_id bigint references group_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint message_favorites_scope_check check (
    ((direct_message_id is not null)::integer + (group_message_id is not null)::integer) = 1
  )
);

create unique index if not exists idx_message_favorites_unique_direct
  on message_favorites(user_id, direct_message_id)
  where direct_message_id is not null;
create unique index if not exists idx_message_favorites_unique_group
  on message_favorites(user_id, group_message_id)
  where group_message_id is not null;

create table if not exists message_group_announcements (
  id bigserial primary key,
  group_id bigint not null references message_groups(id) on delete cascade,
  author_id bigint references users(id) on delete set null,
  body_md text not null default '',
  is_pinned boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_group_announcements_body_length_check check (length(body_md) <= 4000)
);

create table if not exists message_group_invites (
  id bigserial primary key,
  group_id bigint not null references message_groups(id) on delete cascade,
  invite_code text unique not null,
  created_by_user_id bigint references users(id) on delete set null,
  expires_at timestamptz,
  max_uses integer,
  use_count integer not null default 0,
  is_revoked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint message_group_invites_max_uses_check check (max_uses is null or max_uses > 0)
);

create table if not exists message_group_moderation_logs (
  id bigserial primary key,
  group_id bigint not null references message_groups(id) on delete cascade,
  actor_id bigint references users(id) on delete set null,
  target_user_id bigint references users(id) on delete set null,
  action text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists message_attachment_jobs (
  id bigserial primary key,
  direct_message_id bigint references direct_messages(id) on delete cascade,
  group_message_id bigint references group_messages(id) on delete cascade,
  object_key text not null,
  status text not null default 'PENDING',
  scan_result text not null default 'PENDING',
  thumbnail_object_key text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_attachment_jobs_scope_check check (
    ((direct_message_id is not null)::integer + (group_message_id is not null)::integer) = 1
  ),
  constraint message_attachment_jobs_status_check check (
    status in ('PENDING', 'STORED', 'FAILED')
  )
);

create index if not exists idx_users_last_seen_at on users(last_seen_at desc);
create index if not exists idx_message_typing_states_expires on message_typing_states(expires_at);
create index if not exists idx_group_message_read_receipts_user on group_message_read_receipts(user_id, read_at desc);
create index if not exists idx_message_reactions_direct on message_reactions(direct_message_id, emoji);
create index if not exists idx_message_reactions_group on message_reactions(group_message_id, emoji);
create index if not exists idx_message_favorites_user_created on message_favorites(user_id, created_at desc);
create index if not exists idx_message_group_announcements_group on message_group_announcements(group_id, created_at desc);
create index if not exists idx_message_group_invites_group on message_group_invites(group_id, created_at desc);
create index if not exists idx_message_group_moderation_logs_group on message_group_moderation_logs(group_id, created_at desc);
create index if not exists idx_message_attachment_jobs_status on message_attachment_jobs(status, updated_at desc);
"""


def upgrade() -> None:
    op.execute(MESSAGE_ENHANCEMENTS_SQL)


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_message_attachment_jobs_status;
        drop index if exists idx_message_group_moderation_logs_group;
        drop index if exists idx_message_group_invites_group;
        drop index if exists idx_message_group_announcements_group;
        drop index if exists idx_message_favorites_user_created;
        drop index if exists idx_message_reactions_group;
        drop index if exists idx_message_reactions_direct;
        drop index if exists idx_group_message_read_receipts_user;
        drop index if exists idx_message_typing_states_expires;
        drop index if exists idx_users_last_seen_at;
        drop table if exists message_attachment_jobs;
        drop table if exists message_group_moderation_logs;
        drop table if exists message_group_invites;
        drop table if exists message_group_announcements;
        drop index if exists idx_message_favorites_unique_group;
        drop index if exists idx_message_favorites_unique_direct;
        drop table if exists message_favorites;
        drop index if exists idx_message_reactions_unique_group;
        drop index if exists idx_message_reactions_unique_direct;
        drop table if exists message_reactions;
        drop table if exists group_message_read_receipts;
        drop table if exists message_typing_states;
        drop table if exists user_message_preferences;
        alter table message_group_members
          drop constraint if exists message_group_members_role_check;
        alter table message_group_members
          add constraint message_group_members_role_check check (role in ('OWNER', 'MEMBER'));
        alter table message_reports
          drop column if exists action_taken,
          drop column if exists resolution_note,
          drop column if exists reviewed_by_user_id;
        alter table group_messages
          drop column if exists attachment_thumbnail_object_key,
          drop column if exists attachment_scan_status,
          drop column if exists delivered_at;
        alter table direct_messages
          drop column if exists attachment_thumbnail_object_key,
          drop column if exists attachment_scan_status,
          drop column if exists delivered_at;
        alter table users
          drop column if exists last_seen_at;
        """
    )
