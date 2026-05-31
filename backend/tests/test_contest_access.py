from datetime import datetime, timedelta, timezone

from app.services.contests import contest_access_payload


def base_contest(**overrides):
    now = datetime.now(timezone.utc)
    contest = {
        "id": 1,
        "status": "PUBLIC",
        "visibility": "PUBLIC",
        "registration_mode": "OPEN",
        "start_at": now - timedelta(minutes=5),
        "end_at": now + timedelta(minutes=30),
        "hide_problems_before_start": False,
        "allow_join_after_start": True,
        "scoreboard_mode": "SCORE",
        "scoreboard_visible": True,
        "questions_enabled": True,
        "announcements_enabled": True,
        "show_private_after_end": False,
    }
    contest.update(overrides)
    return contest


def test_private_contest_is_not_visible_to_anonymous(monkeypatch):
    monkeypatch.setattr("app.services.contests.participant_row", lambda contest_id, user_id: None)

    access = contest_access_payload(base_contest(visibility="PRIVATE"), None)

    assert access["can_view_contest"] is False
    assert access["can_view_problems"] is False


def test_private_contest_is_visible_to_accepted_participant(monkeypatch):
    monkeypatch.setattr(
        "app.services.contests.participant_row",
        lambda contest_id, user_id: {"status": "ACCEPTED"},
    )

    access = contest_access_payload(base_contest(visibility="PRIVATE"), {"id": 7, "role": "USER"})

    assert access["can_view_contest"] is True
    assert access["can_view_problems"] is True
