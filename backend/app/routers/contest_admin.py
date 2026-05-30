from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text

from app.db import engine
from app.dependencies import require_admin
from app.services.contests import (
    contest_access_payload,
    contest_dict,
    contest_participant_count,
    contest_problem_rows,
    contest_score_rows_advanced,
    csv_escape,
    get_contest,
    get_contest_any,
    parse_utc_datetime,
    scoreboard_rows,
)
from app.services.notifications import (
    notify_contest_announcement,
    notify_question_answered,
    notify_registration_status,
)

router = APIRouter()


@router.get("/api/admin/contests")
def admin_list_contests(user=Depends(require_admin)):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select c.*, count(cp.problem_id) as problem_count
                from contests c
                left join contest_problems cp on cp.contest_id = c.id
                group by c.id
                order by c.created_at desc
                """
            )
        ).mappings().all()
    return {"items": [contest_dict(row) for row in rows]}


@router.post("/api/admin/contests/upsert")
def admin_upsert_contest(payload: dict, user=Depends(require_admin)):
    slug = str(payload.get("slug") or "").strip()
    title = str(payload.get("title") or "").strip()
    description_md = str(payload.get("description_md") or "")
    status = str(payload.get("status") or "DRAFT").strip().upper()
    start_at = parse_utc_datetime(payload.get("start_at") or None)
    end_at = parse_utc_datetime(payload.get("end_at") or None)
    problem_slugs = payload.get("problem_slugs") or []
    if isinstance(problem_slugs, str):
        problem_slugs = [item.strip() for item in problem_slugs.split(",") if item.strip()]
    else:
        problem_slugs = [str(item).strip() for item in problem_slugs if str(item).strip()]

    if not slug:
        raise HTTPException(status_code=400, detail="Missing slug")
    if not title:
        raise HTTPException(status_code=400, detail="Missing title")
    if status not in {"DRAFT", "PUBLIC", "ARCHIVED"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                insert into contests(slug, title, description_md, status, start_at, end_at, updated_at)
                values (:slug, :title, :description_md, :status, :start_at, :end_at, now())
                on conflict (slug) do update set
                    title = excluded.title,
                    description_md = excluded.description_md,
                    status = excluded.status,
                    start_at = excluded.start_at,
                    end_at = excluded.end_at,
                    updated_at = now()
                returning *
                """
            ),
            {
                "slug": slug,
                "title": title,
                "description_md": description_md,
                "status": status,
                "start_at": start_at,
                "end_at": end_at,
            },
        ).mappings().first()
        contest_id = row["id"]
        conn.execute(text("delete from contest_problems where contest_id = :contest_id"), {"contest_id": contest_id})
        for index, problem_slug in enumerate(problem_slugs):
            problem = conn.execute(
                text("select id from problems where slug = :slug"),
                {"slug": problem_slug},
            ).mappings().first()
            if not problem:
                raise HTTPException(status_code=400, detail=f"Problem not found: {problem_slug}")
            conn.execute(
                text(
                    """
                    insert into contest_problems(contest_id, problem_id, display_order)
                    values (:contest_id, :problem_id, :display_order)
                    on conflict (contest_id, problem_id) do update set display_order = excluded.display_order
                    """
                ),
                {"contest_id": contest_id, "problem_id": problem["id"], "display_order": index},
            )

    contest = contest_dict(row)
    contest["problems"] = contest_problem_rows(contest["id"], public_only=False)
    return {"ok": True, "contest": contest}


@router.post("/api/admin/contests/{slug}/status")
def admin_set_contest_status(slug: str, payload: dict, user=Depends(require_admin)):
    status = str(payload.get("status") or "").strip().upper()
    if status not in {"DRAFT", "PUBLIC", "ARCHIVED"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    with engine.begin() as conn:
        row = conn.execute(
            text("update contests set status = :status, updated_at = now() where slug = :slug returning *"),
            {"slug": slug, "status": status},
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest not found")
    return {"ok": True, "contest": contest_dict(row)}


@router.get("/api/admin/contests/{slug}/participants")
def admin_contest_participants(slug: str, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select u.id, u.username, u.email, u.role, cp.joined_at
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                order by cp.joined_at asc, u.id asc
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().all()
    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@router.post("/api/admin/contests/{slug}/participants")
def admin_add_contest_participant(slug: str, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    username_or_email = str(payload.get("username_or_email") or "").strip()
    if not username_or_email:
        raise HTTPException(status_code=400, detail="Missing username_or_email")

    with engine.begin() as conn:
        user_row = conn.execute(
            text(
                """
                select id, username, email, role
                from users
                where username = :q or email = :q
                limit 1
                """
            ),
            {"q": username_or_email},
        ).mappings().first()
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")

        inserted = conn.execute(
            text(
                """
                insert into contest_participants(contest_id, user_id)
                values (:contest_id, :user_id)
                on conflict (contest_id, user_id) do nothing
                """
            ),
            {"contest_id": contest["id"], "user_id": user_row["id"]},
        )
        if inserted.rowcount:
            notify_registration_status(
                conn,
                contest_id=contest["id"],
                contest_slug=contest["slug"],
                contest_title=contest["title"],
                user_id=user_row["id"],
                status="ACCEPTED",
            )

    return {"ok": True, "user": dict(user_row), "participant_count": contest_participant_count(contest["id"])}


@router.post("/api/admin/contests/{slug}/participants/remove")
def admin_remove_contest_participant(slug: str, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                delete from contest_participants
                where contest_id = :contest_id and user_id = :user_id
                """
            ),
            {"contest_id": contest["id"], "user_id": int(user_id)},
        )

    return {"ok": True, "participant_count": contest_participant_count(contest["id"])}


@router.post("/api/admin/contests/{slug}/announcements")
def admin_create_contest_announcement(slug: str, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    title = str(payload.get("title") or "").strip()
    body_md = str(payload.get("body_md") or "")
    is_published = bool(payload.get("is_published", True))
    if not title:
        raise HTTPException(status_code=400, detail="Missing title")

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                insert into contest_announcements(contest_id, title, body_md, is_published)
                values (:contest_id, :title, :body_md, :is_published)
                returning id, title, body_md, is_published, created_at, updated_at
                """
            ),
            {
                "contest_id": contest["id"],
                "title": title,
                "body_md": body_md,
                "is_published": is_published,
            },
        ).mappings().first()
        notified_users = 0
        if is_published:
            notified_users = notify_contest_announcement(
                conn,
                contest_id=contest["id"],
                contest_slug=contest["slug"],
                title=f"比赛公告：{title}",
                body_md=body_md,
            )

    return {"ok": True, "announcement": dict(row), "notified_users": notified_users}


@router.post("/api/admin/contests/{slug}/announcements/{announcement_id}/delete")
def admin_delete_contest_announcement(slug: str, announcement_id: int, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                delete from contest_announcements
                where id = :id and contest_id = :contest_id
                """
            ),
            {"id": announcement_id, "contest_id": contest["id"]},
        )
    return {"ok": True}


@router.get("/api/admin/contests/{slug}/participants.csv")
def admin_export_contest_participants_csv(slug: str, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select u.id, u.username, coalesce(u.email, '') as email, u.role, cp.joined_at
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                order by cp.joined_at asc, u.id asc
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().all()

    lines = ["id,username,email,role,joined_at"]
    for row in rows:
        lines.append(
            ",".join(
                [
                    csv_escape(row["id"]),
                    csv_escape(row["username"]),
                    csv_escape(row["email"]),
                    csv_escape(row["role"]),
                    csv_escape(row["joined_at"]),
                ]
            )
        )

    return Response(
        content="\n".join(lines) + "\n",
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}_participants.csv"'},
    )


@router.post("/api/admin/contests/{slug}/scoreboard-settings")
def admin_contest_scoreboard_settings(slug: str, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    freeze_at = parse_utc_datetime(payload.get("freeze_at"))
    show_private_after_end = bool(payload.get("show_private_after_end", False))

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update contests
                set freeze_at = :freeze_at,
                    show_private_after_end = :show_private_after_end,
                    updated_at = now()
                where id = :contest_id
                returning id, slug, freeze_at, show_private_after_end
                """
            ),
            {
                "contest_id": contest["id"],
                "freeze_at": freeze_at,
                "show_private_after_end": show_private_after_end,
            },
        ).mappings().first()

    return {"ok": True, "contest": dict(row)}


@router.get("/api/admin/contests/{slug}/scoreboard.csv")
def admin_export_contest_scoreboard_csv(slug: str, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    items = scoreboard_rows(contest["id"], visible_until=None, show_private=True)
    lines = ["rank,user_id,username,solved,total_score,total_public_score,total_private_score,last_score_time"]
    for row in items:
        lines.append(
            ",".join(
                [
                    csv_escape(row.get("rank")),
                    csv_escape(row.get("user_id")),
                    csv_escape(row.get("username")),
                    csv_escape(row.get("solved")),
                    csv_escape(row.get("total_score")),
                    csv_escape(row.get("total_public_score")),
                    csv_escape(row.get("total_private_score")),
                    csv_escape(row.get("last_score_time")),
                ]
            )
        )

    return Response(
        content="\n".join(lines) + "\n",
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}_scoreboard.csv"'},
    )


@router.post("/api/admin/contests/{slug}/questions/{question_id}/answer")
def admin_answer_contest_question(slug: str, question_id: int, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    answer_md = str(payload.get("answer_md") or "").strip()
    is_public = bool(payload.get("is_public", True))
    if not answer_md:
        raise HTTPException(status_code=400, detail="Missing answer")

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update contest_questions
                set answer_md = :answer_md,
                    is_public = :is_public,
                    status = 'ANSWERED',
                    answered_at = now()
                where id = :id and contest_id = :contest_id
                returning id, user_id, title, body_md, answer_md, status, is_public, created_at, answered_at
                """
            ),
            {
                "id": question_id,
                "contest_id": contest["id"],
                "answer_md": answer_md,
                "is_public": is_public,
            },
        ).mappings().first()
        if row:
            notify_question_answered(
                conn,
                user_id=row["user_id"],
                contest_slug=contest["slug"],
                question_id=row["id"],
                question_title=row["title"],
                answer_md=row["answer_md"] or "",
            )

    if not row:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"ok": True, "question": dict(row)}


@router.post("/api/admin/contests/{slug}/questions/{question_id}/close")
def admin_close_contest_question(slug: str, question_id: int, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update contest_questions
                set status = 'CLOSED'
                where id = :id and contest_id = :contest_id
                returning id, title, status
                """
            ),
            {"id": question_id, "contest_id": contest["id"]},
        ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"ok": True, "question": dict(row)}


@router.get("/api/admin/contests/{slug}/full-settings")
def admin_get_contest_full_settings(slug: str, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    return {"contest": contest, "access": contest_access_payload(contest, user)}


@router.post("/api/admin/contests/{slug}/full-settings")
def admin_update_contest_full_settings(slug: str, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    visibility = str(payload.get("visibility", contest.get("visibility") or "PUBLIC")).upper()
    registration_mode = str(payload.get("registration_mode", contest.get("registration_mode") or "OPEN")).upper()
    scoreboard_mode = str(payload.get("scoreboard_mode", contest.get("scoreboard_mode") or "SCORE")).upper()

    if visibility not in {"PUBLIC", "PRIVATE", "UNLISTED"}:
        raise HTTPException(status_code=400, detail="Invalid visibility")
    if registration_mode not in {"OPEN", "INVITE", "APPROVAL", "CLOSED"}:
        raise HTTPException(status_code=400, detail="Invalid registration_mode")
    if scoreboard_mode not in {"SCORE", "ACM"}:
        raise HTTPException(status_code=400, detail="Invalid scoreboard_mode")

    freeze_at = parse_utc_datetime(payload.get("freeze_at")) if "freeze_at" in payload else contest.get("freeze_at")
    invite_code = payload.get("invite_code", contest.get("invite_code"))

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update contests
                set visibility = :visibility,
                    registration_mode = :registration_mode,
                    invite_code = :invite_code,
                    hide_problems_before_start = :hide_problems_before_start,
                    allow_join_after_start = :allow_join_after_start,
                    scoreboard_mode = :scoreboard_mode,
                    penalty_minutes = :penalty_minutes,
                    scoreboard_visible = :scoreboard_visible,
                    questions_enabled = :questions_enabled,
                    announcements_enabled = :announcements_enabled,
                    freeze_at = :freeze_at,
                    show_private_after_end = :show_private_after_end,
                    updated_at = now()
                where id = :contest_id
                returning *
                """
            ),
            {
                "contest_id": contest["id"],
                "visibility": visibility,
                "registration_mode": registration_mode,
                "invite_code": str(invite_code).strip() if invite_code else None,
                "hide_problems_before_start": bool(
                    payload.get("hide_problems_before_start", contest.get("hide_problems_before_start", False))
                ),
                "allow_join_after_start": bool(
                    payload.get("allow_join_after_start", contest.get("allow_join_after_start", True))
                ),
                "scoreboard_mode": scoreboard_mode,
                "penalty_minutes": int(payload.get("penalty_minutes", contest.get("penalty_minutes") or 20)),
                "scoreboard_visible": bool(payload.get("scoreboard_visible", contest.get("scoreboard_visible", True))),
                "questions_enabled": bool(payload.get("questions_enabled", contest.get("questions_enabled", True))),
                "announcements_enabled": bool(
                    payload.get("announcements_enabled", contest.get("announcements_enabled", True))
                ),
                "freeze_at": freeze_at,
                "show_private_after_end": bool(
                    payload.get("show_private_after_end", contest.get("show_private_after_end", False))
                ),
            },
        ).mappings().first()
    return {"ok": True, "contest": dict(row)}


@router.get("/api/admin/contests/{slug}/registrations")
def admin_contest_registrations(slug: str, status: str | None = None, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    params = {"contest_id": contest["id"]}
    where = ""
    if status:
        where = "and cp.status = :status"
        params["status"] = status.upper()

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select cp.contest_id, cp.user_id, cp.status, cp.invite_code_used, cp.note,
                       cp.joined_at, cp.approved_at, cp.rejected_at, u.username, u.email, u.role
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                {where}
                order by cp.joined_at desc, cp.user_id asc
                """
            ),
            params,
        ).mappings().all()
    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@router.post("/api/admin/contests/{slug}/registrations/{user_id}/status")
def admin_set_contest_registration_status(slug: str, user_id: int, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    status = str(payload.get("status") or "").upper()
    note = payload.get("note")
    if status not in {"PENDING", "ACCEPTED", "REJECTED"}:
        raise HTTPException(status_code=400, detail="Invalid status")

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                update contest_participants
                set status = :status,
                    note = :note,
                    approved_at = case when :status = 'ACCEPTED' then now() else approved_at end,
                    rejected_at = case when :status = 'REJECTED' then now() else rejected_at end
                where contest_id = :contest_id and user_id = :user_id
                returning *
                """
            ),
            {"contest_id": contest["id"], "user_id": user_id, "status": status, "note": note},
        ).mappings().first()
        if row:
            notify_registration_status(
                conn,
                contest_id=contest["id"],
                contest_slug=contest["slug"],
                contest_title=contest["title"],
                user_id=user_id,
                status=status,
                note=note,
            )
    if not row:
        raise HTTPException(status_code=404, detail="Registration not found")
    return {"ok": True, "registration": dict(row)}


@router.post("/api/admin/contests/{slug}/registrations/bulk-add")
def admin_bulk_add_contest_registrations(slug: str, payload: dict, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    raw = str(payload.get("users") or "")
    status = str(payload.get("status") or "ACCEPTED").upper()
    if status not in {"PENDING", "ACCEPTED"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    names = [item.strip() for item in raw.replace(",", "\n").splitlines() if item.strip()]
    added = []
    missing = []
    with engine.begin() as conn:
        for query in names:
            user_row = conn.execute(
                text("select id, username, email from users where username = :q or email = :q limit 1"),
                {"q": query},
            ).mappings().first()
            if not user_row:
                missing.append(query)
                continue
            conn.execute(
                text(
                    """
                    insert into contest_participants(contest_id, user_id, status, approved_at)
                    values (:contest_id, :user_id, :status, case when :status = 'ACCEPTED' then now() else null end)
                    on conflict (contest_id, user_id)
                    do update set status = excluded.status,
                                  approved_at = case when excluded.status = 'ACCEPTED' then now() else contest_participants.approved_at end,
                                  rejected_at = null
                    """
                ),
                {"contest_id": contest["id"], "user_id": user_row["id"], "status": status},
            )
            notify_registration_status(
                conn,
                contest_id=contest["id"],
                contest_slug=contest["slug"],
                contest_title=contest["title"],
                user_id=user_row["id"],
                status=status,
            )
            added.append(dict(user_row))
    return {"ok": True, "added": added, "missing": missing}


@router.get("/api/admin/contests/{slug}/registrations.csv")
def admin_export_contest_registrations_csv(slug: str, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select u.id, u.username, coalesce(u.email, '') as email, u.role,
                       cp.status, coalesce(cp.invite_code_used, '') as invite_code_used,
                       cp.joined_at, cp.approved_at, cp.rejected_at, coalesce(cp.note, '') as note
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id
                order by cp.joined_at desc, u.id asc
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().all()
    keys = ["id", "username", "email", "role", "status", "invite_code_used", "joined_at", "approved_at", "rejected_at", "note"]
    lines = [",".join(keys)]
    for row in rows:
        lines.append(",".join([csv_escape(row[key]) for key in keys]))
    return Response(
        content="\n".join(lines) + "\n",
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}_registrations.csv"'},
    )


@router.get("/api/admin/contests/{slug}/scoreboard-advanced.csv")
def admin_export_advanced_scoreboard_csv(slug: str, user=Depends(require_admin)):
    contest = get_contest_any(slug)
    items = contest_score_rows_advanced(contest, visible_until=None, show_private=True)
    mode = (contest.get("scoreboard_mode") or "SCORE").upper()
    if mode == "ACM":
        keys = ["rank", "user_id", "username", "solved", "penalty"]
    else:
        keys = ["rank", "user_id", "username", "solved", "total_score", "total_public_score", "total_private_score"]
    lines = [",".join(keys)]
    for row in items:
        lines.append(",".join([csv_escape(row.get(key)) for key in keys]))
    return Response(
        content="\n".join(lines) + "\n",
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}_advanced_scoreboard.csv"'},
    )
