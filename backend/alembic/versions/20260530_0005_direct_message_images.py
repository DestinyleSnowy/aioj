"""Add image attachments to direct messages.

Revision ID: 20260530_0005
Revises: 20260530_0004
Create Date: 2026-05-30 22:00:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260530_0005"
down_revision = "20260530_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table direct_messages
        add column if not exists image_object_key text,
        add column if not exists image_content_type text,
        add column if not exists image_filename text,
        add column if not exists image_size_bytes integer;

        alter table direct_messages
        drop constraint if exists direct_messages_body_length_check;

        alter table direct_messages
        drop constraint if exists direct_messages_content_check;

        alter table direct_messages
        add constraint direct_messages_content_check check (
          length(btrim(body_md)) between 1 and 4000
          or image_object_key is not null
        );

        alter table direct_messages
        drop constraint if exists direct_messages_image_size_check;

        alter table direct_messages
        add constraint direct_messages_image_size_check check (
          image_size_bytes is null or image_size_bytes between 1 and 5242880
        );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table direct_messages
        drop constraint if exists direct_messages_image_size_check;

        alter table direct_messages
        drop constraint if exists direct_messages_content_check;

        update direct_messages
        set body_md = '[图片]'
        where length(btrim(body_md)) = 0;

        alter table direct_messages
        add constraint direct_messages_body_length_check check (
          length(btrim(body_md)) between 1 and 4000
        );

        alter table direct_messages
        drop column if exists image_size_bytes,
        drop column if exists image_filename,
        drop column if exists image_content_type,
        drop column if exists image_object_key;
        """
    )
