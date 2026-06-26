from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin
from app.settings import settings

router = APIRouter()


def _int(value) -> int:
    return int(value or 0)


def _rows(rows) -> list[dict]:
    return [dict(row) for row in rows]


@router.get("/api/admin/analytics/overview")
def admin_analytics_overview(user=Depends(require_admin)):
    with engine.connect() as conn:
        users = dict(
            conn.execute(
                text(
                    """
                    select
                      count(*) as total_users,
                      count(*) filter (where role = 'ADMIN') as admin_users,
                      count(*) filter (where coalesce(is_disabled, false)) as disabled_users,
                      count(*) filter (where not coalesce(is_disabled, false)) as enabled_users,
                      count(*) filter (where last_seen_at >= now() - interval '24 hours') as active_24h,
                      count(*) filter (where last_seen_at >= now() - interval '7 days') as active_7d,
                      count(*) filter (where created_at >= current_date) as new_today
                    from users
                    """
                )
            )
            .mappings()
            .first()
        )

        messages = dict(
            conn.execute(
                text(
                    """
                    select
                      (select count(*) from direct_messages) as direct_messages,
                      (select count(*) from group_messages) as group_messages,
                      (select count(*) from message_groups) as message_groups,
                      (
                        (select count(*) from direct_messages where created_at >= current_date)
                        + (select count(*) from group_messages where created_at >= current_date)
                      ) as messages_today,
                      (
                        (select count(*) from direct_messages where created_at >= now() - interval '7 days')
                        + (select count(*) from group_messages where created_at >= now() - interval '7 days')
                      ) as messages_7d,
                      (
                        (select count(*) from direct_messages where attachment_object_key is not null)
                        + (select count(*) from group_messages where attachment_object_key is not null)
                      ) as attachment_count,
                      (
                        (select coalesce(sum(attachment_size_bytes), 0) from direct_messages)
                        + (select coalesce(sum(attachment_size_bytes), 0) from group_messages)
                      ) as attachment_bytes,
                      (select count(*) from message_reports where status = 'OPEN') as open_reports
                    """
                )
            )
            .mappings()
            .first()
        )
        messages["total_messages"] = _int(messages["direct_messages"]) + _int(messages["group_messages"])

        message_trend = _rows(
            conn.execute(
                text(
                    """
                    with days as (
                      select generate_series(current_date - interval '13 days', current_date, interval '1 day')::date as day
                    ),
                    sent as (
                      select created_at::date as day, count(*) as direct_count, 0::bigint as group_count
                      from direct_messages
                      where created_at >= current_date - interval '13 days'
                      group by created_at::date
                      union all
                      select created_at::date as day, 0::bigint as direct_count, count(*) as group_count
                      from group_messages
                      where created_at >= current_date - interval '13 days'
                      group by created_at::date
                    )
                    select
                      days.day,
                      coalesce(sum(sent.direct_count), 0) as direct_messages,
                      coalesce(sum(sent.group_count), 0) as group_messages,
                      coalesce(sum(sent.direct_count + sent.group_count), 0) as total_messages
                    from days
                    left join sent on sent.day = days.day
                    group by days.day
                    order by days.day
                    """
                )
            ).mappings()
        )

        message_user_rank = _rows(
            conn.execute(
                text(
                    """
                    with sent as (
                      select
                        sender_id as user_id,
                        count(*) as message_count,
                        coalesce(sum(attachment_size_bytes), 0) as attachment_bytes,
                        max(created_at) as last_message_at
                      from direct_messages
                      group by sender_id
                      union all
                      select
                        sender_id as user_id,
                        count(*) as message_count,
                        coalesce(sum(attachment_size_bytes), 0) as attachment_bytes,
                        max(created_at) as last_message_at
                      from group_messages
                      group by sender_id
                    )
                    select
                      u.id,
                      u.username,
                      u.role,
                      u.last_seen_at,
                      coalesce(sum(sent.message_count), 0) as message_count,
                      coalesce(sum(sent.attachment_bytes), 0) as attachment_bytes,
                      max(sent.last_message_at) as last_message_at
                    from users u
                    left join sent on sent.user_id = u.id
                    group by u.id, u.username, u.role, u.last_seen_at
                    order by message_count desc, last_message_at desc nulls last, u.id asc
                    limit 12
                    """
                )
            ).mappings()
        )

        drive = dict(
            conn.execute(
                text(
                    """
                    select
                      count(*) filter (where kind = 'FILE') as file_count,
                      count(*) filter (where kind = 'FOLDER') as folder_count,
                      coalesce(sum(size_bytes) filter (where kind = 'FILE'), 0) as used_bytes,
                      count(distinct owner_id) as users_with_drive,
                      max(updated_at) as latest_drive_update
                    from drive_items
                    """
                )
            )
            .mappings()
            .first()
        )

        drive_users = _rows(
            conn.execute(
                text(
                    """
                    select
                      u.id,
                      u.username,
                      u.role,
                      u.last_seen_at,
                      count(di.id) filter (where di.kind = 'FILE') as file_count,
                      count(di.id) filter (where di.kind = 'FOLDER') as folder_count,
                      coalesce(sum(di.size_bytes) filter (where di.kind = 'FILE'), 0) as used_bytes,
                      case when u.role = 'ADMIN' then :admin_quota else :user_quota end as quota_bytes,
                      max(di.updated_at) as latest_update
                    from users u
                    left join drive_items di on di.owner_id = u.id
                    group by u.id, u.username, u.role, u.last_seen_at
                    order by used_bytes desc, file_count desc, u.id asc
                    limit 12
                    """
                ),
                {
                    "admin_quota": settings.drive_admin_quota_bytes,
                    "user_quota": settings.drive_user_quota_bytes,
                },
            ).mappings()
        )

        drive_type_distribution = _rows(
            conn.execute(
                text(
                    """
                    select
                      case
                        when content_type like 'image/%' then 'image'
                        when content_type like 'video/%' then 'video'
                        when content_type like 'audio/%' then 'audio'
                        when content_type in ('application/pdf', 'text/plain', 'text/markdown')
                          or content_type like 'application/vnd.%'
                          or lower(name) ~ '\\.(docx?|xlsx?|pptx?|pdf|txt|md|csv)$' then 'document'
                        when content_type in ('application/zip', 'application/x-zip-compressed', 'application/x-tar')
                          or lower(name) ~ '\\.(zip|rar|7z|tar|gz)$' then 'archive'
                        else 'other'
                      end as category,
                      count(*) as file_count,
                      coalesce(sum(size_bytes), 0) as used_bytes
                    from drive_items
                    where kind = 'FILE'
                    group by category
                    order by used_bytes desc, file_count desc
                    """
                )
            ).mappings()
        )

        drive_upload_trend = _rows(
            conn.execute(
                text(
                    """
                    with days as (
                      select generate_series(current_date - interval '13 days', current_date, interval '1 day')::date as day
                    ),
                    uploads as (
                      select created_at::date as day, count(*) as file_count, coalesce(sum(size_bytes), 0) as upload_bytes
                      from drive_items
                      where kind = 'FILE' and created_at >= current_date - interval '13 days'
                      group by created_at::date
                    )
                    select
                      days.day,
                      coalesce(uploads.file_count, 0) as file_count,
                      coalesce(uploads.upload_bytes, 0) as upload_bytes
                    from days
                    left join uploads on uploads.day = days.day
                    order by days.day
                    """
                )
            ).mappings()
        )

        largest_files = _rows(
            conn.execute(
                text(
                    """
                    select
                      di.id,
                      di.name,
                      di.content_type,
                      di.size_bytes,
                      di.created_at,
                      di.updated_at,
                      u.id as owner_id,
                      u.username as owner_username
                    from drive_items di
                    join users u on u.id = di.owner_id
                    where di.kind = 'FILE'
                    order by di.size_bytes desc, di.updated_at desc
                    limit 10
                    """
                )
            ).mappings()
        )

        drive_shares = dict(
            conn.execute(
                text(
                    """
                    with recursive share_tree(share_id, owner_id, item_id, kind, size_bytes, download_count) as (
                      select s.id, s.owner_id, i.id, i.kind, i.size_bytes, s.download_count
                      from drive_shares s
                      join drive_items i on i.id = s.item_id and i.owner_id = s.owner_id
                      union all
                      select st.share_id, st.owner_id, child.id, child.kind, child.size_bytes, st.download_count
                      from share_tree st
                      join drive_items child on child.parent_id = st.item_id and child.owner_id = st.owner_id
                    ),
                    share_payload as (
                      select
                        share_id,
                        download_count,
                        coalesce(sum(size_bytes) filter (where kind = 'FILE'), 0) as payload_bytes
                      from share_tree
                      group by share_id, download_count
                    )
                    select
                      (select count(*) from drive_shares) as total_shares,
                      (
                        select count(*)
                        from drive_shares s
                        where s.revoked_at is null
                          and (s.expires_at is null or s.expires_at > now())
                          and (s.max_downloads is null or s.download_count < s.max_downloads)
                      ) as active_shares,
                      coalesce(sum(download_count), 0) as share_downloads,
                      coalesce(sum(payload_bytes * download_count), 0) as estimated_download_bytes
                    from share_payload
                    """
                )
            )
            .mappings()
            .first()
        )

        observed_upload_trend = _rows(
            conn.execute(
                text(
                    """
                    with days as (
                      select generate_series(current_date - interval '13 days', current_date, interval '1 day')::date as day
                    ),
                    uploads as (
                      select created_at::date as day, coalesce(sum(size_bytes), 0) as drive_bytes, 0::bigint as message_bytes
                      from drive_items
                      where kind = 'FILE' and created_at >= current_date - interval '13 days'
                      group by created_at::date
                      union all
                      select created_at::date as day, 0::bigint as drive_bytes, coalesce(sum(attachment_size_bytes), 0) as message_bytes
                      from direct_messages
                      where attachment_object_key is not null and created_at >= current_date - interval '13 days'
                      group by created_at::date
                      union all
                      select created_at::date as day, 0::bigint as drive_bytes, coalesce(sum(attachment_size_bytes), 0) as message_bytes
                      from group_messages
                      where attachment_object_key is not null and created_at >= current_date - interval '13 days'
                      group by created_at::date
                    )
                    select
                      days.day,
                      coalesce(sum(uploads.drive_bytes), 0) as drive_upload_bytes,
                      coalesce(sum(uploads.message_bytes), 0) as message_upload_bytes,
                      coalesce(sum(uploads.drive_bytes + uploads.message_bytes), 0) as total_upload_bytes
                    from days
                    left join uploads on uploads.day = days.day
                    group by days.day
                    order by days.day
                    """
                )
            ).mappings()
        )

        recent_audit = _rows(
            conn.execute(
                text(
                    """
                    select
                      al.id,
                      al.user_id,
                      coalesce(u.username, 'system') as username,
                      al.action,
                      al.resource_type,
                      al.resource_id,
                      al.created_at
                    from audit_logs al
                    left join users u on u.id = al.user_id
                    order by al.created_at desc, al.id desc
                    limit 8
                    """
                )
            ).mappings()
        )

    total_observed_upload_bytes = _int(drive["used_bytes"]) + _int(messages["attachment_bytes"])

    return {
        "overview": {
            "users": users,
            "messages": messages,
            "drive": drive,
            "network": {
                "observed_upload_bytes": total_observed_upload_bytes,
                "estimated_shared_download_bytes": _int(drive_shares["estimated_download_bytes"]),
                "share_downloads": _int(drive_shares["share_downloads"]),
                "note": "Network transfer is derived from stored file sizes, message attachments, and drive share download counters; raw request bandwidth logs are not currently stored.",
            },
        },
        "hello": {
            "summary": messages,
            "trend": message_trend,
            "user_rank": message_user_rank,
        },
        "drive": {
            "summary": drive,
            "user_usage": drive_users,
            "type_distribution": drive_type_distribution,
            "upload_trend": drive_upload_trend,
            "largest_files": largest_files,
            "shares": drive_shares,
        },
        "network": {
            "upload_trend": observed_upload_trend,
            "shares": drive_shares,
            "note": "Download totals are estimated from drive share counters only; direct authenticated downloads are not counted without access logs.",
        },
        "recent_audit": recent_audit,
    }
