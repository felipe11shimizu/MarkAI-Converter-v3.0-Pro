from types import SimpleNamespace

import pytest

from backend.youtube_service import YouTubeServiceError, YouTubeTranscriptService


def test_parse_watch_url():
    source = YouTubeTranscriptService.parse_url(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s"
    )

    assert source.video_id == "dQw4w9WgXcQ"
    assert source.source_type == "video"
    assert source.canonical_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.mark.parametrize(
    ("url", "source_type"),
    [
        ("https://youtu.be/dQw4w9WgXcQ", "video"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "short"),
        ("https://www.youtube.com/live/dQw4w9WgXcQ", "live"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "embed"),
    ],
)
def test_parse_youtube_url_variants(url, source_type):
    source = YouTubeTranscriptService.parse_url(url)
    assert source.video_id == "dQw4w9WgXcQ"
    assert source.source_type == source_type


def test_parse_rejects_non_youtube_url():
    with pytest.raises(YouTubeServiceError) as exc:
        YouTubeTranscriptService.parse_url("https://example.com/watch?v=dQw4w9WgXcQ")
    assert exc.value.code == "YOUTUBE_HOST_INVALID"


def test_parse_rejects_invalid_video_id():
    with pytest.raises(YouTubeServiceError) as exc:
        YouTubeTranscriptService.parse_url("https://www.youtube.com/watch?v=short")
    assert exc.value.code == "YOUTUBE_VIDEO_ID_INVALID"


def test_normalize_segments_and_quality():
    fetched = SimpleNamespace(
        to_raw_data=lambda: [
            {"text": " Olá  mundo ", "start": 0, "duration": 1.5},
            {"text": "", "start": 1.5, "duration": 0},
            {"text": "Segundo trecho", "start": 1, "duration": 2},
        ]
    )

    segments = YouTubeTranscriptService._normalize_segments(fetched)
    quality = YouTubeTranscriptService.quality_metrics(segments)

    assert segments[0]["text"] == "Olá mundo"
    assert segments[0]["end"] == 1.5
    assert len(segments) == 2
    assert quality["characters"] == len("Olá mundo Segundo trecho")
    assert quality["overlaps"] == 1


def test_transcribe_uses_requested_language_and_builds_markdown(monkeypatch):
    service = YouTubeTranscriptService(cache_ttl_seconds=900)

    class FakeTranscript:
        language = "Português"
        language_code = "pt"
        is_generated = True
        is_translatable = True
        translation_languages = [SimpleNamespace(language="English", language_code="en")]

        def translate(self, language_code):
            assert language_code == "en"
            return SimpleNamespace(
                language="English",
                language_code="en",
                is_generated=True,
                fetch=lambda preserve_formatting=False: SimpleNamespace(
                    language="English",
                    language_code="en",
                    is_generated=True,
                    to_raw_data=lambda: [
                        {"text": "Hello", "start": 0, "duration": 1.2},
                    ],
                ),
            )

        def fetch(self, preserve_formatting=False):
            return SimpleNamespace(
                language=self.language,
                language_code=self.language_code,
                is_generated=self.is_generated,
                to_raw_data=lambda: [
                    {"text": "Olá", "start": 0, "duration": 1.2},
                ],
            )

    class FakeTranscriptList:
        def find_transcript(self, languages):
            assert languages == ["pt", "en"]
            return FakeTranscript()

    class FakeApi:
        def list(self, video_id):
            assert video_id == "dQw4w9WgXcQ"
            return FakeTranscriptList()

    monkeypatch.setattr(
        service,
        "_build_provider",
        lambda: (FakeApi(), {"unused": Exception}),
    )

    result = service.fetch_transcript(
        "dQw4w9WgXcQ",
        languages=["pt", "en"],
    )

    assert result["language_code"] == "pt"
    assert result["is_generated"] is True
    assert result["quality"]["segments"] == 1
    assert "00:00:00" in result["markdown"]
    assert "Olá" in result["markdown"]


def test_transcribe_url_adds_source_metadata(monkeypatch):
    service = YouTubeTranscriptService(cache_ttl_seconds=0)
    monkeypatch.setattr(
        service,
        "fetch_transcript",
        lambda *args, **kwargs: {
            "provider": "youtube-transcript-api",
            "video_id": "dQw4w9WgXcQ",
            "language": "Português",
            "language_code": "pt",
            "segments": [],
            "quality": {},
            "markdown": "# Transcrição",
        },
    )

    result = service.transcribe_url("https://youtu.be/dQw4w9WgXcQ")
    assert result["canonical_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert result["source_type"] == "video"


def test_cache_returns_hit_without_second_provider_call(monkeypatch):
    service = YouTubeTranscriptService(cache_ttl_seconds=900)
    calls = {"count": 0}

    class FakeTranscript:
        language = "Português"
        language_code = "pt"
        is_generated = False
        is_translatable = False
        translation_languages = []

        def fetch(self, preserve_formatting=False):
            return SimpleNamespace(
                language="Português",
                language_code="pt",
                is_generated=False,
                to_raw_data=lambda: [{"text": "Olá", "start": 0, "duration": 1}],
            )

    class FakeTranscriptList:
        def find_transcript(self, languages):
            return FakeTranscript()

    class FakeApi:
        def list(self, video_id):
            calls["count"] += 1
            return FakeTranscriptList()

    monkeypatch.setattr(
        service,
        "_build_provider",
        lambda: (FakeApi(), {"unused": Exception}),
    )

    first = service.fetch_transcript("dQw4w9WgXcQ", languages=["pt"])
    second = service.fetch_transcript("dQw4w9WgXcQ", languages=["pt"])

    assert first["cache"] == "miss"
    assert second["cache"] == "hit"
    assert calls["count"] == 1
