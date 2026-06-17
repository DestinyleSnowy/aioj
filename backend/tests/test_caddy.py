from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_caddy_allows_same_origin_frames_for_statement_pdfs():
    config = (ROOT / "caddy" / "Caddyfile").read_text()

    assert "X-Frame-Options SAMEORIGIN" in config
    assert "X-Frame-Options DENY" not in config


def test_caddy_separates_main_chat_and_drive_hosts():
    config = (ROOT / "caddy" / "Caddyfile").read_text()

    assert "yxyx.space, www.yxyx.space" in config
    assert "hello.yxyx.space" in config
    assert "drive.yxyx.space" in config
    assert "redir https://hello.yxyx.space{uri} 308" in config
    assert "redir https://drive.yxyx.space{uri} 308" in config
    assert "@legacy_messages path /messages /messages/*" in config
    assert "@legacy_drive path /drive /drive/*" in config
