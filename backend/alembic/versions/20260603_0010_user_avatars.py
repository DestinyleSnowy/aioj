"""Add user avatar metadata.

Revision ID: 20260603_0010
Revises: 20260603_0009
Create Date: 2026-06-03 21:45:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260603_0010"
down_revision = "20260603_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table users add column if not exists avatar_object_key text;
        alter table users add column if not exists avatar_content_type text;
        alter table users add column if not exists avatar_updated_at timestamptz;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table users drop column if exists avatar_updated_at;
        alter table users drop column if exists avatar_content_type;
        alter table users drop column if exists avatar_object_key;
        """
    )
