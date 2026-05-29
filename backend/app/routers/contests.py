from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.db import engine
from app.dependencies import get_optional_user, require_user
from app.services.contests import (
    contest_access_payload,
    contest_dict,
    contest_participant_count,
    contest_problem_rows,
    contest_score_rows_advanced,
    contest_state,
    csv_escape,
    get_contest,
    register_for_contest,
    scoreboard_rows,
)

router = APIRouter()


@router.get("/api/contests")
def list_contests():
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select c.*, count(cp.problem_id) as problem_count
                from contests c
                left join contest_problems cp on cp.contest_id = c.id
                where c.status = 'PUBLIC'
                  and coalesce(c.visibility, 'PUBLIC') <> 'PRIVATE'
                group by c.id
                order by c.start_at nulls last, c.created_at desc
                """
            )
        ).mappings().all()
    return {"items": [contest_dict(row) for row in rows]}


@router.get("/api/contests/{slug}")
def contest_detail(slug: str):
    contest = get_contest(slug, public_only=True)
    contest["problems"] = contest_problem_rows(contest["id"], public_only=True)
    return contest


@router.get("/api/contests/{slug}/leaderboard")
def contest_leaderboard(slug: str):
    contest = get_contest(slug, public_only=True)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                with ranked as (
                    select s.id as submission_id, s.user_id,
                           coalesce(u.username, 'anonymous') as username,
                           s.problem_id, s.public_score, s.private_score,
                           row_number() over (
                               partition by coalesce(s.user_id, 0), s.problem_id
                               order by s.public_score desc nulls last, s.id asc
                           ) as rn
                    from submissions s
                    join contest_problems cp on cp.problem_id = s.problem_id and cp.contest_id = :contest_id
                    left join users u on u.id = s.user_id
                    where s.status = 'ACCEPTED'
                      and s.contest_id = :contest_id
                ), best as (select * from ranked where rn = 1)
                select user_id, username, count(*) as solved,
                       sum(public_score) as total_public_score,
                       sum(private_score) as total_private_score,
                       json_agg(json_build_object(
                           'problem_id', problem_id,
                           'submission_id', submission_id,
                           'public_score', public_score,
                           'private_score', private_score
                       ) order by problem_id) as problems
                from best
                group by user_id, username
                order by total_public_score desc nulls last, solved desc, username asc
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().all()
    items = []
    for index, row in enumerate(rows, start=1):
        data = dict(row)
        data["rank"] = index
        items.append(data)
    return {"contest_slug": slug, "items": items}


@router.get("/api/contests/{slug}/me")
def contest_me(slug: str, user=Depends(get_optional_user)):
    contest = get_contest(slug, public_only=True)
    is_participant = False

    if user:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    select 1
                    from contest_participants
                    where contest_id = :contest_id and user_id = :user_id
                    """
                ),
                {"contest_id": contest["id"], "user_id": user["id"]},
            ).first()
        is_participant = bool(row)

    return {
        "contest_slug": slug,
        "participant_count": contest_participant_count(contest["id"]),
        "is_participant": is_participant,
        "user_id": user["id"] if user else None,
    }


@router.post("/api/contests/{slug}/join")
def contest_join(slug: str, user=Depends(require_user)):
    contest = get_contest(slug, public_only=True)
    return register_for_contest(contest, user, {})


@router.post("/api/contests/{slug}/leave")
def contest_leave(slug: str, user=Depends(require_user)):
    contest = get_contest(slug, public_only=True)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                delete from contest_participants
                where contest_id = :contest_id and user_id = :user_id
                """
            ),
            {"contest_id": contest["id"], "user_id": user["id"]},
        )

    return {
        "ok": True,
        "contest_slug": slug,
        "is_participant": False,
        "participant_count": contest_participant_count(contest["id"]),
    }


@router.get("/api/contests/{slug}/stats")
def contest_stats(slug: str):
    contest = get_contest(slug, public_only=True)

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select
                    (select count(*) from contest_participants where contest_id = :contest_id) as participant_count,
                    (select count(*) from submissions where contest_id = :contest_id) as submission_count,
                    (select count(*) from submissions where contest_id = :contest_id and status = 'ACCEPTED') as accepted_count,
                    (select count(distinct user_id) from submissions where contest_id = :contest_id and user_id is not null) as submitting_user_count
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().first()

    return {"contest_slug": slug, **dict(row)}


@router.get("/api/contests/{slug}/announcements")
def contest_announcements(slug: str):
    contest = get_contest(slug, public_only=True)

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select id, title, body_md, created_at, updated_at
                from contest_announcements
                where contest_id = :contest_id and is_published = true
                order by created_at desc, id desc
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().all()

    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@router.get("/api/contests/{slug}/submissions")
def contest_user_submissions(slug: str, show_all: bool = False, limit: int = 50, user=Depends(require_user)):
    contest = get_contest(slug, public_only=True)
    limit = max(1, min(int(limit or 50), 200))

    where_user = ""
    params = {"contest_id": contest["id"], "limit": limit}
    if not (show_all and user.get("role") == "ADMIN"):
        where_user = "and s.user_id = :user_id"
        params["user_id"] = user["id"]

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select
                    s.id,
                    s.problem_id,
                    p.slug as problem_slug,
                    p.title as problem_title,
                    s.status,
                    s.public_score,
                    s.private_score,
                    s.runtime_ms,
                    s.error_message,
                    s.created_at,
                    s.judged_at
                from submissions s
                join problems p on p.id = s.problem_id
                where s.contest_id = :contest_id
                {where_user}
                order by s.id desc
                limit :limit
                """
            ),
            params,
        ).mappings().all()

    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@router.get("/api/contests/{slug}/scoreboard")
def contest_scoreboard(slug: str, admin_full: bool = False, user=Depends(get_optional_user)):
    contest = get_contest(slug, public_only=True)
    state = contest_state(contest)
    now = datetime.now(timezone.utc)

    freeze_at = contest.get("freeze_at")
    is_admin = bool(user and user.get("role") == "ADMIN")
    use_admin_full = bool(admin_full and is_admin)

    show_private = bool(contest.get("show_private_after_end")) and state == "ENDED"
    is_frozen = bool(freeze_at and now >= freeze_at and state != "ENDED" and not use_admin_full)
    visible_until = freeze_at if is_frozen else None

    return {
        "contest_slug": slug,
        "state": state,
        "items": scoreboard_rows(contest["id"], visible_until=visible_until, show_private=show_private),
        "is_frozen": is_frozen,
        "freeze_at": freeze_at,
        "visible_until": visible_until,
        "show_private": show_private,
        "admin_full": use_admin_full,
    }


@router.get("/api/contests/{slug}/questions")
def contest_questions(slug: str, user=Depends(get_optional_user)):
    contest = get_contest(slug, public_only=True)
    is_admin = bool(user and user.get("role") == "ADMIN")

    with engine.connect() as conn:
        if is_admin:
            rows = conn.execute(
                text(
                    """
                    select
                        q.id,
                        q.title,
                        q.body_md,
                        q.answer_md,
                        q.status,
                        q.is_public,
                        q.created_at,
                        q.answered_at,
                        q.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        true as can_view_body
                    from contest_questions q
                    left join users u on u.id = q.user_id
                    where q.contest_id = :contest_id
                    order by q.created_at desc, q.id desc
                    """
                ),
                {"contest_id": contest["id"]},
            ).mappings().all()
        elif user:
            rows = conn.execute(
                text(
                    """
                    select
                        q.id,
                        q.title,
                        case when q.is_public or q.user_id = :user_id then q.body_md else '' end as body_md,
                        q.answer_md,
                        q.status,
                        q.is_public,
                        q.created_at,
                        q.answered_at,
                        q.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        case when q.is_public or q.user_id = :user_id then true else false end as can_view_body
                    from contest_questions q
                    left join users u on u.id = q.user_id
                    where q.contest_id = :contest_id
                      and (q.is_public = true or q.user_id = :user_id)
                    order by q.created_at desc, q.id desc
                    """
                ),
                {"contest_id": contest["id"], "user_id": user["id"]},
            ).mappings().all()
        else:
            rows = conn.execute(
                text(
                    """
                    select
                        q.id,
                        q.title,
                        q.body_md,
                        q.answer_md,
                        q.status,
                        q.is_public,
                        q.created_at,
                        q.answered_at,
                        q.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        true as can_view_body
                    from contest_questions q
                    left join users u on u.id = q.user_id
                    where q.contest_id = :contest_id
                      and q.is_public = true
                    order by q.created_at desc, q.id desc
                    """
                ),
                {"contest_id": contest["id"]},
            ).mappings().all()

    return {"contest_slug": slug, "items": [dict(r) for r in rows]}


@router.post("/api/contests/{slug}/questions")
def contest_ask_question(slug: str, payload: dict, user=Depends(require_user)):
    contest = get_contest(slug, public_only=True)
    title = str(payload.get("title") or "").strip()
    body_md = str(payload.get("body_md") or "").strip()

    if not title:
        raise HTTPException(status_code=400, detail="Missing title")
    if not body_md:
        raise HTTPException(status_code=400, detail="Missing body")

    with engine.connect() as conn:
        participant = conn.execute(
            text(
                """
                select 1 from contest_participants
                where contest_id = :contest_id and user_id = :user_id
                  and coalesce(status, 'ACCEPTED') = 'ACCEPTED'
                """
            ),
            {"contest_id": contest["id"], "user_id": user["id"]},
        ).first()

    if not participant and user.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Join contest before asking questions")

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                insert into contest_questions(contest_id, user_id, title, body_md)
                values (:contest_id, :user_id, :title, :body_md)
                returning id, title, body_md, status, is_public, created_at
                """
            ),
            {
                "contest_id": contest["id"],
                "user_id": user["id"],
                "title": title,
                "body_md": body_md,
            },
        ).mappings().first()

    return {"ok": True, "question": dict(row)}


@router.get("/api/contests/{slug}/access")
def contest_access(slug: str, user=Depends(get_optional_user)):
    contest = get_contest(slug, public_only=True)
    with engine.connect() as conn:
        counts = conn.execute(
            text(
                """
                select
                    count(*) filter (where status = 'ACCEPTED') as accepted_count,
                    count(*) filter (where status = 'PENDING') as pending_count,
                    count(*) filter (where status = 'REJECTED') as rejected_count
                from contest_participants
                where contest_id = :contest_id
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().first()

    return {
        "contest_slug": slug,
        "state": contest_state(contest),
        **contest_access_payload(contest, user),
        "participant_counts": dict(counts),
    }


@router.post("/api/contests/{slug}/register")
def contest_register(slug: str, payload: dict | None = None, user=Depends(require_user)):
    contest = get_contest(slug, public_only=True)
    return register_for_contest(contest, user, payload)


@router.get("/api/contests/{slug}/scoreboard-advanced")
def contest_scoreboard_advanced(slug: str, admin_full: bool = False, user=Depends(get_optional_user)):
    contest = get_contest(slug, public_only=True)
    access = contest_access_payload(contest, user)
    is_admin = bool(user and user.get("role") == "ADMIN")
    if not access["scoreboard_visible"] and not is_admin:
        raise HTTPException(status_code=403, detail="Scoreboard is hidden")

    state = contest_state(contest)
    now = datetime.now(timezone.utc)
    freeze_at = contest.get("freeze_at")
    show_private = bool(contest.get("show_private_after_end")) and state == "ENDED"
    is_frozen = bool(freeze_at and now >= freeze_at and state != "ENDED" and not (admin_full and is_admin))
    visible_until = freeze_at if is_frozen else None

    return {
        "contest_slug": slug,
        "state": state,
        "mode": (contest.get("scoreboard_mode") or "SCORE").upper(),
        "items": contest_score_rows_advanced(contest, visible_until=visible_until, show_private=show_private),
        "is_frozen": is_frozen,
        "freeze_at": freeze_at,
        "visible_until": visible_until,
        "show_private": show_private,
        "admin_full": bool(admin_full and is_admin),
    }


@router.get("/api/contests/{slug}/problem-stats")
def contest_problem_stats(slug: str):
    contest = get_contest(slug, public_only=True)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                select p.id, p.slug, p.title,
                       count(distinct s.user_id) filter (where s.status = 'ACCEPTED') as solved_users,
                       count(s.id) as submissions,
                       min(s.judged_at) filter (where s.status = 'ACCEPTED') as first_ac_at
                from contest_problems cp
                join problems p on p.id = cp.problem_id
                left join submissions s on s.problem_id = p.id and s.contest_id = cp.contest_id
                left join contest_participants cpart on cpart.contest_id = cp.contest_id and cpart.user_id = s.user_id and cpart.status = 'ACCEPTED'
                where cp.contest_id = :contest_id
                group by p.id, p.slug, p.title, cp.display_order
                order by cp.display_order asc, p.id asc
                """
            ),
            {"contest_id": contest["id"]},
        ).mappings().all()
    return {"contest_slug": slug, "items": [dict(r) for r in rows]}
