from app.application import create_app


def test_create_app_registers_core_routes():
    app = create_app()
    paths = {route.path for route in app.routes}

    assert "/health" in paths
    assert "/api/auth/login" in paths
    assert "/api/problems/{slug}/resources" in paths
    assert "/api/problems/{slug}/resource-files/{asset_path:path}" in paths
    assert "/api/problems/{slug}/statement-pdfs/{asset_id}" in paths
    assert "/api/submissions/{submission_id}/cancel" in paths
    assert "/api/submissions/{submission_id}/source" in paths
    assert "/api/admin/problems/import" in paths
    assert "/api/admin/problems/{slug}/editor" in paths
    assert "/api/admin/problems/{slug}/draft" in paths
    assert "/api/admin/problems/{slug}/meta" in paths
    assert "/api/admin/problems/{slug}/versions/{version_id}/statement-markdowns/{asset_id}" in paths
    assert "/api/admin/problems/{slug}/versions/{version_id}/statement-pdfs" in paths
    assert "/api/admin/problems/{slug}/versions/{version_id}/statement-assets/{kind}/{asset_id}" in paths
    assert "/api/admin/audit-logs" in paths
    assert "/api/admin/problems/{slug}/versions" in paths
    assert "/api/admin/judge/overview" in paths
    assert "/api/internal/judge/claim" in paths
    assert "/api/internal/judge/heartbeat" in paths
    assert "/api/contests/{slug}/scoreboard-advanced" in paths
    assert "/api/notifications" in paths
    assert "/api/messages/conversations" in paths
    assert "/api/messages/unread-count" in paths
    assert "/api/messages/files" in paths
    assert "/api/messages/images" in paths
    assert "/api/messages/groups" in paths
    assert "/api/messages/groups/{group_id}" in paths
    assert "/api/messages/groups/{group_id}/messages" in paths
    assert "/api/messages/groups/{group_id}/files" in paths
    assert "/api/messages/groups/{group_id}/read" in paths
    assert "/api/messages/group-messages/{message_id}/attachment" in paths
    assert "/api/messages/{message_id}/attachment" in paths
    assert "/api/messages/{message_id}/image" in paths
