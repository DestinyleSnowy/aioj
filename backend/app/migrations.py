from pathlib import Path

from alembic import command
from alembic.config import Config

from app.settings import settings


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def alembic_ini_path() -> Path:
    return backend_dir() / "alembic.ini"


def alembic_script_location() -> Path:
    return backend_dir() / "alembic"


def build_alembic_config(database_url: str | None = None) -> Config:
    config = Config(str(alembic_ini_path()))
    config.set_main_option("script_location", str(alembic_script_location().resolve()))
    config.set_main_option("prepend_sys_path", str(backend_dir().resolve()))
    config.set_main_option("sqlalchemy.url", database_url or settings.database_url)
    return config


def run_migrations(*, database_url: str | None = None, revision: str = "head") -> None:
    command.upgrade(build_alembic_config(database_url), revision)
