"""Add user profile signatures.

Revision ID: 20260604_0012
Revises: 20260604_0011
Create Date: 2026-06-04 16:00:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260604_0012"
down_revision = "20260604_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table users
          add column if not exists signature text not null default '';

        alter table users
          drop constraint if exists users_signature_length_check;

        alter table users
          add constraint users_signature_length_check check (length(signature) <= 160);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table users
          drop constraint if exists users_signature_length_check;

        alter table users
          drop column if exists signature;
        """
    )
