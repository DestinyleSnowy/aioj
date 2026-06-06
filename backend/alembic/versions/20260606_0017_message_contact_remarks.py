"""Add direct message contact remarks.

Revision ID: 20260606_0017
Revises: 20260606_0016
Create Date: 2026-06-06 20:55:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260606_0017"
down_revision = "20260606_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
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

        create index if not exists idx_message_contact_remarks_contact
          on message_contact_remarks(contact_user_id, user_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_message_contact_remarks_contact;
        drop table if exists message_contact_remarks;
        """
    )
