import types

from backend import app as backend_app


def test_gemini_youtube_transcribe_uses_public_url(monkeypatch):
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

    fake_genai = types.SimpleNamespace(Client=FakeClient)
    fake_types = types.SimpleNamespace(
        Content=lambda parts: types.SimpleNamespace(parts=parts),
        Part=types.SimpleNamespace(
            file_data=lambda file_data: types.SimpleNamespace(file_data=file_data),
            text=lambda text: types.SimpleNamespace(text=text),
        ),
        FileData=lambda file_uri: types.SimpleNamespace(file_uri=file_uri),
    )

    monkeypatch.setattr(backend_app, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(backend_app, "GEMINI_YOUTUBE_MODEL", "gemini-test")
    monkeypatch.setitem(__import__("sys").modules, "google", types.SimpleNamespace(genai=fake_genai))
    monkeypatch.setitem(__import__("sys").modules, "google.genai", fake_genai)
    monkeypatch.setitem(__import__("sys").modules, "google.genai.types", fake_types)

    result = backend_app._gemini_youtube_transcribe(
        "https://youtu.be/dQw4w9WgXcQ"
    )

    assert result["engine"] == "gemini-youtube-url"
    assert result["provider"] == "gemini"
    assert result["video_id"] == "dQw4w9WgXcQ"
    assert "# Transcrição" in result["markdown"]
