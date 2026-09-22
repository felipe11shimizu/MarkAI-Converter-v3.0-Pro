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
    assert body["url_engine"]["enabled"] is True
    assert body["url_engine"]["youtube"] is True


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



def test_youtube_url_uses_markitdown(monkeypatch):
    class FakeResult:
        markdown = "# Vídeo\n\nTranscrição de teste."

    calls = []

    def fake_convert(url):
        calls.append(url)
        return FakeResult()

    monkeypatch.setattr(api._engine, "convert", fake_convert)
    response = client.post(
        "/api/convert-url",
        json={"url": "https://www.youtube.com/watch?v=abc123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["engine"] == "markitdown-youtube"
    assert "Transcrição de teste" in body["markdown"]
    assert calls == ["https://www.youtube.com/watch?v=abc123"]


def test_convert_url_rejects_non_youtube():
    response = client.post(
        "/api/convert-url",
        json={"url": "https://example.com/video"},
    )
    assert response.status_code == 403


def test_convert_batch(monkeypatch):
    class FakeResult:
        markdown = "# Documento\n\nConteúdo"

    monkeypatch.setattr(api._engine, "convert_local", lambda path: FakeResult())
    response = client.post(
        "/api/convert-batch",
        files=[
            ("files", ("a.txt", b"a", "text/plain")),
            ("files", ("b.txt", b"b", "text/plain")),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["successful"] == 2
    assert body["failed"] == 0


def test_remote_url_uses_markitdown_local_conversion(monkeypatch):
    class FakeResult:
        markdown = "# Página\n\nConteúdo remoto"

    def fake_fetch(url):
        return url, "<html><body><h1>Página</h1><p>Conteúdo remoto</p></body></html>".encode("utf-8"), "text/html"

    monkeypatch.setattr(api, "_fetch_remote_url", fake_fetch)
    monkeypatch.setattr(api._engine, "convert_local", lambda path: FakeResult())

    response = client.post(
        "/api/convert-url",
        json={"url": "https://example.com/article"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["engine"] == "markitdown-url"
    assert body["final_url"] == "https://example.com/article"
    assert "Conteúdo remoto" in body["markdown"]


def test_remote_url_rejects_private_host(monkeypatch):
    def fake_dns(*args, **kwargs):
        return [(None, None, None, None, ("127.0.0.1", 0))]

    monkeypatch.setattr(api.socket, "getaddrinfo", fake_dns)
    response = client.post(
        "/api/convert-url",
        json={"url": "http://internal.example/article"},
    )

    assert response.status_code == 403
