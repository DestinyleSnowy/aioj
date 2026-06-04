from sqlalchemy import text


def create_notification(conn, user_id: int | None, kind: str, title: str, body_md: str = "", link: str | None = None) -> None:
    if not user_id:
        return
    conn.execute(
        text(
            """
            insert into notifications(user_id, type, title, body_md, link)
            values (:user_id, :type, :title, :body_md, :link)
            """
        ),
        {
            "user_id": user_id,
            "type": str(kind or "").strip() or "SYSTEM",
            "title": str(title or "").strip() or "平台通知",
            "body_md": body_md or "",
            "link": str(link).strip() if link else None,
        },
    )


def notify_submission_result(conn, submission_id: int) -> None:
    row = conn.execute(
        text(
            """
            select
                s.id,
                s.user_id,
                s.status,
                s.public_score,
                s.private_score,
                s.error_message,
                p.slug as problem_slug,
                p.title as problem_title
            from submissions s
            join problems p on p.id = s.problem_id
            where s.id = :submission_id
            """
        ),
        {"submission_id": submission_id},
    ).mappings().first()
    if not row or not row["user_id"]:
        return

    status = str(row["status"] or "").upper()
    success = status in {"ACCEPTED", "TEST_ACCEPTED"}
    title = f"提交 #{row['id']} 评测已完成"
    if success:
        body = (
            f"题目 `{row['problem_slug']}` 评测完成，状态为 `{status}`。"
            f" Public Score: {row['public_score'] if row['public_score'] is not None else '—'}，"
            f" Private Score: {row['private_score'] if row['private_score'] is not None else '—'}。"
        )
    else:
        body = (
            f"题目 `{row['problem_slug']}` 的提交评测结束，状态为 `{status}`。"
            f" 错误信息：{row['error_message'] or '无'}。"
        )

    create_notification(
        conn,
        row["user_id"],
        "SUBMISSION_RESULT",
        title,
        body,
        f"/submissions/{row['id']}",
    )


def notify_registration_status(
    conn,
    *,
    contest_id: int,
    contest_slug: str,
    contest_title: str,
    user_id: int,
    status: str,
    note: str | None = None,
) -> None:
    normalized_status = str(status or "").upper()
    if normalized_status not in {"ACCEPTED", "REJECTED", "PENDING"}:
        return

    label = {
        "ACCEPTED": "报名已通过",
        "REJECTED": "报名被驳回",
        "PENDING": "报名待审核",
    }[normalized_status]
    body = f"比赛 `{contest_title}`（{contest_slug}）的报名状态更新为 `{normalized_status}`。"
    if note:
        body += f" 备注：{note}。"

    create_notification(
        conn,
        user_id,
        "CONTEST_REGISTRATION",
        label,
        body,
        f"/contests/{contest_slug}",
    )


def notify_contest_announcement(conn, *, contest_id: int, contest_slug: str, title: str, body_md: str) -> int:
    result = conn.execute(
        text(
            """
            insert into notifications(user_id, type, title, body_md, link)
            select cp.user_id,
                   'CONTEST_ANNOUNCEMENT',
                   :title,
                   :body_md,
                   :link
            from contest_participants cp
            where cp.contest_id = :contest_id
              and cp.status = 'ACCEPTED'
            """
        ),
        {
            "contest_id": contest_id,
            "title": title,
            "body_md": body_md or "",
            "link": f"/contests/{contest_slug}",
        },
    )
    return result.rowcount or 0


def notify_admin_broadcast(conn, *, title: str, body_md: str, link: str | None = None) -> int:
    result = conn.execute(
        text(
            """
            insert into notifications(user_id, type, title, body_md, link)
            select u.id,
                   'ADMIN_BROADCAST',
                   :title,
                   :body_md,
                   :link
            from users u
            where coalesce(u.is_disabled, false) = false
            """
        ),
        {
            "title": str(title or "").strip() or "管理员广播",
            "body_md": body_md or "",
            "link": str(link).strip() if link else None,
        },
    )
    return result.rowcount or 0


def notify_question_answered(
    conn,
    *,
    user_id: int | None,
    contest_slug: str,
    question_id: int,
    question_title: str,
    answer_md: str,
) -> None:
    if not user_id:
        return
    create_notification(
        conn,
        user_id,
        "QUESTION_ANSWERED",
        "比赛答疑已回复",
        f"问题《{question_title}》已有官方回复。{answer_md[:200]}",
        f"/contests/{contest_slug}",
    )
