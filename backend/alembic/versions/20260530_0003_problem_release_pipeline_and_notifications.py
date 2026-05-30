"""Add problem release pipeline metadata and user notifications.

Revision ID: 20260530_0003
Revises: 20260529_0002
Create Date: 2026-05-30 10:00:00
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260530_0003"
down_revision = "20260529_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table problems
        add column if not exists active_version_id bigint;

        alter table problem_versions
        add column if not exists status text not null default 'DRAFT',
        add column if not exists self_test_status text not null default 'PENDING',
        add column if not exists self_test_result jsonb,
        add column if not exists last_self_tested_at timestamptz,
        add column if not exists activated_at timestamptz;

        do $$
        begin
          if not exists (
            select 1
            from pg_constraint
            where conname = 'problems_active_version_id_fkey'
          ) then
            alter table problems
            add constraint problems_active_version_id_fkey
            foreign key (active_version_id) references problem_versions(id) on delete set null;
          end if;
        end$$;

        with ranked as (
          select
            pv.id,
            pv.problem_id,
            row_number() over (
              partition by pv.problem_id
              order by pv.created_at desc, pv.id desc
            ) as rn
          from problem_versions pv
        ),
        latest as (
          select id, problem_id
          from ranked
          where rn = 1
        )
        update problems p
        set active_version_id = latest.id
        from latest
        where p.id = latest.problem_id
          and p.active_version_id is null;

        update problem_versions
        set status = 'ARCHIVED'
        where status = 'DRAFT';

        update problem_versions pv
        set status = 'ACTIVE',
            activated_at = coalesce(pv.activated_at, pv.created_at)
        from problems p
        where p.active_version_id = pv.id;

        create table if not exists notifications (
          id bigserial primary key,
          user_id bigint not null references users(id) on delete cascade,
          type text not null,
          title text not null,
          body_md text not null default '',
          link text,
          is_read boolean not null default false,
          created_at timestamptz not null default now(),
          read_at timestamptz
        );

        create index if not exists idx_notifications_user_created_desc
          on notifications(user_id, created_at desc, id desc);
        create index if not exists idx_notifications_user_unread
          on notifications(user_id, is_read, id desc);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_notifications_user_unread;
        drop index if exists idx_notifications_user_created_desc;
        drop table if exists notifications;

        alter table problems drop constraint if exists problems_active_version_id_fkey;
        alter table problems drop column if exists active_version_id;

        alter table problem_versions
        drop column if exists activated_at,
        drop column if exists last_self_tested_at,
        drop column if exists self_test_result,
        drop column if exists self_test_status,
        drop column if exists status;
        """
    )
