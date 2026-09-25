from fastapi.testclient import TestClient

import backend.app as api


client = TestClient(api.app)


def test_local_transcript_only_uses_separate_mode_and_skips_visual(monkeypatch):
    calls = {"transcribe": 0, "visual": 0}

    def fake_transcribe(path):
        calls["transcribe"] += 1
        return {
            "text": "Abra o sistema e selecione o cadastro.",
            "segments": [{"index": 1, "start": 0, "duration": 2, "end": 2, "text": "Abra o sistema e selecione o cadastro."}],
        }

    def fake_analyze(*args, **kwargs):
        return {
            "ok": True,
            "engine": "video-transcript-analyzer",
            "mode": "transcript_only",
            "analysis": {"etapas": [{"ordem": 1, "acao": "Abrir o sistema"}]},
            "transcript": args[0],
            "transcript_segments": args[1],
            "frames_analyzed": 0,
        }

    def visual_should_not_run(*args, **kwargs):
        calls["visual"] += 1
        raise AssertionError("visual analyzer must not run in transcript-only mode")

    monkeypatch.setattr(api, "_transcribe_video_file", fake_transcribe)
    monkeypatch.setattr(api, "_analyze_transcript_text", fake_analyze)
    monkeypatch.setattr(api, "_analyze_video_file", visual_should_not_run)
    monkeypatch.setattr(api, "VIDEO_TRANSCRIPT_MAX_BYTES", 1024)

    response = client.post(
        "/api/analyze-video",
        data={"analysis_mode": "transcript", "task_prompt": "Identifique as ações."},
        files={"file": ("large-enough.mp4", b"fake-video", "video/mp4")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "transcript_only"
    assert body["frames_analyzed"] == 0
    assert calls["transcribe"] == 1
    assert calls["visual"] == 0


def test_local_transcript_only_has_independent_upload_limit(monkeypatch):
    monkeypatch.setattr(api, "VIDEO_TRANSCRIPT_MAX_BYTES", 3)
    response = client.post(
        "/api/analyze-video",
        data={"analysis_mode": "transcript"},
        files={"file": ("large.mp4", b"abcd", "video/mp4")},
    )
    assert response.status_code == 413


def test_youtube_transcript_only_does_not_download_video(monkeypatch):
    monkeypatch.setattr(
        api._youtube_service,
        "transcribe_url",
        lambda url, **kwargs: {
            "provider": "youtube-transcript-api",
            "video_id": "abc123",
            "url": url,
            "canonical_url": url,
            "source_type": "video",
            "language": "Português",
            "language_code": "pt",
            "is_generated": True,
            "translated": False,
            "quality": {"segments": 1},
            "segments": [{"index": 1, "start": 0, "duration": 2, "end": 2, "text": "Abra o sistema."}],
        },
    )

    def download_must_not_run(url):
        raise AssertionError("YouTube MP4 must not be downloaded in transcript-only mode")

    monkeypatch.setattr(api._youtube_video_service, "download", download_must_not_run)
    monkeypatch.setattr(
        api,
        "_analyze_transcript_text",
        lambda transcript, transcript_segments, task_prompt, source: {
            "ok": True,
            "engine": "video-transcript-analyzer",
            "mode": "transcript_only",
            "analysis": {"etapas": [{"ordem": 1, "acao": "Abrir o sistema"}]},
            "transcript": transcript,
            "transcript_segments": transcript_segments,
            "frames_analyzed": 0,
            "source": source,
        },
    )

    response = client.post(
        "/api/youtube/analyze",
        json={
            "url": "https://youtu.be/abc123",
            "languages": ["pt"],
            "analysis_mode": "transcript",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "transcript_only"
    assert body["source"]["visual_download"] is False
    assert body["transcript_metadata"]["available"] is True
