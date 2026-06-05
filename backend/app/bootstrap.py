from types import SimpleNamespace

from app.security import hash_password
from app.settings import settings
from sqlalchemy import text

INSECURE_ADMIN_PASSWORDS = {
    "",
    "admin",
    "adminadmin",
    "password",
    "changeme",
    "123456",
}

def find_runtime_configuration_errors(settings_obj=settings) -> list[str]:
    errors: list[str] = []

    if not settings_obj.jwt_secret.strip():
        errors.append("JWT_SECRET must be configured")
    if not settings_obj.internal_api_token.strip():
        errors.append("INTERNAL_API_TOKEN must be configured")
    if settings_obj.jwt_secret and settings_obj.jwt_secret == settings_obj.s3_secret_key:
        errors.append("JWT_SECRET must not reuse the S3 secret")
    if settings_obj.internal_api_token and settings_obj.internal_api_token in {
        settings_obj.jwt_secret,
        settings_obj.s3_secret_key,
    }:
        errors.append("INTERNAL_API_TOKEN must not reuse another application secret")
    if settings_obj.bootstrap_admin_on_startup:
        admin_email = settings_obj.admin_email.strip()
        admin_password = settings_obj.admin_password.strip()
        if not admin_email:
            errors.append("ADMIN_EMAIL must be configured when bootstrap_admin_on_startup is enabled")
        elif len(admin_email) > 254 or "@" not in admin_email:
            errors.append("ADMIN_EMAIL must be a valid email address")
        if not admin_password:
            errors.append("ADMIN_PASSWORD must be configured when bootstrap_admin_on_startup is enabled")
        if (
            admin_password.lower() in INSECURE_ADMIN_PASSWORDS
            and not settings_obj.allow_insecure_admin_password
        ):
            errors.append("ADMIN_PASSWORD is too weak; choose a non-default password")

    return errors


def validate_runtime_configuration(settings_obj=settings) -> None:
    errors = find_runtime_configuration_errors(settings_obj)
    if errors:
        raise RuntimeError("; ".join(errors))


def ensure_admin() -> None:
    from app.db import engine

    with engine.begin() as conn:
        row = conn.execute(
            text("select id, email from users where username = :username"),
            {"username": settings.admin_username},
        ).mappings().first()

        if row:
            conn.execute(
                text(
                    """
                    update users
                    set role = 'ADMIN',
                        email = case
                          when email is null or length(btrim(email)) = 0 then :email
                          else email
                        end
                    where username = :username
                    """
                ),
                {"username": settings.admin_username, "email": settings.admin_email},
            )
            return

        conn.execute(
            text(
                """
                insert into users(username, email, password_hash, role, is_disabled)
                values (:username, :email, :password_hash, 'ADMIN', false)
                """
            ),
            {
                "username": settings.admin_username,
                "email": settings.admin_email,
                "password_hash": hash_password(settings.admin_password),
            },
        )


def build_settings_for_test(**overrides):
    base = {
        "jwt_secret": "test-jwt-secret",
        "internal_api_token": "test-internal-token",
        "s3_secret_key": "test-s3-secret",
        "admin_email": "admin@example.com",
        "admin_password": "a-strong-admin-password",
        "bootstrap_admin_on_startup": True,
        "allow_insecure_admin_password": False,
        "run_migrations_on_startup": True,
    }
    base.update(overrides)
    return SimpleNamespace(**base)
