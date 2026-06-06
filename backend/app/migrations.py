import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.db import engine
from app.settings import settings


MESSAGE_SCHEMA_COMPATIBILITY_SQL = """
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

create table if not exists message_contact_remarks (
  user_id bigint not null references users(id) on delete cascade,
  contact_user_id bigint not null references users(id) on delete cascade,
  remark_name text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, contact_user_id),
  constraint message_contact_remarks_no_self_check check (user_id <> contact_user_id),
  constraint message_contact_remarks_name_length_check check (
    length(btrim(remark_name)) between 1 and 50
  )
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

create index if not exists idx_direct_messages_reply_to
  on direct_messages(reply_to_message_id);
create index if not exists idx_group_messages_reply_to
  on group_messages(reply_to_message_id);
create index if not exists idx_message_conversation_preferences_user_flags
  on message_conversation_preferences(user_id, is_archived, is_pinned, is_muted, updated_at desc);
create index if not exists idx_message_contact_remarks_contact
  on message_contact_remarks(contact_user_id, user_id);
create index if not exists idx_user_message_blocks_blocked
  on user_message_blocks(blocked_user_id, blocker_id);
create index if not exists idx_message_reports_reporter_created
  on message_reports(reporter_id, created_at desc, id desc);
create index if not exists idx_message_reports_status_created
  on message_reports(status, created_at desc, id desc);
create index if not exists idx_message_hidden_entries_hidden_at
  on message_hidden_entries(user_id, hidden_at desc, id desc);
create index if not exists idx_users_last_seen_at
  on users(last_seen_at desc);
create index if not exists idx_message_typing_states_expires
  on message_typing_states(expires_at);
create index if not exists idx_group_message_read_receipts_user
  on group_message_read_receipts(user_id, read_at desc);
create index if not exists idx_message_reactions_direct
  on message_reactions(direct_message_id, emoji);
create index if not exists idx_message_reactions_group
  on message_reactions(group_message_id, emoji);
create index if not exists idx_message_favorites_user_created
  on message_favorites(user_id, created_at desc);
create index if not exists idx_message_group_announcements_group
  on message_group_announcements(group_id, created_at desc);
create index if not exists idx_message_group_invites_group
  on message_group_invites(group_id, created_at desc);
create index if not exists idx_message_group_moderation_logs_group
  on message_group_moderation_logs(group_id, created_at desc);
create index if not exists idx_message_attachment_jobs_status
  on message_attachment_jobs(status, updated_at desc);
"""


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def alembic_ini_path() -> Path:
    return backend_dir() / "alembic.ini"


def alembic_script_location() -> Path:
    return backend_dir() / "alembic"


def resolve_database_url(
    explicit_url: str | None = None,
    *,
    environ: dict[str, str] | None = None,
) -> str:
    env = environ or os.environ
    return explicit_url or env.get("DATABASE_URL") or settings.database_url


def build_alembic_config(database_url: str | None = None) -> Config:
    config = Config(str(alembic_ini_path()))
    config.set_main_option("script_location", str(alembic_script_location().resolve()))
    config.set_main_option("prepend_sys_path", str(backend_dir().resolve()))
    config.set_main_option("sqlalchemy.url", resolve_database_url(database_url))
    return config


def run_migrations(*, database_url: str | None = None, revision: str = "head") -> None:
    command.upgrade(build_alembic_config(database_url), revision)


def ensure_message_schema_compatibility() -> None:
    with engine.begin() as conn:
        conn.execute(text(MESSAGE_SCHEMA_COMPATIBILITY_SQL))
