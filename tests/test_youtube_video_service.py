from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.youtube_video_service import YouTubeVideoService, YouTubeVideoServiceError


def test_visual_service_disabled_by_default(monkeypatch):
    service = YouTubeVideoService(enabled=False)
    with pytest.raises(YouTubeVideoServiceError) as exc:
        service.download("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert exc.value.code == "YOUTUBE_VISUAL_DISABLED"


def test_visual_service_downloads_bounded_video(monkeypatch):
    service = YouTubeVideoService(
        enabled=True,
        max_mb=20,
        max_duration_seconds=600,
        max_height=360,
    )

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            assert url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            assert download is False
            assert self.options["noplaylist"] is True
            return {
                "title": "Processo de teste",
                "channel": "Canal",
                "duration": 120,
                "width": 640,
                "height": 360,
            }

        def download(self, urls):
            output_template = self.options["outtmpl"]
            target = Path(output_template.replace("%(ext)s", "mp4"))
            target.write_bytes(b"fake-video")

    fake_module = SimpleNamespace(YoutubeDL=FakeYoutubeDL)
    monkeypatch.setattr(service, "_import_yt_dlp", lambda: fake_module)

    result = service.download("https://youtu.be/dQw4w9WgXcQ")

    assert result["video_id"] == "dQw4w9WgXcQ"
    assert result["title"] == "Processo de teste"
    assert result["duration_seconds"] == 120
    assert result["filesize_bytes"] == len(b"fake-video")
    assert result["data"] == b"fake-video"


def test_visual_service_rejects_long_video(monkeypatch):
    service = YouTubeVideoService(enabled=True, max_duration_seconds=60)

    class FakeYoutubeDL:
        def __init__(self, options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            return {"duration": 61}

    fake_module = SimpleNamespace(YoutubeDL=FakeYoutubeDL)
    monkeypatch.setattr(service, "_import_yt_dlp", lambda: fake_module)

    with pytest.raises(YouTubeVideoServiceError) as exc:
        service.download("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    assert exc.value.code == "YOUTUBE_VIDEO_TOO_LONG"
