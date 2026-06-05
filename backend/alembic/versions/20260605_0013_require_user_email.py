"""Require user email addresses.

Revision ID: 20260605_0013
Revises: 20260604_0012
Create Date: 2026-06-05 22:45:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260605_0013"
down_revision = "20260604_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (
            select 1
            from users
            where email is null or length(btrim(email)) = 0
          ) then
            raise exception 'users.email contains null or blank values; backfill user emails before applying migration';
          end if;
        end $$;

        alter table users
          alter column email set not null;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table users
          alter column email drop not null;
        """
    )
