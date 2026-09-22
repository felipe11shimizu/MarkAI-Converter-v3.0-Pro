
"""
Optional YouTube video ingestion for visual analysis.

The transcript engine is the primary, lightweight path. This module is only
used when visual YouTube analysis is explicitly enabled. It accepts YouTube
URLs only, disables playlists/cookies, enforces duration/size limits, and
returns the downloaded video as temporary bytes for the existing video
intelligence pipeline.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from backend.youtube_service import YouTubeTranscriptService, YouTubeServiceError


class YouTubeVideoServiceError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class YouTubeVideoService:
    def __init__(
        self,
        *,
        enabled: bool | None = None,
        max_mb: int | None = None,
        max_duration_seconds: int | None = None,
        max_height: int | None = None,
        http_proxy: str | None = None,
        https_proxy: str | None = None,
    ):
        self.enabled = (
            enabled
            if enabled is not None
            else os.getenv("MARKAI_YOUTUBE_VISUAL_ENABLED", "false").lower()
            in {"1", "true", "yes", "on"}
        )
        self.max_mb = max(
            20,
            max_mb
            if max_mb is not None
            else int(os.getenv("MARKAI_YOUTUBE_VISUAL_MAX_MB", "150")),
        )
        self.max_duration_seconds = max(
            60,
            max_duration_seconds
            if max_duration_seconds is not None
            else int(os.getenv("MARKAI_YOUTUBE_VISUAL_MAX_DURATION_SECONDS", "2700")),
        )
        self.max_height = max(
            180,
            max_height
            if max_height is not None
            else int(os.getenv("MARKAI_YOUTUBE_VISUAL_MAX_HEIGHT", "480")),
        )
        self.http_proxy = http_proxy or os.getenv("MARKAI_YOUTUBE_HTTP_PROXY", "")
        self.https_proxy = https_proxy or os.getenv("MARKAI_YOUTUBE_HTTPS_PROXY", "")

    def _import_yt_dlp(self):
        if not self.enabled:
            raise YouTubeVideoServiceError(
                "YOUTUBE_VISUAL_DISABLED",
                "A análise visual de vídeos do YouTube está desativada.",
            )
        try:
            import yt_dlp
        except ImportError as exc:
            raise YouTubeVideoServiceError(
                "YOUTUBE_VIDEO_PROVIDER_UNAVAILABLE",
                "O provider yt-dlp não está instalado.",
            ) from exc
        return yt_dlp

    def download(self, url: str) -> dict[str, Any]:
        try:
            source = YouTubeTranscriptService.parse_url(url)
        except YouTubeServiceError as exc:
            raise YouTubeVideoServiceError(exc.code, exc.message, retryable=exc.retryable) from exc

        yt_dlp = self._import_yt_dlp()
        root = Path(tempfile.mkdtemp(prefix="markai_youtube_"))
        output_template = str(root / "video.%(ext)s")
        max_bytes = self.max_mb * 1024 * 1024

        def progress_hook(status: dict[str, Any]) -> None:
            downloaded = int(status.get("downloaded_bytes") or 0)
            total = int(status.get("total_bytes") or status.get("total_bytes_estimate") or 0)
            if max(downloaded, total) > max_bytes:
                raise yt_dlp.utils.DownloadError(
                    f"MarkAI_YOUTUBE_VISUAL_MAX_MB exceeded: {self.max_mb}"
                )

        proxy = self.https_proxy or self.http_proxy or None
        options = {
            "format": (
                f"bestvideo[height<={self.max_height}][ext=mp4]+"
                f"bestaudio[ext=m4a]/"
                f"best[height<={self.max_height}][ext=mp4]/"
                f"best[height<={self.max_height}]/best"
            ),
            "outtmpl": output_template,
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "cachedir": False,
            "retries": 2,
            "fragment_retries": 2,
            "socket_timeout": 30,
            "max_filesize": max_bytes,
            "progress_hooks": [progress_hook],
        }
        if proxy:
            options["proxy"] = proxy

        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(source.canonical_url, download=False)
                duration = float(info.get("duration") or 0)
                if duration and duration > self.max_duration_seconds:
                    raise YouTubeVideoServiceError(
                        "YOUTUBE_VIDEO_TOO_LONG",
                        f"O vídeo possui {round(duration)} segundos; o limite visual é de {self.max_duration_seconds} segundos.",
                    )

                ydl.download([source.canonical_url])

            candidates = sorted(
                (
                    path
                    for path in root.iterdir()
                    if path.is_file()
                    and path.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov"}
                ),
                key=lambda path: path.stat().st_size,
                reverse=True,
            )
            if not candidates:
                raise YouTubeVideoServiceError(
                    "YOUTUBE_VIDEO_DOWNLOAD_EMPTY",
                    "O provider não produziu um arquivo de vídeo utilizável.",
                )

            video_path = candidates[0]
            size = video_path.stat().st_size
            if size > max_bytes:
                raise YouTubeVideoServiceError(
                    "YOUTUBE_VIDEO_TOO_LARGE",
                    f"O vídeo excede o limite visual de {self.max_mb} MB.",
                )

            data = video_path.read_bytes()
            return {
                "video_id": source.video_id,
                "url": source.original_url,
                "canonical_url": source.canonical_url,
                "source_type": source.source_type,
                "title": str(info.get("title") or ""),
                "channel": str(info.get("channel") or info.get("uploader") or ""),
                "duration_seconds": duration,
                "width": info.get("width"),
                "height": info.get("height"),
                "filesize_bytes": size,
                "filename": f"{source.video_id}{video_path.suffix.lower()}",
                "data": data,
            }
        except YouTubeVideoServiceError:
            raise
        except Exception as exc:
            message = str(exc)
            if "PO Token" in message or "po_token" in message.lower():
                raise YouTubeVideoServiceError(
                    "YOUTUBE_VIDEO_PO_TOKEN_REQUIRED",
                    "O YouTube exigiu um PO Token para obter o vídeo visual.",
                ) from exc
            if "Sign in" in message or "age" in message.lower():
                raise YouTubeVideoServiceError(
                    "YOUTUBE_VIDEO_ACCESS_RESTRICTED",
                    "O vídeo exige autenticação ou possui restrição de acesso.",
                ) from exc
            raise YouTubeVideoServiceError(
                "YOUTUBE_VIDEO_DOWNLOAD_ERROR",
                "Não foi possível obter o vídeo do YouTube para análise visual.",
                retryable=True,
            ) from exc
        finally:
            shutil.rmtree(root, ignore_errors=True)


__all__ = ["YouTubeVideoService", "YouTubeVideoServiceError"]
