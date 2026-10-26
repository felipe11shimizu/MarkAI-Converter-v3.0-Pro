import os
import time

import pytest
from fastapi import HTTPException
from fastapi.responses import RedirectResponse

from backend import jarvis_bridge as bridge


def test_slug_rejects_empty_title():
    with pytest.raises(HTTPException) as exc:
        bridge._slug("🔥")
    assert exc.value.status_code == 422


def test_slug_normalizes_title():
    assert bridge._slug("Regras de Licenciamento / ELIC") == "regras-de-licenciamento-elic"


def test_session_token_round_trip(monkeypatch):
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setenv("JARVIS_ALLOWED_GITHUB_LOGIN", "felipe11shimizu")
    token = bridge._encode_session("felipe11shimizu")
    payload = bridge._decode_session(token)
    assert payload["login"] == "felipe11shimizu"
    assert payload["aud"] == "markai-jarvis"
    assert payload["exp"] > int(time.time())


def test_session_rejects_tampering(monkeypatch):
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setenv("JARVIS_ALLOWED_GITHUB_LOGIN", "felipe11shimizu")
    token = bridge._encode_session("felipe11shimizu")
    with pytest.raises(HTTPException) as exc:
        bridge._decode_session(token + "x")
    assert exc.value.status_code == 401


def test_session_rejects_wrong_github_user(monkeypatch):
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setenv("JARVIS_ALLOWED_GITHUB_LOGIN", "felipe11shimizu")
    token = bridge._encode_session("someone-else")
    with pytest.raises(HTTPException) as exc:
        bridge._decode_session(token)
    assert exc.value.status_code == 401


def test_allowed_categories_are_fixed():
    assert bridge.ALLOWED_CATEGORIES["inbox"] == "00-Inbox"
    assert "90-Indices-Globais" not in bridge.ALLOWED_CATEGORIES.values()
    assert bridge.TARGET_REPO == "felipe11shimizu/jarvis-segundo-cerebro"


def test_sensitive_redirect_headers_prevent_caching_and_referrer_leaks():
    response = RedirectResponse("https://example.test/#session=synthetic-token", status_code=302)
    secured = bridge._apply_sensitive_redirect_headers(response)
    assert secured.headers["cache-control"] == "no-store"
    assert secured.headers["pragma"] == "no-cache"
    assert secured.headers["referrer-policy"] == "no-referrer"
    assert secured.headers["x-content-type-options"] == "nosniff"


def test_preview_requires_valid_session(monkeypatch):
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    with pytest.raises(HTTPException) as exc:
        bridge.preview_note(bridge.NoteDraft(title="Regra", category="inbox", content="# Regra"), authorization=None)
    assert exc.value.status_code == 401


def test_preview_rejects_unapproved_category(monkeypatch):
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setenv("JARVIS_ALLOWED_GITHUB_LOGIN", "felipe11shimizu")
    token = bridge._encode_session("felipe11shimizu")
    with pytest.raises(HTTPException) as exc:
        bridge.preview_note(bridge.NoteDraft(title="Regra", category="../../", content="# Regra"), authorization="Bearer " + token)
    assert exc.value.status_code == 422


def test_publish_rejects_oversized_utf8_content(monkeypatch):
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setenv("JARVIS_ALLOWED_GITHUB_LOGIN", "felipe11shimizu")
    monkeypatch.setenv("JARVIS_GITHUB_TOKEN", "server-side-test-token")
    monkeypatch.setattr(bridge, "MAX_MARKDOWN_BYTES", 10)
    token = bridge._encode_session("felipe11shimizu")
    note = bridge.NotePublish(title="Regra", category="inbox", content="á" * 6, confirm_publish=True)
    with pytest.raises(HTTPException) as exc:
        bridge.publish_note(note, authorization="Bearer " + token)
    assert exc.value.status_code == 413


def test_publish_refuses_existing_note_without_overwrite(monkeypatch):
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setenv("JARVIS_ALLOWED_GITHUB_LOGIN", "felipe11shimizu")
    monkeypatch.setenv("JARVIS_GITHUB_TOKEN", "server-side-test-token")
    token = bridge._encode_session("felipe11shimizu")

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, **kwargs):
            self.put_called = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url):
            assert "felipe11shimizu/jarvis-segundo-cerebro" in url
            return FakeResponse()

        def put(self, url, json):
            self.put_called = True
            raise AssertionError("Não deve tentar sobrescrever uma nota existente.")

    fake = FakeClient()
    monkeypatch.setattr(bridge.httpx, "Client", lambda **kwargs: fake)
    note = bridge.NotePublish(title="Regra existente", category="inbox", content="# Conteúdo", confirm_publish=True)
    with pytest.raises(HTTPException) as exc:
        bridge.publish_note(note, authorization="Bearer " + token)
    assert exc.value.status_code == 409
    assert fake.put_called is False


def test_bridge_status_reports_readiness_without_secrets(monkeypatch):
    monkeypatch.setenv("JARVIS_GITHUB_OAUTH_CLIENT_ID", "public-client-id")
    monkeypatch.setenv("JARVIS_GITHUB_OAUTH_CLIENT_SECRET", "oauth-secret")
    monkeypatch.setenv("JARVIS_SESSION_SECRET", "test-secret-with-at-least-32-characters")
    monkeypatch.setenv("JARVIS_GITHUB_OAUTH_CALLBACK_URL", "https://backend.example/api/jarvis/auth/callback")
    monkeypatch.setenv("JARVIS_GITHUB_TOKEN", "write-token")
    status = bridge.bridge_status()
    assert status["ok"] is True
    assert status["repository"] == "felipe11shimizu/jarvis-segundo-cerebro"
    assert status["authentication_configured"] is True
    assert status["publishing_configured"] is True
    assert status["requires_user_confirmation"] is True
    assert status["max_markdown_bytes"] == bridge.MAX_MARKDOWN_BYTES
    assert "oauth-secret" not in repr(status)
    assert "write-token" not in repr(status)


def test_bridge_status_reports_missing_configuration_without_revealing_values(monkeypatch):
    for key in (
        "JARVIS_GITHUB_OAUTH_CLIENT_ID",
        "JARVIS_GITHUB_OAUTH_CLIENT_SECRET",
        "JARVIS_SESSION_SECRET",
        "JARVIS_GITHUB_OAUTH_CALLBACK_URL",
        "JARVIS_GITHUB_TOKEN",
    ):
        monkeypatch.delenv(key, raising=False)
    status = bridge.bridge_status()
    assert status["authentication_configured"] is False
    assert status["publishing_configured"] is False
