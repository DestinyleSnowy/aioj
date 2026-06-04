"""Add group member nicknames.

Revision ID: 20260604_0011
Revises: 20260603_0010
Create Date: 2026-06-04 09:30:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260604_0011"
down_revision = "20260603_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table message_group_members
          add column if not exists group_nickname text;

        update message_group_members as mgm
        set group_nickname = u.username
        from users u
        where u.id = mgm.user_id
          and coalesce(btrim(mgm.group_nickname), '') = '';

        alter table message_group_members
          drop constraint if exists message_group_members_group_nickname_length_check;

        alter table message_group_members
          add constraint message_group_members_group_nickname_length_check check (
            group_nickname is null or length(btrim(group_nickname)) between 1 and 50
          );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table message_group_members
          drop constraint if exists message_group_members_group_nickname_length_check;

        alter table message_group_members
          drop column if exists group_nickname;
        """
    )
