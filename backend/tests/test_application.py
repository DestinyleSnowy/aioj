from app.application import create_app


def test_create_app_registers_core_routes():
    app = create_app()
    paths = {route.path for route in app.routes}

    assert "/health" in paths
    assert "/api/auth/login" in paths
    assert "/api/admin/problems/import" in paths
    assert "/api/internal/judge/claim" in paths
    assert "/api/contests/{slug}/scoreboard-advanced" in paths
