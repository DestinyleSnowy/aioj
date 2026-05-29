from app.bootstrap import build_settings_for_test, find_runtime_configuration_errors


def test_find_runtime_configuration_errors_flags_missing_or_reused_secrets():
    settings_obj = build_settings_for_test(
        jwt_secret="shared-secret",
        internal_api_token="shared-secret",
        s3_secret_key="shared-secret",
        admin_password="adminadmin",
    )

    errors = find_runtime_configuration_errors(settings_obj)

    assert any("JWT_SECRET must not reuse the S3 secret" in error for error in errors)
    assert any("INTERNAL_API_TOKEN must not reuse another application secret" in error for error in errors)
    assert any("ADMIN_PASSWORD is too weak" in error for error in errors)


def test_find_runtime_configuration_errors_accepts_strong_configuration():
    settings_obj = build_settings_for_test(
        jwt_secret="jwt-secret",
        internal_api_token="internal-token",
        s3_secret_key="s3-secret",
        admin_password="a-very-strong-admin-password",
    )

    assert find_runtime_configuration_errors(settings_obj) == []
