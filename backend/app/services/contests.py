from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text

from app.db import engine


def parse_utc_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def contest_state(row):
    now = datetime.now(timezone.utc)
    start_at = row.get("start_at")
    end_at = row.get("end_at")
    if row.get("status") != "PUBLIC":
        return "DRAFT"
    if start_at and now < start_at:
        return "UPCOMING"
    if end_at and now > end_at:
        return "ENDED"
    return "RUNNING"


def contest_dict(row):
    data = dict(row)
    data["state"] = contest_state(data)
    return data


def get_contest(slug: str, public_only: bool = True):
    with engine.connect() as conn:
        if public_only:
            row = conn.execute(
                text("select * from contests where slug = :slug and status = 'PUBLIC'"),
                {"slug": slug},
            ).mappings().first()
        else:
            row = conn.execute(text("select * from contests where slug = :slug"), {"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest not found")
    return contest_dict(row)


def get_contest_any(slug: str):
    with engine.connect() as conn:
        row = conn.execute(text("select * from contests where slug = :slug"), {"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Contest not found")
    return dict(row)


def contest_problem_rows(contest_id: int, public_only: bool = True):
    with engine.connect() as conn:
        status_filter = "and p.status = 'PUBLIC'" if public_only else ""
        rows = conn.execute(
            text(
                f"""
                select p.id, p.slug, p.title, p.metric, p.higher_is_better,
                       p.time_limit_sec, p.memory_limit_mb, p.cpu_count,
                       (p.active_version_id is not null) as is_submittable,
                       cp.display_order
                from contest_problems cp
                join problems p on p.id = cp.problem_id
                where cp.contest_id = :contest_id
                {status_filter}
                order by cp.display_order asc, p.id asc
                """
            ),
            {"contest_id": contest_id},
        ).mappings().all()
    return [dict(r) for r in rows]


def contest_participant_count(contest_id: int) -> int:
    with engine.connect() as conn:
        row = conn.execute(
            text("select count(*) as n from contest_participants where contest_id = :contest_id"),
            {"contest_id": contest_id},
        ).mappings().first()
    return int(row["n"] if row else 0)


def participant_row(contest_id: int, user_id: int | None):
    if not user_id:
        return None
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select cp.*, u.username, u.email, u.role
                from contest_participants cp
                join users u on u.id = cp.user_id
                where cp.contest_id = :contest_id and cp.user_id = :user_id
                """
            ),
            {"contest_id": contest_id, "user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def contest_access_payload(contest: dict, user=None):
    state = contest_state(contest)
    is_admin = bool(user and user.get("role") == "ADMIN")
    participant = participant_row(contest["id"], user.get("id") if user else None)
    participant_status = participant.get("status") if participant else None
    is_accepted = participant_status == "ACCEPTED"
    is_pending = participant_status == "PENDING"
    registration_mode = contest.get("registration_mode") or "OPEN"
    visibility = contest.get("visibility") or "PUBLIC"

    can_view_contest = contest.get("status") == "PUBLIC" or is_admin or is_accepted
    if visibility == "PRIVATE" and not (is_admin or is_accepted):
        can_view_contest = False
    can_view_problems = is_admin or is_accepted
    if visibility == "PUBLIC" and not contest.get("hide_problems_before_start"):
        can_view_problems = True
    if state == "UPCOMING" and contest.get("hide_problems_before_start") and not is_admin and not is_accepted:
        can_view_problems = False

    can_submit = is_admin or (is_accepted and state == "RUNNING")
    can_ask = is_admin or (is_accepted and bool(contest.get("questions_enabled", True)))
    can_register = bool(user) and registration_mode not in ("CLOSED",) and not is_accepted and not is_pending
    if state == "RUNNING" and not contest.get("allow_join_after_start", True):
        can_register = False
    if state == "ENDED":
        can_register = False

    return {
        "visibility": visibility,
        "registration_mode": registration_mode,
        "participant_status": participant_status,
        "is_participant": is_accepted,
        "is_pending": is_pending,
        "can_view_contest": can_view_contest,
        "can_view_problems": can_view_problems,
        "can_submit": can_submit,
        "can_ask": can_ask,
        "can_register": can_register,
        "hide_problems_before_start": bool(contest.get("hide_problems_before_start", False)),
        "allow_join_after_start": bool(contest.get("allow_join_after_start", True)),
        "scoreboard_mode": contest.get("scoreboard_mode") or "SCORE",
        "penalty_minutes": contest.get("penalty_minutes") or 20,
        "scoreboard_visible": bool(contest.get("scoreboard_visible", True)),
        "questions_enabled": bool(contest.get("questions_enabled", True)),
        "announcements_enabled": bool(contest.get("announcements_enabled", True)),
        "freeze_at": contest.get("freeze_at"),
        "show_private_after_end": bool(contest.get("show_private_after_end", False)),
    }


def scoreboard_rows(contest_id: int, visible_until=None, show_private: bool = False):
    where_extra = ""
    params = {"contest_id": contest_id, "show_private": show_private}
    if visible_until is not None:
        where_extra = "and coalesce(s.judged_at, s.created_at) <= :visible_until"
        params["visible_until"] = visible_until

    score_expr = "case when :show_private then coalesce(s.private_score, s.public_score) else s.public_score end"

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                with ranked as (
                    select
                        s.id as submission_id,
                        s.user_id,
                        coalesce(u.username, 'anonymous') as username,
                        s.problem_id,
                        p.slug as problem_slug,
                        p.title as problem_title,
                        s.public_score,
                        s.private_score,
                        {score_expr} as visible_score,
                        p.higher_is_better,
                        coalesce(s.judged_at, s.created_at) as score_time,
                        row_number() over (
                            partition by s.user_id, s.problem_id
                            order by
                                case
                                    when p.higher_is_better then coalesce(({score_expr}), '-Infinity'::float8)
                                    else -coalesce(({score_expr}), 'Infinity'::float8)
                                end desc,
                                s.id asc
                        ) as rn
                    from submissions s
                    join contest_participants cpart
                      on cpart.contest_id = :contest_id and cpart.user_id = s.user_id
                    join problems p on p.id = s.problem_id
                    left join users u on u.id = s.user_id
                    where s.status = 'ACCEPTED'
                      and s.contest_id = :contest_id
                      {where_extra}
                ),
                best as (
                    select * from ranked where rn = 1
                )
                select
                    user_id,
                    username,
                    count(*) as solved,
                    sum(visible_score) as total_score,
                    sum(public_score) as total_public_score,
                    sum(private_score) as total_private_score,
                    max(score_time) as last_score_time,
                    json_agg(json_build_object(
                        'problem_id', problem_id,
                        'problem_slug', problem_slug,
                        'submission_id', submission_id,
                        'public_score', public_score,
                        'private_score', private_score,
                        'visible_score', visible_score
                    ) order by problem_slug) as problems
                from best
                group by user_id, username
                order by total_score desc nulls last, solved desc, last_score_time asc nulls last, username asc
                """
            ),
            params,
        ).mappings().all()

    items = []
    for index, row in enumerate(rows, start=1):
        data = dict(row)
        data["rank"] = index
        items.append(data)
    return items


def register_for_contest(contest: dict, user, payload: dict | None = None):
    payload = payload or {}
    state = contest_state(contest)
    mode = contest.get("registration_mode") or "OPEN"
    invite_code = str(payload.get("invite_code") or "").strip()

    if state == "ENDED":
        raise HTTPException(status_code=403, detail="Contest has ended")
    if state == "RUNNING" and not contest.get("allow_join_after_start", True):
        raise HTTPException(status_code=403, detail="Registration is closed after contest starts")
    if mode == "CLOSED":
        raise HTTPException(status_code=403, detail="Registration is closed")
    if mode == "INVITE":
        expected = str(contest.get("invite_code") or "").strip()
        if not expected or invite_code != expected:
            raise HTTPException(status_code=403, detail="Invalid invite code")

    new_status = "PENDING" if mode == "APPROVAL" else "ACCEPTED"
    approved_at = datetime.now(timezone.utc) if new_status == "ACCEPTED" else None

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                insert into contest_participants(contest_id, user_id, status, invite_code_used, approved_at, rejected_at)
                values (:contest_id, :user_id, :status, :invite_code_used, :approved_at, null)
                on conflict (contest_id, user_id)
                do update set
                    status = case
                        when contest_participants.status = 'REJECTED' then excluded.status
                        else contest_participants.status
                    end,
                    invite_code_used = coalesce(excluded.invite_code_used, contest_participants.invite_code_used),
                    approved_at = case when excluded.status = 'ACCEPTED' then now() else contest_participants.approved_at end,
                    rejected_at = null
                returning status
                """
            ),
            {
                "contest_id": contest["id"],
                "user_id": user["id"],
                "status": new_status,
                "invite_code_used": invite_code or None,
                "approved_at": approved_at,
            },
        ).mappings().first()

    return {
        "ok": True,
        "contest_slug": contest["slug"],
        "participant_status": row["status"],
        "is_participant": row["status"] == "ACCEPTED",
        "is_pending": row["status"] == "PENDING",
    }


def contest_score_rows_advanced(contest: dict, visible_until=None, show_private: bool = False):
    contest_id = contest["id"]
    mode = (contest.get("scoreboard_mode") or "SCORE").upper()
    params = {"contest_id": contest_id}
    where_time = ""
    if visible_until is not None:
        where_time = "and coalesce(s.judged_at, s.created_at) <= :visible_until"
        params["visible_until"] = visible_until

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                select s.id, s.user_id, u.username, s.problem_id, p.slug as problem_slug, p.title as problem_title,
                       p.higher_is_better, s.status, s.public_score, s.private_score, s.created_at, s.judged_at
                from submissions s
                join contest_participants cp on cp.contest_id = :contest_id and cp.user_id = s.user_id and cp.status = 'ACCEPTED'
                join users u on u.id = s.user_id
                join problems p on p.id = s.problem_id
                where s.contest_id = :contest_id
                {where_time}
                order by s.user_id asc, s.problem_id asc, s.id asc
                """
            ),
            params,
        ).mappings().all()

    by_user = {}
    if mode == "ACM":
        start_at = contest.get("start_at") or datetime.now(timezone.utc)
        penalty_minutes = int(contest.get("penalty_minutes") or 20)
        per_problem = {}
        for row in rows:
            per_problem.setdefault((row["user_id"], row["problem_id"]), []).append(dict(row))
        for (user_id, problem_id), subs in per_problem.items():
            username = subs[0]["username"]
            problem_slug = subs[0]["problem_slug"]
            failed = 0
            accepted = None
            for sub in subs:
                if sub["status"] == "ACCEPTED":
                    accepted = sub
                    break
                failed += 1
            user_row = by_user.setdefault(
                user_id,
                {"user_id": user_id, "username": username, "solved": 0, "penalty": 0, "problems": []},
            )
            if accepted:
                ac_time = accepted.get("judged_at") or accepted.get("created_at")
                minutes = int(max(0, (ac_time - start_at).total_seconds()) // 60)
                penalty = minutes + failed * penalty_minutes
                user_row["solved"] += 1
                user_row["penalty"] += penalty
                user_row["problems"].append(
                    {
                        "problem_id": problem_id,
                        "problem_slug": problem_slug,
                        "submission_id": accepted["id"],
                        "attempts": failed + 1,
                        "penalty": penalty,
                        "status": "AC",
                    }
                )
            else:
                user_row["problems"].append(
                    {"problem_id": problem_id, "problem_slug": problem_slug, "attempts": failed, "status": "TRIED"}
                )
        items = sorted(by_user.values(), key=lambda item: (-item["solved"], item["penalty"], item["username"]))
        for index, item in enumerate(items, start=1):
            item["rank"] = index
            item["total_score"] = item["solved"]
            item["total_public_score"] = item["solved"]
            item["total_private_score"] = item["solved"]
        return items

    best = {}
    for row in rows:
        if row["status"] != "ACCEPTED":
            continue
        score = row["private_score"] if show_private and row["private_score"] is not None else row["public_score"]
        if score is None:
            continue
        key = (row["user_id"], row["problem_id"])
        old = best.get(key)
        better = old is None or (score > old["visible_score"] if row["higher_is_better"] else score < old["visible_score"])
        if better:
            data = dict(row)
            data["visible_score"] = score
            best[key] = data

    for row in best.values():
        user_row = by_user.setdefault(
            row["user_id"],
            {
                "user_id": row["user_id"],
                "username": row["username"],
                "solved": 0,
                "total_score": 0,
                "total_public_score": 0,
                "total_private_score": 0,
                "problems": [],
            },
        )
        user_row["solved"] += 1
        user_row["total_score"] += row["visible_score"] or 0
        user_row["total_public_score"] += row["public_score"] or 0
        user_row["total_private_score"] += row["private_score"] or 0
        user_row["problems"].append(
            {
                "problem_id": row["problem_id"],
                "problem_slug": row["problem_slug"],
                "submission_id": row["id"],
                "public_score": row["public_score"],
                "private_score": row["private_score"],
                "visible_score": row["visible_score"],
            }
        )
    items = sorted(by_user.values(), key=lambda item: (-(item["total_score"] or 0), -item["solved"], item["username"]))
    for index, item in enumerate(items, start=1):
        item["rank"] = index
    return items


def csv_escape(value) -> str:
    text_value = "" if value is None else str(value)
    return '"' + text_value.replace('"', '""') + '"'
