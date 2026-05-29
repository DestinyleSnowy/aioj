from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    redis_url: str

    s3_endpoint: str
    s3_public_endpoint: str = "http://127.0.0.1:9000"
    s3_access_key: str
    s3_secret_key: str
    s3_bucket_problems: str = "aioj-problems"
    s3_bucket_submissions: str = "aioj-submissions"
    s3_bucket_logs: str = "aioj-logs"

    internal_api_token: str
    jwt_secret: str
    jwt_exp_seconds: int = 604800

    admin_username: str = "admin"
    admin_email: str = "admin@example.com"
    admin_password: str

    max_source_zip_mb: int = 20
    max_source_files: int = 50
    max_source_uncompressed_mb: int = 50
    max_problem_zip_mb: int = 200

    stale_job_minutes: int = 15
    max_job_attempts: int = 3

    class Config:
        env_file = ".env"


settings = Settings()
