import os
import time

import pytest
from fastapi import HTTPException

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
