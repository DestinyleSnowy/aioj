from pathlib import Path

from app.settings import Settings


def test_settings_accept_comma_separated_cors_origins_from_env_file(tmp_path: Path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/dbname",
                "REDIS_URL=redis://:pass@localhost:6379/0",
                "S3_ENDPOINT=http://localhost:9000",
                "S3_ACCESS_KEY=test-key",
                "S3_SECRET_KEY=test-secret",
                "INTERNAL_API_TOKEN=test-internal",
                "JWT_SECRET=test-jwt",
                "ADMIN_PASSWORD=test-admin-password",
                "CORS_ALLOWED_ORIGINS=https://a.example, https://b.example ,http://localhost:8000",
            ]
        ),
        encoding="utf-8",
    )

    settings = Settings(_env_file=str(env_file))

    assert settings.cors_allowed_origins == [
        "https://a.example",
        "https://b.example",
        "http://localhost:8000",
    ]
