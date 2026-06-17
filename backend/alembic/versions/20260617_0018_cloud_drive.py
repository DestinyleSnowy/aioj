"""Add user cloud drive storage.

Revision ID: 20260617_0018
Revises: 20260606_0017
Create Date: 2026-06-17 09:00:00
"""

from alembic import op


revision = "20260617_0018"
down_revision = "20260606_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists drive_items (
          id bigserial primary key,
          owner_id bigint not null references users(id) on delete cascade,
          parent_id bigint references drive_items(id) on delete cascade,
          kind text not null,
          name text not null,
          object_key text,
          content_type text,
          size_bytes bigint not null default 0,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint drive_items_kind_check check (kind in ('FOLDER', 'FILE')),
          constraint drive_items_name_length_check check (length(btrim(name)) between 1 and 180),
          constraint drive_items_file_payload_check check (
            (kind = 'FILE' and object_key is not null and size_bytes >= 0)
            or (kind = 'FOLDER' and object_key is null and size_bytes = 0)
          ),
          constraint drive_items_no_self_parent_check check (parent_id is null or parent_id <> id)
        );

        create unique index if not exists idx_drive_items_unique_root_name
          on drive_items(owner_id, lower(name))
          where parent_id is null;

        create unique index if not exists idx_drive_items_unique_child_name
          on drive_items(owner_id, parent_id, lower(name))
          where parent_id is not null;

        create index if not exists idx_drive_items_owner_parent
          on drive_items(owner_id, parent_id, kind, lower(name));

        create index if not exists idx_drive_items_owner_updated
          on drive_items(owner_id, updated_at desc, id desc);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_drive_items_owner_updated;
        drop index if exists idx_drive_items_owner_parent;
        drop index if exists idx_drive_items_unique_child_name;
        drop index if exists idx_drive_items_unique_root_name;
        drop table if exists drive_items;
        """
    )
