from sqlalchemy import text

from app.db import engine


def get_setting_bool(key: str, default: bool = False) -> bool:
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("select value from system_settings where key = :key"),
                {"key": key},
            ).mappings().first()
        if not row:
            return default
        return str(row["value"]).lower() in {"1", "true", "yes", "on"}
    except Exception:
        return default


def set_setting_bool(key: str, value: bool) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                insert into system_settings(key, value, updated_at)
                values (:key, :value, now())
                on conflict (key)
                do update set value = excluded.value, updated_at = now()
                """
            ),
            {"key": key, "value": "true" if value else "false"},
        )


def ensure_default_settings() -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                insert into system_settings(key, value)
                values ('registration_enabled', 'true')
                on conflict (key) do nothing
                """
            )
        )
