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
    assert "visual_analysis" in body["youtube"]


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



def test_youtube_url_uses_transcript_service(monkeypatch):
    monkeypatch.setattr(
        api._youtube_service,
        "transcribe_url",
        lambda url, languages=None: {
            "provider": "youtube-transcript-api",
            "video_id": "abc123",
            "canonical_url": url,
            "markdown": "# Vídeo\n\nTranscrição de teste.",
            "quality": {"segments": 1},
            "language": "Português",
            "language_code": "pt",
            "is_generated": True,
            "segments": [{"index": 1, "start": 0, "duration": 1, "end": 1, "text": "Transcrição de teste."}],
        },
    )

    response = client.post(
        "/api/convert-url",
        json={"url": "https://www.youtube.com/watch?v=abc123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["engine"] == "youtube-transcript-api"
    assert "Transcrição de teste" in body["markdown"]


def test_youtube_transcribe_endpoint(monkeypatch):
    monkeypatch.setattr(
        api._youtube_service,
        "transcribe_url",
        lambda url, **kwargs: {
            "provider": "youtube-transcript-api",
            "video_id": "dQw4w9WgXcQ",
            "url": url,
            "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "source_type": "video",
            "language": "Português",
            "language_code": "pt",
            "is_generated": True,
            "translated": False,
            "translation_language": None,
            "segments": [{"index": 1, "start": 0, "duration": 1, "end": 1, "text": "Olá"}],
            "quality": {"segments": 1, "characters": 3, "words": 1},
            "markdown": "# Transcrição do YouTube\n\nOlá",
        },
    )
    response = client.post(
        "/api/youtube/transcribe",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "languages": ["pt", "en"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["engine"] == "youtube-transcript-api"
    assert body["video_id"] == "dQw4w9WgXcQ"
    assert body["language_code"] == "pt"



def test_youtube_analyze_endpoint(monkeypatch):
    monkeypatch.setattr(
        api._youtube_service,
        "transcribe_url",
        lambda url, **kwargs: {
            "provider": "youtube-transcript-api",
            "video_id": "dQw4w9WgXcQ",
            "url": url,
            "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "source_type": "video",
            "language": "Português",
            "language_code": "pt",
            "is_generated": True,
            "translated": False,
            "segments": [
                {"index": 1, "start": 0, "duration": 2, "end": 2, "text": "Abra o sistema."}
            ],
            "quality": {"segments": 1, "characters": 18, "words": 3},
        },
    )
    monkeypatch.setattr(
        api._youtube_video_service,
        "download",
        lambda url: {
            "video_id": "dQw4w9WgXcQ",
            "url": url,
            "canonical_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "source_type": "video",
            "title": "Processo",
            "channel": "Canal",
            "duration_seconds": 120,
            "filesize_bytes": 10,
            "filename": "dQw4w9WgXcQ.mp4",
            "data": b"video",
        },
    )
    monkeypatch.setattr(
        api,
        "_analyze_video_file",
        lambda filename, data, task_prompt="", transcript_override=None, transcript_segments=None, source=None: {
            "ok": True,
            "engine": "video-task-analyzer",
            "filename": filename,
            "analysis": {
                "objetivo": "Processo",
                "timeline": [{"frame_index": 1, "timestamp": 0, "transcript_segment_indices": [1]}],
            },
            "transcript": transcript_override or "",
            "transcript_segments": transcript_segments or [],
            "timeline": [{"frame_index": 1, "timestamp": 0, "transcript_segment_indices": [1]}],
            "frames_analyzed": 1,
            "frame_interval_seconds": 5,
            "source": {"type": "youtube"},
        },
    )

    response = client.post(
        "/api/youtube/analyze",
        json={
            "url": "https://youtu.be/dQw4w9WgXcQ",
            "languages": ["pt"],
            "task_prompt": "Identifique as ações de tela.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["engine"] == "video-task-analyzer"
    assert body["source"]["type"] == "youtube"
    assert body["transcript_metadata"]["language_code"] == "pt"
    assert body["timeline"][0]["transcript_segment_indices"] == [1]


def test_youtube_transcripts_endpoint(monkeypatch):
    monkeypatch.setattr(
        api._youtube_service,
        "list_transcripts",
        lambda video_id: {
            "video_id": video_id,
            "count": 2,
            "transcripts": [
                {"language": "Português", "language_code": "pt", "is_generated": True, "is_translatable": True, "translation_languages": []},
                {"language": "English", "language_code": "en", "is_generated": False, "is_translatable": False, "translation_languages": []},
            ],
        },
    )
    response = client.post(
        "/api/youtube/transcripts",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert body["video_id"] == "dQw4w9WgXcQ"


def test_convert_url_rejects_unsupported_scheme():
    response = client.post(
        "/api/convert-url",
        json={"url": "file:///etc/passwd"},
    )
    assert response.status_code == 400


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


def test_remote_url_rejects_embedded_credentials():
    response = client.post(
        "/api/convert-url",
        json={"url": "https://user:pass@example.com/article"},
    )
    assert response.status_code == 400


def test_remote_url_rejects_private_redirect(monkeypatch):
    def fake_validate(hostname):
        if hostname == "127.0.0.1":
            raise api.HTTPException(
                status_code=403,
                detail="private host blocked",
            )

    monkeypatch.setattr(api, "_validate_public_host", fake_validate)

    class FakeResponse:
        status_code = 302
        headers = {"location": "http://127.0.0.1/private"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(api.httpx, "Client", lambda *args, **kwargs: FakeClient())
    response = client.post(
        "/api/convert-url",
        json={"url": "https://example.com/redirect"},
    )
    assert response.status_code == 403


def test_remote_url_stream_limit(monkeypatch):
    monkeypatch.setattr(api, "MAX_URL_BYTES", 3)
    monkeypatch.setattr(api, "_validate_public_host", lambda hostname: None)

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/plain"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def iter_bytes(self):
            yield b"ab"
            yield b"cd"

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(api.httpx, "Client", lambda *args, **kwargs: FakeClient())
    response = client.post(
        "/api/convert-url",
        json={"url": "https://example.com/large"},
    )
    assert response.status_code == 413


def test_remote_url_content_length_limit(monkeypatch):
    monkeypatch.setattr(api, "MAX_URL_BYTES", 3)
    monkeypatch.setattr(api, "_validate_public_host", lambda hostname: None)

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/plain", "content-length": "4"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def iter_bytes(self):
            raise AssertionError("body must not be consumed when Content-Length exceeds the limit")

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(api.httpx, "Client", lambda *args, **kwargs: FakeClient())
    response = client.post(
        "/api/convert-url",
        json={"url": "https://example.com/large"},
    )
    assert response.status_code == 413


def test_batch_reports_invalid_file_without_aborting(monkeypatch):
    class FakeResult:
        markdown = "# Documento"

    monkeypatch.setattr(api._engine, "convert_local", lambda path: FakeResult())
    response = client.post(
        "/api/convert-batch",
        files=[
            ("files", ("ok.txt", b"ok", "text/plain")),
            ("files", ("bad.exe", b"MZ", "application/octet-stream")),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["successful"] == 1
    assert body["failed"] == 1
    assert body["results"][1]["status_code"] == 415


def test_video_analysis_endpoint_accepts_supported_video(monkeypatch):
    monkeypatch.setattr(
        api,
        "_analyze_video_file",
        lambda filename, data, task_prompt="", **kwargs: {
            "ok": True,
            "engine": "video-task-analyzer",
            "filename": filename,
            "analysis": {"objetivo": "Teste", "etapas": []},
            "transcript": "",
            "frames_analyzed": 1,
            "frame_interval_seconds": 5,
        },
    )
    response = client.post(
        "/api/analyze-video",
        files={"file": ("demo.mp4", b"fake-video", "video/mp4")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["engine"] == "video-task-analyzer"
    assert body["filename"] == "demo.mp4"


def test_video_analysis_endpoint_rejects_unsupported_extension():
    response = client.post(
        "/api/analyze-video",
        files={"file": ("demo.pdf", b"fake", "application/pdf")},
    )
    assert response.status_code == 415


def test_youtube_analyze_preserves_visual_error_after_transcript_failure(monkeypatch):
    monkeypatch.setattr(
        api._youtube_service,
        "transcribe_url",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            api.YouTubeServiceError("YOUTUBE_TRANSCRIPT_NOT_FOUND", "sem legenda")
        ),
    )
    monkeypatch.setattr(
        api._youtube_video_service,
        "download",
        lambda url: (_ for _ in ()).throw(
            api.YouTubeVideoServiceError("YOUTUBE_VISUAL_DISABLED", "desativado")
        ),
    )

    response = client.post(
        "/api/youtube/analyze",
        json={"url": "https://youtu.be/dQw4w9WgXcQ"},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "YOUTUBE_VISUAL_DISABLED"


def test_remote_url_redirect_limit(monkeypatch):
    monkeypatch.setattr(api, "URL_MAX_REDIRECTS", 1)
    monkeypatch.setattr(api, "_validate_public_host", lambda hostname: None)

    class FakeResponse:
        status_code = 302
        headers = {"location": "https://example.com/next"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def stream(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(api.httpx, "Client", lambda *args, **kwargs: FakeClient())
    response = client.post(
        "/api/convert-url",
        json={"url": "https://example.com/start"},
    )
    assert response.status_code == 310
