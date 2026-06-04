from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_caddy_allows_same_origin_frames_for_statement_pdfs():
    config = (ROOT / "caddy" / "Caddyfile").read_text()

    assert "X-Frame-Options SAMEORIGIN" in config
    assert "X-Frame-Options DENY" not in config
