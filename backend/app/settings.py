from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

DEFAULT_CORS_ALLOWED_ORIGINS = [
    "https://chat.yxyx.space",
    "http://127.0.0.1",
    "http://localhost",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    postgres_user: str = "aioj"
    postgres_password: str = "aioj"
    postgres_db: str = "aioj"

    redis_url: str = ""
    redis_password: str = "aioj"

    s3_endpoint: str = "http://minio:9000"
    s3_public_endpoint: str = "http://127.0.0.1:9000"
    s3_access_key: str = "aiojadmin"
    s3_secret_key: str = "aiojpassword"
    s3_bucket_problems: str = "aioj-problems"
    s3_bucket_submissions: str = "aioj-submissions"
    s3_bucket_logs: str = "aioj-logs"
    s3_bucket_messages: str = "aioj-messages"
    s3_bucket_avatars: str = "aioj-avatars"

    internal_api_token: str = ""
    jwt_secret: str = ""
    jwt_exp_seconds: int = 604800
    cors_allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: DEFAULT_CORS_ALLOWED_ORIGINS.copy()
    )

    admin_username: str = "admin"
    admin_email: str = "admin@example.com"
    admin_password: str = ""
    bootstrap_admin_on_startup: bool = True
    allow_insecure_admin_password: bool = False
    run_migrations_on_startup: bool = True

    max_source_zip_mb: int = 20
    max_source_files: int = 50
    max_source_uncompressed_mb: int = 50
    max_problem_zip_mb: int = 512
    max_problem_files: int = 2000
    max_problem_uncompressed_mb: int = 2048

    stale_job_minutes: int = 15
    max_job_attempts: int = 3
    judge_node_offline_seconds: int = 90
    judge_heartbeat_interval_seconds: int = 15
    judge_node_name: str = "local-worker"

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, value):
        if value is None:
            return DEFAULT_CORS_ALLOWED_ORIGINS.copy()
        if isinstance(value, str):
            items = [item.strip() for item in value.split(",") if item.strip()]
            return items or DEFAULT_CORS_ALLOWED_ORIGINS.copy()
        return value

    @model_validator(mode="after")
    def populate_derived_urls(self):
        if not self.database_url:
            self.database_url = (
                f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
                f"@postgres:5432/{self.postgres_db}"
            )
        if not self.redis_url:
            self.redis_url = f"redis://:{self.redis_password}@redis:6379/0"
        return self

    @property
    def max_source_zip_bytes(self) -> int:
        return self.max_source_zip_mb * 1024 * 1024

    @property
    def max_source_uncompressed_bytes(self) -> int:
        return self.max_source_uncompressed_mb * 1024 * 1024

    @property
    def max_problem_zip_bytes(self) -> int:
        return self.max_problem_zip_mb * 1024 * 1024

    @property
    def max_problem_uncompressed_bytes(self) -> int:
        return self.max_problem_uncompressed_mb * 1024 * 1024


settings = Settings()
