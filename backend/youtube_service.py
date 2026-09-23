
"""
YouTube transcript ingestion service for MarkAI Converter.

This module isolates the third-party transcript provider from the FastAPI routes.
It normalizes YouTube URLs, discovers caption tracks, fetches a preferred
transcript, calculates quality metrics, and renders a stable Markdown form.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
DEFAULT_LANGUAGES = ("pt-BR", "pt", "en", "es")


class YouTubeServiceError(Exception):
    """Stable service error with a machine-readable code."""

    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class YouTubeSource:
    video_id: str
    original_url: str
    canonical_url: str
    source_type: str


class YouTubeTranscriptService:
    def __init__(
        self,
        *,
        cache_ttl_seconds: int | None = None,
        http_proxy: str | None = None,
        https_proxy: str | None = None,
    ):
        self.cache_ttl_seconds = max(
            0,
            cache_ttl_seconds
            if cache_ttl_seconds is not None
            else int(os.getenv("MARKAI_YOUTUBE_CACHE_TTL_SECONDS", "900")),
        )
        self.http_proxy = http_proxy or os.getenv("MARKAI_YOUTUBE_HTTP_PROXY") or ""
        self.https_proxy = https_proxy or os.getenv("MARKAI_YOUTUBE_HTTPS_PROXY") or ""
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    @staticmethod
    def parse_url(url: str) -> YouTubeSource:
        raw = str(url or "").strip()
        if not raw:
            raise YouTubeServiceError("YOUTUBE_URL_EMPTY", "URL do YouTube não informada.")

        try:
            parsed = urlparse(raw)
        except ValueError as exc:
            raise YouTubeServiceError("YOUTUBE_URL_INVALID", "URL do YouTube inválida.") from exc

        host = (parsed.hostname or "").lower()
        if host not in YOUTUBE_HOSTS:
            raise YouTubeServiceError(
                "YOUTUBE_HOST_INVALID",
                "A URL informada não pertence ao YouTube.",
            )

        video_id = ""
        source_type = "video"

        if host in {"youtu.be", "www.youtu.be"}:
            video_id = parsed.path.strip("/").split("/", 1)[0]
        elif parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith("/shorts/"):
            source_type = "short"
            video_id = parsed.path.split("/", 2)[2].split("/", 1)[0]
        elif parsed.path.startswith("/live/"):
            source_type = "live"
            video_id = parsed.path.split("/", 2)[2].split("/", 1)[0]
        elif parsed.path.startswith("/embed/"):
            source_type = "embed"
            video_id = parsed.path.split("/", 2)[2].split("/", 1)[0]

        if not VIDEO_ID_RE.fullmatch(video_id):
            raise YouTubeServiceError(
                "YOUTUBE_VIDEO_ID_INVALID",
                "Não foi possível identificar um Video ID válido na URL.",
            )

        return YouTubeSource(
            video_id=video_id,
            original_url=raw,
            canonical_url=f"https://www.youtube.com/watch?v={video_id}",
            source_type=source_type,
        )

    @staticmethod
    def _provider_import():
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            from youtube_transcript_api import (
                AgeRestricted,
                IpBlocked,
                NoTranscriptFound,
                PoTokenRequired,
                RequestBlocked,
                TranscriptsDisabled,
                TranslationLanguageNotAvailable,
                VideoUnavailable,
                VideoUnplayable,
            )
        except ImportError as exc:
            raise YouTubeServiceError(
                "YOUTUBE_PROVIDER_UNAVAILABLE",
                "O provider youtube-transcript-api não está instalado.",
            ) from exc

        return {
            "YouTubeTranscriptApi": YouTubeTranscriptApi,
            "AgeRestricted": AgeRestricted,
            "IpBlocked": IpBlocked,
            "NoTranscriptFound": NoTranscriptFound,
            "PoTokenRequired": PoTokenRequired,
            "RequestBlocked": RequestBlocked,
            "TranscriptsDisabled": TranscriptsDisabled,
            "TranslationLanguageNotAvailable": TranslationLanguageNotAvailable,
            "VideoUnavailable": VideoUnavailable,
            "VideoUnplayable": VideoUnplayable,
        }

    def _build_provider(self):
        provider = self._provider_import()
        kwargs: dict[str, Any] = {}
        if self.http_proxy or self.https_proxy:
            try:
                from youtube_transcript_api.proxies import GenericProxyConfig
            except ImportError as exc:
                raise YouTubeServiceError(
                    "YOUTUBE_PROXY_UNAVAILABLE",
                    "O suporte a proxy do provider do YouTube não está disponível.",
                ) from exc
            kwargs["proxy_config"] = GenericProxyConfig(
                http_url=self.http_proxy or None,
                https_url=self.https_proxy or None,
            )
        return provider["YouTubeTranscriptApi"](**kwargs), provider

    @staticmethod
    def _language_priority(languages: list[str] | tuple[str, ...] | None) -> list[str]:
        values = []
        for language in languages or DEFAULT_LANGUAGES:
            normalized = str(language).strip()
            if normalized and normalized not in values:
                values.append(normalized)
        return values or list(DEFAULT_LANGUAGES)

    @staticmethod
    def _cache_key(
        video_id: str,
        languages: list[str],
        translate_to: str | None,
        preserve_formatting: bool = False,
    ) -> str:
        translated = (translate_to or "").strip().lower()
        formatting = "1" if preserve_formatting else "0"
        return f"{video_id}|{','.join(languages)}|{translated}|fmt={formatting}"

    def _get_cached(self, key: str) -> dict[str, Any] | None:
        if self.cache_ttl_seconds <= 0:
            return None
        item = self._cache.get(key)
        if not item:
            return None
        created_at, payload = item
        if time.monotonic() - created_at > self.cache_ttl_seconds:
            self._cache.pop(key, None)
            return None
        return payload

    def _set_cached(self, key: str, payload: dict[str, Any]) -> None:
        if self.cache_ttl_seconds > 0:
            self._cache[key] = (time.monotonic(), payload)

    @staticmethod
    def _map_error(exc: Exception, provider_errors: dict[str, Any], video_id: str) -> YouTubeServiceError:
        mapping = [
            (provider_errors["TranscriptsDisabled"], "YOUTUBE_TRANSCRIPTS_DISABLED", "As legendas/transcrição estão desativadas para este vídeo.", False),
            (provider_errors["NoTranscriptFound"], "YOUTUBE_TRANSCRIPT_NOT_FOUND", "Não foi encontrada transcrição nas linguagens solicitadas.", False),
            (provider_errors["VideoUnavailable"], "YOUTUBE_VIDEO_UNAVAILABLE", "O vídeo do YouTube está indisponível.", False),
            (provider_errors["VideoUnplayable"], "YOUTUBE_VIDEO_UNPLAYABLE", "O vídeo não pode ser reproduzido pelo provider.", False),
            (provider_errors["AgeRestricted"], "YOUTUBE_AGE_RESTRICTED", "O vídeo possui restrição de idade e não pôde ser acessado.", False),
            (provider_errors["PoTokenRequired"], "YOUTUBE_PO_TOKEN_REQUIRED", "O YouTube exige um PO Token para obter esta transcrição.", False),
            (provider_errors["TranslationLanguageNotAvailable"], "YOUTUBE_TRANSLATION_LANGUAGE_UNAVAILABLE", "A tradução solicitada não está disponível para esta legenda.", False),
            (provider_errors["RequestBlocked"], "YOUTUBE_REQUEST_BLOCKED", "A requisição ao YouTube foi bloqueada.", True),
            (provider_errors["IpBlocked"], "YOUTUBE_IP_BLOCKED", "O IP de origem foi bloqueado pelo YouTube.", True),
        ]
        for exc_type, code, message, retryable in mapping:
            if isinstance(exc, exc_type):
                return YouTubeServiceError(code, message, retryable=retryable)
        return YouTubeServiceError(
            "YOUTUBE_TRANSCRIPT_ERROR",
            f"Falha ao obter a transcrição do vídeo {video_id}.",
            retryable=True,
        )

    def list_transcripts(self, video_id: str) -> dict[str, Any]:
        if not VIDEO_ID_RE.fullmatch(video_id or ""):
            raise YouTubeServiceError("YOUTUBE_VIDEO_ID_INVALID", "Video ID inválido.")

        api, provider_errors = self._build_provider()
        try:
            transcript_list = api.list(video_id)
            items = []
            for transcript in transcript_list:
                translation_languages = getattr(transcript, "translation_languages", []) or []
                items.append(
                    {
                        "language": getattr(transcript, "language", ""),
                        "language_code": getattr(transcript, "language_code", ""),
                        "is_generated": bool(getattr(transcript, "is_generated", False)),
                        "is_translatable": bool(getattr(transcript, "is_translatable", False)),
                        "translation_languages": [
                            {
                                "language": getattr(item, "language", ""),
                                "language_code": getattr(item, "language_code", ""),
                            }
                            for item in translation_languages
                        ],
                    }
                )
            return {
                "video_id": video_id,
                "count": len(items),
                "transcripts": items,
            }
        except Exception as exc:
            mapped = self._map_error(exc, provider_errors, video_id)
            raise mapped from exc

    def fetch_transcript(
        self,
        video_id: str,
        *,
        languages: list[str] | tuple[str, ...] | None = None,
        translate_to: str | None = None,
        preserve_formatting: bool = False,
    ) -> dict[str, Any]:
        if not VIDEO_ID_RE.fullmatch(video_id or ""):
            raise YouTubeServiceError("YOUTUBE_VIDEO_ID_INVALID", "Video ID inválido.")

        language_priority = self._language_priority(languages)
        cache_key = self._cache_key(
            video_id,
            language_priority,
            translate_to,
            preserve_formatting,
        )
        cached = self._get_cached(cache_key)
        if cached:
            result = dict(cached)
            result["cache"] = "hit"
            return result

        api, provider_errors = self._build_provider()
        try:
            transcript_list = api.list(video_id)
            transcript = transcript_list.find_transcript(language_priority)
            original_language = getattr(transcript, "language_code", "")
            original_is_generated = bool(getattr(transcript, "is_generated", False))

            translated = False
            if translate_to:
                target = translate_to.strip()
                if target and target != original_language:
                    transcript = transcript.translate(target)
                    translated = True

            fetched = transcript.fetch(preserve_formatting=preserve_formatting)
            segments = self._normalize_segments(fetched)
            payload = {
                "provider": "youtube-transcript-api",
                "video_id": video_id,
                "language": getattr(fetched, "language", ""),
                "language_code": getattr(fetched, "language_code", ""),
                "source_language_code": original_language,
                "is_generated": bool(getattr(fetched, "is_generated", original_is_generated)),
                "translated": translated,
                "translation_language": translate_to if translated else None,
                "segments": segments,
                "quality": self.quality_metrics(segments),
                "cache": "miss",
            }
            payload["markdown"] = self.to_markdown(payload)
            self._set_cached(cache_key, payload)
            return payload
        except YouTubeServiceError:
            raise
        except Exception as exc:
            mapped = self._map_error(exc, provider_errors, video_id)
            raise mapped from exc

    @staticmethod
    def _normalize_segments(fetched: Any) -> list[dict[str, Any]]:
        raw_segments = (
            fetched.to_raw_data()
            if hasattr(fetched, "to_raw_data")
            else [
                {
                    "text": getattr(item, "text", ""),
                    "start": getattr(item, "start", 0.0),
                    "duration": getattr(item, "duration", 0.0),
                }
                for item in fetched
            ]
        )
        result = []
        for index, item in enumerate(raw_segments, start=1):
            text = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()
            if not text:
                continue
            start = max(0.0, float(item.get("start") or 0.0))
            duration = max(0.0, float(item.get("duration") or 0.0))
            result.append(
                {
                    "index": index,
                    "start": round(start, 3),
                    "duration": round(duration, 3),
                    "end": round(start + duration, 3),
                    "text": text,
                }
            )
        return result

    @staticmethod
    def quality_metrics(segments: list[dict[str, Any]]) -> dict[str, Any]:
        text = " ".join(item["text"] for item in segments).strip()
        words = re.findall(r"\S+", text, flags=re.UNICODE)
        duration = max((float(item["end"]) for item in segments), default=0.0)
        non_empty = sum(1 for item in segments if item["text"])
        overlaps = sum(
            1
            for previous, current in zip(segments, segments[1:])
            if current["start"] < previous["end"]
        )
        return {
            "segments": len(segments),
            "characters": len(text),
            "words": len(words),
            "duration_seconds": round(duration, 3),
            "non_empty_segments": non_empty,
            "overlaps": overlaps,
        }

    @staticmethod
    def _format_timestamp(seconds: float) -> str:
        total = max(0, int(seconds))
        hours, remainder = divmod(total, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    @classmethod
    def to_markdown(cls, transcript: dict[str, Any]) -> str:
        lines = [
            "# Transcrição do YouTube",
            "",
            f"**Vídeo:** {transcript.get('video_id', '')}",
            f"**Idioma:** {transcript.get('language', '')} ({transcript.get('language_code', '')})",
            f"**Origem da legenda:** {'automática' if transcript.get('is_generated') else 'manual'}",
        ]
        if transcript.get("translated"):
            lines.append(f"**Tradução:** {transcript.get('translation_language', '')}")
        lines.extend(
            [
                f"**Segmentos:** {transcript.get('quality', {}).get('segments', 0)}",
                "",
                "## Transcrição",
                "",
            ]
        )

        for segment in transcript.get("segments", []):
            lines.append(f"### {cls._format_timestamp(float(segment['start']))}")
            lines.append("")
            lines.append(segment["text"])
            lines.append("")

        return "\n".join(lines).strip() + "\n"

    def transcribe_url(
        self,
        url: str,
        *,
        languages: list[str] | tuple[str, ...] | None = None,
        translate_to: str | None = None,
        preserve_formatting: bool = False,
    ) -> dict[str, Any]:
        source = self.parse_url(url)
        result = self.fetch_transcript(
            source.video_id,
            languages=languages,
            translate_to=translate_to,
            preserve_formatting=preserve_formatting,
        )
        result["url"] = source.original_url
        result["canonical_url"] = source.canonical_url
        result["source_type"] = source.source_type
        return result


__all__ = [
    "DEFAULT_LANGUAGES",
    "VIDEO_ID_RE",
    "YouTubeServiceError",
    "YouTubeSource",
    "YouTubeTranscriptService",
]
