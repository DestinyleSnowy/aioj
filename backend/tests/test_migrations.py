from app.migrations import alembic_ini_path, alembic_script_location, build_alembic_config


def test_build_alembic_config_uses_project_paths_and_override_url():
    config = build_alembic_config("postgresql+psycopg://user:pass@host:5432/dbname")

    assert config.get_main_option("sqlalchemy.url") == "postgresql+psycopg://user:pass@host:5432/dbname"
    assert config.get_main_option("script_location") == str(alembic_script_location().resolve())
    assert config.config_file_name == str(alembic_ini_path())
