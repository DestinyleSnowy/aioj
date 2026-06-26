"""Add cloud drive sharing.

Revision ID: 20260626_0019
Revises: 20260617_0018
Create Date: 2026-06-26 16:00:00
"""

from alembic import op


revision = "20260626_0019"
down_revision = "20260617_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists drive_shares (
          id bigserial primary key,
          owner_id bigint not null references users(id) on delete cascade,
          item_id bigint not null references drive_items(id) on delete cascade,
          token text not null unique,
          password_hash text,
          expires_at timestamptz,
          max_downloads integer,
          download_count integer not null default 0,
          created_at timestamptz not null default now(),
          revoked_at timestamptz,
          constraint drive_shares_token_length_check check (length(token) between 24 and 160),
          constraint drive_shares_downloads_check check (
            download_count >= 0 and (max_downloads is null or max_downloads > 0)
          )
        );

        create index if not exists idx_drive_shares_owner_item
          on drive_shares(owner_id, item_id, created_at desc);

        create index if not exists idx_drive_shares_token_active
          on drive_shares(token)
          where revoked_at is null;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_drive_shares_token_active;
        drop index if exists idx_drive_shares_owner_item;
        drop table if exists drive_shares;
        """
    )
