from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from backend import app as backend_app
from backend.youtube_service import YouTubeServiceError, YouTubeTranscriptService


def test_health_contract_reports_operational_limits():
    payload = backend_app.health()

    assert payload["ok"] is True
    assert payload["version"] == backend_app.APP_VERSION
    assert payload["max_upload_mb"] == backend_app.MAX_UPLOAD_MB
    assert payload["url_engine"]["enabled"] is True
    assert payload["url_engine"]["max_mb"] == backend_app.MAX_URL_MB
    assert payload["url_engine"]["timeout_seconds"] == backend_app.URL_TIMEOUT_SECONDS
    assert payload["url_engine"]["max_redirects"] == backend_app.URL_MAX_REDIRECTS
    assert payload["youtube"]["enabled"] is True
    assert "visual_analysis" in payload["youtube"]


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("ftp://example.com/file.pdf", "http ou https"),
        ("https:///missing-host", "http ou https"),
    ],
)
def test_remote_url_rejects_invalid_scheme_or_host(url, message):
    with pytest.raises(HTTPException) as exc:
        backend_app._validate_url(url)

    assert exc.value.status_code == 400
    assert message in str(exc.value.detail)


def test_remote_url_rejects_private_host():
    with pytest.raises(HTTPException) as exc:
        backend_app._validate_url("http://127.0.0.1/internal")

    assert exc.value.status_code == 403
    assert "privados" in str(exc.value.detail)


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("documento.pdf", ("documento.pdf", ".pdf")),
        ("arquivo.PDF", ("arquivo.PDF", ".pdf")),
        ("pasta/../arquivo.md", ("arquivo.md", ".md")),
    ],
)
def test_upload_filename_contract(filename, expected):
    class Upload:
        def __init__(self, name):
            self.filename = name

    assert backend_app._read_upload(Upload(filename)) == expected


def test_upload_rejects_unsupported_extension():
    class Upload:
        filename = "malware.exe"

    with pytest.raises(HTTPException) as exc:
        backend_app._read_upload(Upload())

    assert exc.value.status_code == 415
    assert ".exe" in str(exc.value.detail)


def test_upload_rejects_missing_extension():
    class Upload:
        filename = "README"

    with pytest.raises(HTTPException) as exc:
        backend_app._read_upload(Upload())

    assert exc.value.status_code == 400


def test_conversion_enforces_upload_limit_before_engine(monkeypatch):
    called = False

    class Engine:
        def convert_local(self, _path):
            nonlocal called
            called = True
            raise AssertionError("engine must not be called")

    monkeypatch.setattr(backend_app, "_engine", Engine())
    monkeypatch.setattr(backend_app, "MAX_UPLOAD_BYTES", 3)

    with pytest.raises(HTTPException) as exc:
        backend_app._convert_bytes("arquivo.txt", ".txt", b"1234")

    assert exc.value.status_code == 413
    assert called is False


def test_conversion_cleans_temporary_file_and_returns_quality(monkeypatch):
    class Result:
        markdown = "# Título\n\nConteúdo"

    class Engine:
        def convert_local(self, path):
            assert path
            return Result()

    monkeypatch.setattr(backend_app, "_engine", Engine())
    result = backend_app._convert_bytes("arquivo.txt", ".txt", b"conteudo")

    assert result["ok"] is True
    assert result["engine"] == "markitdown"
    assert result["filename"] == "arquivo.txt"
    assert result["quality"]["headings"] == 1
    assert result["quality"]["characters"] > 0


def test_youtube_parser_rejects_non_youtube_source():
    with pytest.raises(YouTubeServiceError) as exc:
        YouTubeTranscriptService.parse_url("https://example.com/watch?v=abc")

    assert exc.value.code == "YOUTUBE_HOST_INVALID"


def test_youtube_parser_accepts_canonical_video_url():
    source = YouTubeTranscriptService.parse_url("https://youtu.be/dQw4w9WgXcQ")

    assert source.video_id == "dQw4w9WgXcQ"
    assert source.canonical_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert source.source_type == "video"


def test_youtube_resolve_endpoint_returns_stable_contract():
    payload = asyncio.run(
        backend_app.youtube_resolve({"url": "https://youtu.be/dQw4w9WgXcQ"})
    )

    assert payload["ok"] is True
    assert payload["engine"] == "youtube-router"
    assert payload["video_id"] == "dQw4w9WgXcQ"


def test_youtube_resolve_endpoint_maps_invalid_url():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            backend_app.youtube_resolve({"url": "https://example.com/video"})
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "YOUTUBE_HOST_INVALID"
