from fastapi.testclient import TestClient

import backend.app as api

client = TestClient(api.app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["engine"] == "markitdown"
    assert "ocr" in body


def test_missing_extension():
    response = client.post(
        "/api/convert",
        files={"file": ("document", b"hello", "text/plain")},
    )
    assert response.status_code == 400


def test_unsupported_extension():
    response = client.post(
        "/api/convert",
        files={"file": ("document.exe", b"MZ", "application/octet-stream")},
    )
    assert response.status_code == 415


def test_convert_uses_local_file(monkeypatch):
    class FakeResult:
        markdown = "# Documento\n\nConteúdo"

    calls = []

    def fake_convert_local(path):
        calls.append(path)
        return FakeResult()

    monkeypatch.setattr(api._engine, "convert_local", fake_convert_local)

    response = client.post(
        "/api/convert",
        files={"file": ("document.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["engine"] == "markitdown"
    assert body["quality"]["headings"] == 1
    assert len(calls) == 1


def test_upload_limit(monkeypatch):
    monkeypatch.setattr(api, "MAX_UPLOAD_BYTES", 3)

    response = client.post(
        "/api/convert",
        files={"file": ("document.txt", b"abcd", "text/plain")},
    )

    assert response.status_code == 413
