from pathlib import Path

import backend.app as api


def test_adaptive_frame_selection_detects_timestamps_and_caps(monkeypatch, tmp_path):
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()

    def fake_run(*args, **kwargs):
        for index in range(10):
            (frames_dir / f"frame_{index + 1:03d}.jpg").write_bytes(b"jpg")
        class Result:
            returncode = 0
            stderr = "\\n".join(f"[showinfo] n:{i} pts_time:{i * api.VIDEO_FRAME_INTERVAL}" for i in range(10))
        return Result()

    monkeypatch.setattr(api.subprocess, "run", fake_run)
    monkeypatch.setattr(api, "VIDEO_MAX_FRAMES", 4)
    monkeypatch.setattr(api, "VIDEO_FRAME_INTERVAL", 5)

    result = api._extract_adaptive_video_frames("ffmpeg", Path("video.mp4"), frames_dir)

    assert result["sampled_frames"] == 10
    assert result["selected_frames"] == 4
    assert result["discarded_frames"] == 6
    assert result["reduction_rate"] == 0.6
    assert result["timestamps"] == [0.0, 15.0, 30.0, 45.0]
    assert len(result["frame_files"]) == 4


def test_adaptive_frame_selection_uses_scene_threshold_and_resize(monkeypatch, tmp_path):
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        (frames_dir / "frame_001.jpg").write_bytes(b"jpg")
        class Result:
            returncode = 0
            stderr = "pts_time:0"
        return Result()

    monkeypatch.setattr(api.subprocess, "run", fake_run)
    monkeypatch.setattr(api, "VIDEO_FRAME_INTERVAL", 7)
    monkeypatch.setattr(api, "VIDEO_MAX_HEIGHT", 360)
    monkeypatch.setattr(api, "VIDEO_SCENE_THRESHOLD", 0.22)

    api._extract_adaptive_video_frames("ffmpeg", Path("video.mp4"), frames_dir)

    command = " ".join(captured["args"])
    assert "fps=1/7" in command
    assert "scale=-2:360" in command
    assert "gt(scene,0.22)" in command
    assert "showinfo" in command
