import types

from backend import app as backend_app


def test_gemini_youtube_transcribe_uses_public_url(monkeypatch):
    import sys
    import types as py_types

    class FakeResponse:
        text = "# Transcrição\n\nOlá, mundo."

    class FakeModels:
        def generate_content(self, **kwargs):
            assert kwargs["model"] == "gemini-test"
            parts = kwargs["contents"].parts
            assert parts[0].file_data.file_uri == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            assert "transcrição" in parts[1].text.lower()
            return FakeResponse()

    class FakeClient:
        def __init__(self, api_key):
            assert api_key == "test-key"
            self.models = FakeModels()

    fake_genai = py_types.ModuleType("google.genai")
    fake_genai.Client = FakeClient

    fake_google = py_types.ModuleType("google")
    fake_google.genai = fake_genai

    fake_genai_types = py_types.ModuleType("google.genai.types")
    fake_genai_types.Content = lambda parts: py_types.SimpleNamespace(parts=parts)
    fake_genai_types.Part = lambda **kwargs: py_types.SimpleNamespace(**kwargs)
    fake_genai_types.FileData = lambda file_uri: py_types.SimpleNamespace(file_uri=file_uri)

    monkeypatch.setattr(backend_app, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(backend_app, "GEMINI_YOUTUBE_MODEL", "gemini-test")
    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", fake_genai_types)

    result = backend_app._gemini_youtube_transcribe(
        "https://youtu.be/dQw4w9WgXcQ"
    )

    assert result["engine"] == "gemini-youtube-url"
    assert result["provider"] == "gemini"
    assert result["video_id"] == "dQw4w9WgXcQ"
    assert "# Transcrição" in result["markdown"]
