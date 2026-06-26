from app.migrations import (
    DRIVE_SCHEMA_COMPATIBILITY_SQL,
    MESSAGE_SCHEMA_COMPATIBILITY_SQL,
    alembic_ini_path,
    alembic_script_location,
    ensure_drive_schema_compatibility,
    build_alembic_config,
    ensure_message_schema_compatibility,
    resolve_database_url,
)


def test_build_alembic_config_uses_project_paths_and_override_url():
    config = build_alembic_config("postgresql+psycopg://user:pass@host:5432/dbname")

    assert config.get_main_option("sqlalchemy.url") == "postgresql+psycopg://user:pass@host:5432/dbname"
    assert config.get_main_option("script_location") == str(alembic_script_location().resolve())
    assert config.config_file_name == str(alembic_ini_path())


def test_resolve_database_url_prefers_explicit_then_environment():
    assert resolve_database_url(
        "postgresql+psycopg://explicit",
        environ={"DATABASE_URL": "postgresql+psycopg://env"},
    ) == "postgresql+psycopg://explicit"
    assert resolve_database_url(
        None,
        environ={"DATABASE_URL": "postgresql+psycopg://env"},
    ) == "postgresql+psycopg://env"


def test_alembic_runtime_should_prefer_environment_over_ini_fallback():
    ini_fallback = "postgresql+psycopg://aioj:aioj@postgres:5432/aioj"
    runtime_env = {"DATABASE_URL": "postgresql+psycopg://prod-user:prod-pass@postgres:5432/prod-db"}

    selected = runtime_env.get("DATABASE_URL") or ini_fallback

    assert selected == "postgresql+psycopg://prod-user:prod-pass@postgres:5432/prod-db"


class _FakeConn:
    def __init__(self):
        self.calls: list[str] = []

    def execute(self, statement):
        self.calls.append(str(statement))


class _FakeBegin:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeEngine:
    def __init__(self, conn):
        self.conn = conn

    def begin(self):
        return _FakeBegin(self.conn)


def test_ensure_message_schema_compatibility_executes_idempotent_sql(monkeypatch):
    conn = _FakeConn()
    monkeypatch.setattr("app.migrations.engine", _FakeEngine(conn))

    ensure_message_schema_compatibility()

    assert conn.calls == [MESSAGE_SCHEMA_COMPATIBILITY_SQL]


def test_ensure_drive_schema_compatibility_executes_idempotent_sql(monkeypatch):
    conn = _FakeConn()
    monkeypatch.setattr("app.migrations.engine", _FakeEngine(conn))

    ensure_drive_schema_compatibility()

    assert conn.calls == [DRIVE_SCHEMA_COMPATIBILITY_SQL]
