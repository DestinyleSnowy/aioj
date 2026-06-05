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
