"""Generalize direct message image attachments to files.

Revision ID: 20260530_0006
Revises: 20260530_0005
Create Date: 2026-05-30 23:00:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260530_0006"
down_revision = "20260530_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_object_key'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_object_key'
          ) then
            alter table direct_messages rename column image_object_key to attachment_object_key;
          end if;

          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_content_type'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_content_type'
          ) then
            alter table direct_messages rename column image_content_type to attachment_content_type;
          end if;

          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_filename'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_filename'
          ) then
            alter table direct_messages rename column image_filename to attachment_filename;
          end if;

          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_size_bytes'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_size_bytes'
          ) then
            alter table direct_messages rename column image_size_bytes to attachment_size_bytes;
          end if;
        end$$;

        alter table direct_messages
        add column if not exists attachment_object_key text,
        add column if not exists attachment_content_type text,
        add column if not exists attachment_filename text,
        add column if not exists attachment_size_bytes integer;

        alter table direct_messages
        drop constraint if exists direct_messages_content_check;

        alter table direct_messages
        add constraint direct_messages_content_check check (
          length(btrim(body_md)) between 1 and 4000
          or attachment_object_key is not null
        );

        alter table direct_messages
        drop constraint if exists direct_messages_image_size_check;
        alter table direct_messages
        drop constraint if exists direct_messages_attachment_size_check;

        alter table direct_messages
        add constraint direct_messages_attachment_size_check check (
          attachment_size_bytes is null or attachment_size_bytes between 1 and 20971520
        );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table direct_messages
        drop constraint if exists direct_messages_attachment_size_check;

        alter table direct_messages
        drop constraint if exists direct_messages_content_check;

        alter table direct_messages
        add constraint direct_messages_content_check check (
          length(btrim(body_md)) between 1 and 4000
          or attachment_object_key is not null
        );

        alter table direct_messages
        add constraint direct_messages_image_size_check check (
          attachment_size_bytes is null or attachment_size_bytes between 1 and 5242880
        );

        do $$
        begin
          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_object_key'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_object_key'
          ) then
            alter table direct_messages rename column attachment_object_key to image_object_key;
          end if;

          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_content_type'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_content_type'
          ) then
            alter table direct_messages rename column attachment_content_type to image_content_type;
          end if;

          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_filename'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_filename'
          ) then
            alter table direct_messages rename column attachment_filename to image_filename;
          end if;

          if exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'attachment_size_bytes'
          ) and not exists (
            select 1 from information_schema.columns
            where table_name = 'direct_messages'
              and column_name = 'image_size_bytes'
          ) then
            alter table direct_messages rename column attachment_size_bytes to image_size_bytes;
          end if;
        end$$;
        """
    )
