"""
MarkAI Converter - MarkItDown backend
Optional local/server engine for high-fidelity document extraction.

Run:
    pip install -r requirements.txt
    uvicorn backend.app:app --reload --port 8000

The frontend can continue to work without this service; when available it
uses MarkItDown first and falls back to the browser parsers on failure.
"""
from __future__ import annotations

import ipaddress
import os
import socket
import subprocess
import tempfile
import time
import base64
import json
from pathlib import Path
from urllib.parse import urlparse

import httpx

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown

from backend.youtube_service import DEFAULT_LANGUAGES, YouTubeServiceError, YouTubeTranscriptService
from backend.youtube_video_service import YouTubeVideoService, YouTubeVideoServiceError

APP_VERSION = "3.6.0"
MAX_UPLOAD_MB = max(1, int(os.getenv("MARKAI_MAX_UPLOAD_MB", "100")))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_URL_MB = max(1, int(os.getenv("MARKAI_MAX_URL_MB", "20")))
MAX_URL_BYTES = MAX_URL_MB * 1024 * 1024
VIDEO_MAX_MB = max(10, int(os.getenv("MARKAI_VIDEO_MAX_MB", "200")))
VIDEO_MAX_BYTES = VIDEO_MAX_MB * 1024 * 1024
VIDEO_TRANSCRIPT_MAX_MB = max(VIDEO_MAX_MB, int(os.getenv("MARKAI_VIDEO_TRANSCRIPT_MAX_MB", "1024")))
VIDEO_TRANSCRIPT_MAX_BYTES = VIDEO_TRANSCRIPT_MAX_MB * 1024 * 1024
VIDEO_MODEL = os.getenv("MARKAI_VIDEO_MODEL", "gpt-5.6-luna")
VIDEO_TRANSCRIBE_MODEL = os.getenv("MARKAI_VIDEO_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
VIDEO_API_KEY = os.getenv("MARKAI_VIDEO_API_KEY") or os.getenv("OPENAI_API_KEY")
VIDEO_FRAME_INTERVAL = max(1, int(os.getenv("MARKAI_VIDEO_FRAME_INTERVAL", "5")))
VIDEO_MAX_FRAMES = max(4, int(os.getenv("MARKAI_VIDEO_MAX_FRAMES", "24")))
VIDEO_MAX_HEIGHT = max(180, int(os.getenv("MARKAI_VIDEO_MAX_HEIGHT", "480")))
VIDEO_SCENE_THRESHOLD = min(1.0, max(0.01, float(os.getenv("MARKAI_VIDEO_SCENE_THRESHOLD", "0.18"))))
URL_TIMEOUT_SECONDS = max(5, int(os.getenv("MARKAI_URL_TIMEOUT_SECONDS", "30")))
URL_MAX_REDIRECTS = max(0, int(os.getenv("MARKAI_URL_MAX_REDIRECTS", "3")))
YOUTUBE_CACHE_TTL_SECONDS = max(0, int(os.getenv("MARKAI_YOUTUBE_CACHE_TTL_SECONDS", "900")))
YOUTUBE_HTTP_PROXY = os.getenv("MARKAI_YOUTUBE_HTTP_PROXY", "")
YOUTUBE_HTTPS_PROXY = os.getenv("MARKAI_YOUTUBE_HTTPS_PROXY", "")
YOUTUBE_VISUAL_ENABLED = os.getenv("MARKAI_YOUTUBE_VISUAL_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
YOUTUBE_VISUAL_MAX_MB = max(20, int(os.getenv("MARKAI_YOUTUBE_VISUAL_MAX_MB", "150")))
YOUTUBE_VISUAL_MAX_DURATION_SECONDS = max(60, int(os.getenv("MARKAI_YOUTUBE_VISUAL_MAX_DURATION_SECONDS", "2700")))
YOUTUBE_VISUAL_MAX_HEIGHT = max(180, int(os.getenv("MARKAI_YOUTUBE_VISUAL_MAX_HEIGHT", "480")))
OCR_ENABLED = os.getenv("MARKAI_OCR_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
OCR_MODEL = os.getenv("MARKAI_OCR_MODEL", "gpt-4o")
OCR_API_KEY = os.getenv("MARKAI_OCR_API_KEY") or os.getenv("OPENAI_API_KEY")

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}
REMOTE_CONTENT_TYPES = {
    "text/html": ".html",
    "application/xhtml+xml": ".html",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/json": ".json",
    "text/csv": ".csv",
    "application/xml": ".xml",
    "text/xml": ".xml",
}

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".xls", ".csv", ".json", ".xml", ".html", ".htm", ".txt", ".md", ".epub", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".wav", ".mp3", ".m4a", ".py", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".sql", ".sh", ".rb", ".go", ".rs", ".java", ".cpp", ".c", ".cs", ".php", ".yaml", ".yml", ".toml", ".ini", ".r", ".lua", ".pl", ".kt", ".swift", ".vue", ".svelte"}


app = FastAPI(
    title="MarkAI Converter API",
    version=APP_VERSION,
    description="MarkItDown-powered conversion engine for MarkAI Converter.",
)

# Development-friendly defaults. In production, set MARKAI_CORS_ORIGINS.
origins = [
    origin.strip()
    for origin in os.getenv(
        "MARKAI_CORS_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://localhost:8000,https://felipe11shimizu.github.io",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _is_youtube_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and parsed.hostname in YOUTUBE_HOSTS
    except ValueError:
        return False


def _validate_public_host(hostname: str) -> None:
    if not hostname:
        raise HTTPException(status_code=400, detail="URL sem hostname válido.")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise HTTPException(status_code=422, detail="Não foi possível resolver o domínio informado.") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise HTTPException(status_code=403, detail="Por segurança, URLs para endereços privados ou reservados não são permitidas.")


def _validate_url(url: str) -> None:
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="URL inválida.") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="A URL deve usar http ou https.")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="URLs com credenciais embutidas não são permitidas.")
    _validate_public_host(parsed.hostname)


def _extension_for_response(url: str, content_type: str) -> str:
    mime = content_type.split(";", 1)[0].strip().lower()
    if mime in REMOTE_CONTENT_TYPES:
        return REMOTE_CONTENT_TYPES[mime]
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in ALLOWED_EXTENSIONS else ".html"


def _fetch_remote_url(url: str):
    current = url
    for _ in range(URL_MAX_REDIRECTS + 1):
        _validate_url(current)
        try:
            with httpx.Client(
                timeout=URL_TIMEOUT_SECONDS,
                follow_redirects=False,
                headers={"User-Agent": "MarkAI-Converter/3.3"},
            ) as client:
                with client.stream("GET", current) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise HTTPException(status_code=422, detail="Redirecionamento sem destino válido.")
                        from urllib.parse import urljoin
                        current = urljoin(current, location)
                        continue

                    if response.status_code >= 400:
                        raise HTTPException(
                            status_code=422,
                            detail=f"O servidor remoto respondeu HTTP {response.status_code}.",
                        )

                    content_length = response.headers.get("content-length")
                    if content_length:
                        try:
                            if int(content_length) > MAX_URL_BYTES:
                                raise HTTPException(
                                    status_code=413,
                                    detail=f"Conteúdo remoto excede o limite de {MAX_URL_MB} MB.",
                                )
                        except ValueError:
                            pass

                    chunks = []
                    total = 0
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > MAX_URL_BYTES:
                            raise HTTPException(
                                status_code=413,
                                detail=f"Conteúdo remoto excede o limite de {MAX_URL_MB} MB.",
                            )
                        chunks.append(chunk)

                    data = b"".join(chunks)
                    content_type = response.headers.get("content-type", "text/html")
                    return current, data, content_type
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="Tempo limite excedido ao acessar a URL.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=422, detail="Não foi possível acessar a URL informada.") from exc

    raise HTTPException(status_code=310, detail=f"Quantidade máxima de redirecionamentos excedida ({URL_MAX_REDIRECTS}).")

def _convert_remote_url(url: str):
    final_url, data, content_type = _fetch_remote_url(url)
    suffix = _extension_for_response(final_url, content_type)
    temp_path = None
    started = time.perf_counter()
    try:
        with tempfile.NamedTemporaryFile(prefix="markai_url_", suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            temp_path = Path(tmp.name)
        result = _engine.convert_local(str(temp_path))
        markdown = result.markdown or ""
        if not markdown.strip():
            raise HTTPException(status_code=422, detail="O MarkItDown não encontrou conteúdo convertível na URL.")
        return {
            "ok": True, "engine": "markitdown-url", "url": url, "final_url": final_url,
            "content_type": content_type, "markdown": markdown,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "quality": _quality(markdown),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Falha ao converter conteúdo remoto: {type(exc).__name__}") from exc
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)



def _video_toolchain():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Análise de vídeo requer o runtime FFmpeg.") from exc


def _run_ffmpeg(ffmpeg: str, args: list[str], timeout: int = 120):
    try:
        proc = subprocess.run([ffmpeg, *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Tempo limite excedido durante o processamento do vídeo.") from exc
    if proc.returncode != 0:
        raise HTTPException(status_code=422, detail="Não foi possível processar o vídeo.")
    return proc



def _nearest_transcript_segments(
    segments: list[dict] | None,
    timestamp: float,
    window_seconds: float = 5.0,
) -> list[dict]:
    if not segments:
        return []
    def _number(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    matching = []
    for segment in segments:
        start = _number(segment.get("start"), 0.0)
        duration = max(0.0, _number(segment.get("duration"), 0.0))
        end = _number(segment.get("end"), start + duration)
        if start <= timestamp <= end or abs(start - timestamp) <= window_seconds:
            matching.append(segment)
    matching.sort(key=lambda segment: abs(float(segment.get("start", 0)) - timestamp))
    return matching[:4]


def _build_video_timeline(
    frame_count: int,
    *,
    interval_seconds: int,
    transcript_segments: list[dict] | None = None,
) -> list[dict]:
    timeline = []
    for index in range(frame_count):
        timestamp = round(index * interval_seconds, 3)
        context = _nearest_transcript_segments(transcript_segments, timestamp)
        timeline.append(
            {
                "frame_index": index + 1,
                "timestamp": timestamp,
                "transcript_segment_indices": [item.get("index") for item in context],
            }
        )
    return timeline


def _enrich_analysis_evidence(
    analysis: dict,
    *,
    transcript_segments: list[dict] | None,
    frame_count: int,
    interval_seconds: int,
    frame_timestamps: list[float] | None = None,
) -> dict:
    etapas = analysis.get("etapas")
    if not isinstance(etapas, list):
        return analysis

    segment_list = transcript_segments or []
    for index, step in enumerate(etapas, start=1):
        if not isinstance(step, dict):
            continue

        raw_timestamp = step.get("timestamp")
        timestamp_seconds = None
        if isinstance(raw_timestamp, (int, float)):
            timestamp_seconds = float(raw_timestamp)
        elif isinstance(raw_timestamp, str):
            parts = [int(part) for part in raw_timestamp.strip().split(":") if part.isdigit()]
            if len(parts) == 3:
                timestamp_seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
            elif len(parts) == 2:
                timestamp_seconds = parts[0] * 60 + parts[1]

        if timestamp_seconds is None:
            frame_index = min(max(index, 1), max(frame_count, 1))
            timestamp_seconds = (frame_index - 1) * interval_seconds
        else:
            if frame_timestamps:
                frame_index = min(
                    range(1, len(frame_timestamps) + 1),
                    key=lambda candidate: abs(frame_timestamps[candidate - 1] - timestamp_seconds),
                )
            else:
                frame_index = int(round(timestamp_seconds / max(interval_seconds, 1))) + 1
            frame_index = min(max(frame_index, 1), max(frame_count, 1))

        nearby = _nearest_transcript_segments(segment_list, timestamp_seconds)
        step["evidencia"] = {
            "timestamp_seconds": round(timestamp_seconds, 3),
            "frame_indices": [frame_index] if frame_count else [],
            "frame_timestamp_seconds": round(frame_timestamps[frame_index - 1], 3) if frame_timestamps and frame_count else None,
            "frame_delta_seconds": round(abs(frame_timestamps[frame_index - 1] - timestamp_seconds), 3) if frame_timestamps and frame_count else None,
            "transcript_segment_indices": [item.get("index") for item in nearby],
        }
        # Keep a stable reference list for downstream automation/exporters.
        step["segmentos_transcricao"] = [item.get("index") for item in nearby]
        step["evidencia_frame"] = f"frame_{frame_index:03d}" if frame_count else None

    analysis["evidencia_resumo"] = {
        "etapas_total": len(etapas),
        "etapas_com_frame": sum(1 for step in etapas if isinstance(step, dict) and step.get("evidencia", {}).get("frame_indices")),
        "etapas_com_transcricao": sum(1 for step in etapas if isinstance(step, dict) and step.get("evidencia", {}).get("transcript_segment_indices")),
        "frames_total": frame_count,
        "segmentos_transcricao_total": len(segment_list),
    }
    return analysis


def _parse_analysis_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            raise HTTPException(status_code=422, detail="A IA não retornou uma análise estruturada válida.")
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="A IA não retornou uma análise estruturada válida.") from exc


def _analyze_transcript_text(transcript: str, transcript_segments: list[dict] | None = None, task_prompt: str = "", source: dict | None = None) -> dict:
    if not VIDEO_API_KEY:
        raise HTTPException(status_code=503, detail="Análise por IA não está configurada. Defina MARKAI_VIDEO_API_KEY ou OPENAI_API_KEY.")
    if not transcript.strip():
        raise HTTPException(status_code=422, detail="Nenhuma transcrição foi encontrada para análise.")
    from openai import OpenAI
    client = OpenAI(api_key=VIDEO_API_KEY)
    prompt = f"""Analise SOMENTE a transcrição abaixo para engenharia reversa de processo.
Identifique as tarefas realmente descritas, em ordem temporal, sem inventar ações visuais que não estejam na fala. Para cada etapa, informe ação, tipo de ação, sistema/tela quando explicitamente mencionado, elemento ou campo mencionado, dados informados sem reproduzir credenciais, pré-condição, pós-condição, resultado, timestamp/segmentos e confiança.
Separe observações explícitas de inferências e marque pontos que precisam de confirmação visual ou humana. Produza uma sequência neutra para implementação de automação, sem afirmar que seletores, coordenadas ou estados de tela são conhecidos quando não aparecem na transcrição.
Retorne SOMENTE JSON válido no schema:
{{"objetivo":"","resumo":"","etapas":[{{"ordem":1,"timestamp":"00:00","acao":"","tipo_acao":"click|double_click|type|select|hotkey|keypress|scroll|drag|wait|open|navigate|download|upload|copy|paste|check|submit|other","sistema":"","tela":"","detalhes":"","elementos":[],"alvo":{{"descricao":"","texto":"","controle":"","seletores":[],"atalho":null}},"dados":{{"valor":"","campo":"","sensivel":false}},"precondicao":"","poscondicao":"","espera_segundos":0,"resultado":"","evidencia_frame":null,"segmentos_transcricao":[],"confianca":0.0}}],"decisoes":[],"erros":[],"observacoes":[],"automacao":{{"plataforma_sugerida":"pyautogui|playwright|selenium|rpa_desktop|indefinida","observacoes":"","passos":[]}}}}
Transcrição:
{transcript[:120000]}
Segmentos com timestamps:
{json.dumps(transcript_segments or [], ensure_ascii=False)[:60000]}
Instrução adicional:
{task_prompt or "Descreva o processo executado a partir da fala disponível."}"""
    response = client.responses.create(model=VIDEO_MODEL, input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}])
    analysis = _parse_analysis_json(getattr(response, "output_text", "") or "")
    analysis = _enrich_analysis_evidence(analysis, transcript_segments=transcript_segments, frame_count=0, interval_seconds=VIDEO_FRAME_INTERVAL)
    analysis.setdefault("timeline", [{"timestamp": item.get("start", 0), "transcript_segment_indices": [item.get("index")]} for item in (transcript_segments or [])])
    analysis.setdefault("fonte_video", source or {"type": "transcript_only"})
    return {"ok": True, "engine": "video-transcript-analyzer", "mode": "transcript_only", "analysis": analysis, "transcript": transcript, "transcript_segments": transcript_segments or [], "timeline": analysis.get("timeline", []), "frames_analyzed": 0, "frame_interval_seconds": None, "source": source or {"type": "transcript_only"}}


def _transcribe_video_file(path: Path) -> dict:
    ffmpeg = _video_toolchain()
    audio_path = path.parent / "audio_transcript.mp3"
    try:
        proc = subprocess.run([ffmpeg, "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", str(audio_path)], capture_output=True, text=True, timeout=1800)
        if proc.returncode != 0 or not audio_path.exists() or audio_path.stat().st_size == 0:
            raise HTTPException(status_code=422, detail="Não foi possível extrair o áudio para transcrição.")
        if audio_path.stat().st_size > 24 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="O áudio extraído excede o limite operacional de transcrição. Use um vídeo menor ou a transcrição do YouTube quando disponível.")
        from openai import OpenAI
        if not VIDEO_API_KEY:
            raise HTTPException(status_code=503, detail="Transcrição por IA não está configurada. Defina MARKAI_VIDEO_API_KEY ou OPENAI_API_KEY.")
        client = OpenAI(api_key=VIDEO_API_KEY)
        with audio_path.open("rb") as audio_file:
            transcription = client.audio.transcriptions.create(model=VIDEO_TRANSCRIBE_MODEL, file=audio_file)
        return {"text": getattr(transcription, "text", "") or "", "segments": []}
    finally:
        audio_path.unlink(missing_ok=True)


def _extract_adaptive_video_frames(ffmpeg: str, video_path: Path, frames_dir: Path) -> dict:
    """Extract low-rate, resized frames and keep scene changes only."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    filter_graph = (
        f"fps=1/{VIDEO_FRAME_INTERVAL},scale=-2:{VIDEO_MAX_HEIGHT},"
        f"select='eq(n,0)+gt(scene,{VIDEO_SCENE_THRESHOLD})',showinfo"
    )
    try:
        proc = subprocess.run(
            [ffmpeg, "-y", "-i", str(video_path), "-vf", filter_graph,
             "-vsync", "vfr", str(frames_dir / "frame_%03d.jpg")],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Tempo limite excedido durante a seleção adaptativa de quadros.") from exc
    if proc.returncode != 0:
        raise HTTPException(status_code=422, detail="Não foi possível extrair quadros adaptativos do vídeo.")

    import re
    timestamps = [float(value) for value in re.findall(r"pts_time:([0-9]+(?:\\.[0-9]+)?)", proc.stderr)]
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if len(timestamps) > len(frame_files):
        timestamps = timestamps[:len(frame_files)]
    elif len(timestamps) < len(frame_files):
        timestamps.extend(round(index * VIDEO_FRAME_INTERVAL, 3) for index in range(len(timestamps), len(frame_files)))

    candidate_count = (int(timestamps[-1] / VIDEO_FRAME_INTERVAL) + 1) if timestamps else len(frame_files)
    # The scene filter may produce more frames than the model budget.
    # Preserve temporal order and spread the selected set across the video.
    if len(frame_files) > VIDEO_MAX_FRAMES:
        keep_indices = [round(index * (len(frame_files) - 1) / (VIDEO_MAX_FRAMES - 1)) for index in range(VIDEO_MAX_FRAMES)]
        keep_indices = sorted(set(keep_indices))
        keep_set = set(keep_indices)
        for index, frame in enumerate(frame_files):
            if index not in keep_set:
                frame.unlink(missing_ok=True)
        frame_files = [frame_files[index] for index in keep_indices]
        timestamps = [timestamps[index] for index in keep_indices]

    return {
        "frame_files": frame_files,
        "timestamps": [round(value, 3) for value in timestamps],
        "sampled_frames": candidate_count,
        "selected_frames": len(frame_files),
        "discarded_frames": max(0, candidate_count - len(frame_files)),
        "reduction_rate": round(max(0, candidate_count - len(frame_files)) / max(candidate_count, 1), 4),
    }


def _analyze_video_file(filename: str, data: bytes, task_prompt: str = "", transcript_override: str | None = None, transcript_segments: list[dict] | None = None, source: dict | None = None):
    if len(data) > VIDEO_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Vídeo excede o limite de {VIDEO_MAX_MB} MB.")
    if not VIDEO_API_KEY:
        raise HTTPException(status_code=503, detail="Análise de vídeo por IA não está configurada. Defina MARKAI_VIDEO_API_KEY ou OPENAI_API_KEY.")

    from openai import OpenAI
    ffmpeg = _video_toolchain()
    root = Path(tempfile.mkdtemp(prefix="markai_video_"))
    video_path = root / Path(filename).name
    frames_dir = root / "frames"
    frames_dir.mkdir()
    audio_path = root / "audio.mp3"
    video_path.write_bytes(data)
    try:
        frame_selection = _extract_adaptive_video_frames(ffmpeg, video_path, frames_dir)
        audio_result = subprocess.run([ffmpeg, "-y", "-i", str(video_path), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", str(audio_path)], capture_output=True, text=True, timeout=180)
        transcript = transcript_override or ""
        if transcript_override is None and audio_result.returncode == 0 and audio_path.exists() and audio_path.stat().st_size > 0:
            client = OpenAI(api_key=VIDEO_API_KEY)
            with audio_path.open("rb") as audio_file:
                transcription = client.audio.transcriptions.create(model=VIDEO_TRANSCRIBE_MODEL, file=audio_file)
            transcript = getattr(transcription, "text", "") or ""

        frame_files = frame_selection["frame_files"]
        frame_timestamps = frame_selection["timestamps"]
        if not frame_files:
            raise HTTPException(status_code=422, detail="Não foi possível extrair quadros do vídeo.")
        client = OpenAI(api_key=VIDEO_API_KEY)
        prompt = f"""
Analise esta gravação de tela/vídeo para engenharia reversa de processo.
Identifique as tarefas realmente executadas, em ordem temporal, sem inventar ações que não estejam visíveis ou na transcrição.
Para cada etapa, informe a ação de tela necessária para reproduzir o processo: clique, duplo clique, digitação, seleção, tecla/atalho, scroll, arrastar, espera, abertura/navegação, upload/download, copiar/colar, validação ou envio.
Capture sistema, tela/janela, elemento alvo, texto visível, controle, coordenadas aproximadas quando visualmente determináveis, coordenadas normalizadas de 0 a 1 quando possível, candidatos a seletores/identificadores visíveis, valor informado, pré-condição, pós-condição e resultado.
Separe ações observáveis de inferências. Não invente coordenadas, seletores, valores ou identificadores; use null ou lista vazia quando não forem observáveis. Marque dados potencialmente sensíveis sem reproduzir credenciais.
Identifique repetições, decisões, esperas, erros e pontos que exigiriam confirmação humana. Produza também uma sequência de passos neutra para implementação de automação, sem afirmar que um seletor é confiável quando ele não foi confirmado.
Retorne SOMENTE JSON válido no schema:
{{"objetivo":"","resumo":"","etapas":[{{"ordem":1,"timestamp":"00:00","acao":"","tipo_acao":"click|double_click|type|select|hotkey|keypress|scroll|drag|wait|open|navigate|download|upload|copy|paste|check|submit|other","sistema":"","tela":"","detalhes":"","elementos":[],"alvo":{{"descricao":"","texto":"","controle":"","x":null,"y":null,"x_normalizado":null,"y_normalizado":null,"largura_normalizada":null,"altura_normalizada":null,"seletores":[],"atalho":null}},"dados":{{"valor":"","campo":"","sensivel":false}},"precondicao":"","poscondicao":"","espera_segundos":0,"resultado":"","evidencia_frame":"","segmentos_transcricao":[],"confianca":0.0}}],"decisoes":[],"erros":[],"observacoes":[],"automacao":{{"plataforma_sugerida":"pyautogui|playwright|selenium|rpa_desktop|indefinida","observacoes":"","passos":[]}}}}
Transcrição disponível:
{transcript[:20000]}
Contexto temporal da transcrição:
{json.dumps(transcript_segments or [], ensure_ascii=False)[:20000]}

Instrução adicional:
{task_prompt or "Descreva o processo completo executado no vídeo."}
"""

        content = [{"type": "input_text", "text": prompt}]
        timeline = [
            {
                "frame_index": index + 1,
                "timestamp": timestamp,
                "transcript_segment_indices": [item.get("index") for item in _nearest_transcript_segments(transcript_segments, timestamp)],
            }
            for index, timestamp in enumerate(frame_timestamps)
        ]
        for idx, frame in enumerate(frame_files):
            encoded = base64.b64encode(frame.read_bytes()).decode("ascii")
            timestamp = frame_timestamps[idx]
            nearby = _nearest_transcript_segments(transcript_segments, timestamp)
            nearby_text = "\n".join(
                f"[{item.get('index')}] {item.get('text', '')}"
                for item in nearby
            ) or "Sem segmento de transcrição próximo."
            content.append(
                {
                    "type": "input_text",
                    "text": (
                        f"Frame {idx + 1} — aproximadamente {timestamp}s\n"
                        f"Fala próxima nesse ponto:\n{nearby_text}"
                    ),
                }
            )
            content.append({"type": "input_image", "image_url": f"data:image/jpeg;base64,{encoded}"})
        response = client.responses.create(model=VIDEO_MODEL, input=[{"role": "user", "content": content}])
        raw = getattr(response, "output_text", "") or ""
        try:
            analysis = json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find("{")
            end = raw.rfind("}")
            if start < 0 or end <= start:
                raise HTTPException(status_code=422, detail="A IA não retornou uma análise estruturada válida.")
            try:
                analysis = json.loads(raw[start:end + 1])
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=422, detail="A IA não retornou uma análise estruturada válida.") from exc
        analysis = _enrich_analysis_evidence(
            analysis,
            transcript_segments=transcript_segments,
            frame_count=len(frame_files),
            interval_seconds=VIDEO_FRAME_INTERVAL,
        )
        analysis.setdefault("timeline", timeline)
        analysis["evidencia_video"] = {
            "estrategia": "fps_intervalo_com_scale_e_scene_detection",
            "frame_interval_seconds": VIDEO_FRAME_INTERVAL,
            "scene_threshold": VIDEO_SCENE_THRESHOLD,
            "max_height": VIDEO_MAX_HEIGHT,
            "frames_extraidos_amostragem": frame_selection["sampled_frames"],
            "frames_selecionados": len(frame_files),
            "frames_descartados": frame_selection["discarded_frames"],
            "taxa_reducao": frame_selection["reduction_rate"],
        }
        analysis.setdefault("fonte_video", source or {"type": "local_file", "filename": filename})
        return {"ok": True, "engine": "video-task-analyzer", "filename": filename, "analysis": analysis, "transcript": transcript, "transcript_segments": transcript_segments or [], "timeline": timeline, "frames_analyzed": len(frame_files), "frames_sampled": frame_selection["sampled_frames"], "frames_discarded": frame_selection["discarded_frames"], "frame_reduction_rate": frame_selection["reduction_rate"], "frame_timestamps": frame_timestamps, "frame_interval_seconds": VIDEO_FRAME_INTERVAL, "source": source or {"type": "local_file", "filename": filename}}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Falha na análise de vídeo: {type(exc).__name__}") from exc
    finally:
        import shutil
        shutil.rmtree(root, ignore_errors=True)

def _quality(markdown: str) -> dict:
    lines = markdown.splitlines()
    return {
        "characters": len(markdown),
        "lines": len(lines),
        "headings": sum(1 for line in lines if line.lstrip().startswith("#")),
        "table_lines": sum(1 for line in lines if "|" in line),
        "links": markdown.count("]("),
    }


def _read_upload(file: UploadFile):
    filename = Path(file.filename or "documento").name
    suffix = Path(filename).suffix.lower()
    if not suffix:
        raise HTTPException(status_code=400, detail="Arquivo sem extensão.")
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Extensão não habilitada: {suffix}")
    return filename, suffix


def _convert_bytes(filename: str, suffix: str, data: bytes):
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Arquivo excede o limite de {MAX_UPLOAD_MB} MB.")
    temp_path = None
    started = time.perf_counter()
    try:
        with tempfile.NamedTemporaryFile(prefix="markai_", suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            temp_path = Path(tmp.name)
        result = _engine.convert_local(str(temp_path))
        markdown = result.markdown or ""
        if not markdown.strip():
            raise HTTPException(status_code=422, detail="O MarkItDown não retornou conteúdo Markdown.")
        return {
            "ok": True, "engine": "markitdown", "filename": filename, "markdown": markdown,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "quality": _quality(markdown),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Falha na conversão de {filename}: {type(exc).__name__}") from exc
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


def _build_engine():
    if not OCR_ENABLED or not OCR_API_KEY:
        return MarkItDown()
    try:
        from openai import OpenAI
        return MarkItDown(enable_plugins=True, llm_client=OpenAI(api_key=OCR_API_KEY), llm_model=OCR_MODEL)
    except Exception:
        return MarkItDown()

_engine = _build_engine()
_youtube_service = YouTubeTranscriptService(
    cache_ttl_seconds=YOUTUBE_CACHE_TTL_SECONDS,
    http_proxy=YOUTUBE_HTTP_PROXY,
    https_proxy=YOUTUBE_HTTPS_PROXY,
)
_youtube_video_service = YouTubeVideoService(
    enabled=YOUTUBE_VISUAL_ENABLED,
    max_mb=YOUTUBE_VISUAL_MAX_MB,
    max_duration_seconds=YOUTUBE_VISUAL_MAX_DURATION_SECONDS,
    max_height=YOUTUBE_VISUAL_MAX_HEIGHT,
    http_proxy=YOUTUBE_HTTP_PROXY,
    https_proxy=YOUTUBE_HTTPS_PROXY,
)


def _youtube_error(exc: YouTubeServiceError) -> HTTPException:
    status_by_code = {
        "YOUTUBE_URL_EMPTY": 400,
        "YOUTUBE_URL_INVALID": 400,
        "YOUTUBE_HOST_INVALID": 400,
        "YOUTUBE_VIDEO_ID_INVALID": 400,
        "YOUTUBE_PROVIDER_UNAVAILABLE": 503,
        "YOUTUBE_PROXY_UNAVAILABLE": 503,
        "YOUTUBE_TRANSCRIPTS_DISABLED": 422,
        "YOUTUBE_TRANSCRIPT_NOT_FOUND": 404,
        "YOUTUBE_VIDEO_UNAVAILABLE": 404,
        "YOUTUBE_VIDEO_UNPLAYABLE": 422,
        "YOUTUBE_AGE_RESTRICTED": 403,
        "YOUTUBE_PO_TOKEN_REQUIRED": 422,
        "YOUTUBE_TRANSLATION_LANGUAGE_UNAVAILABLE": 422,
        "YOUTUBE_REQUEST_BLOCKED": 429,
        "YOUTUBE_IP_BLOCKED": 429,
        "YOUTUBE_VISUAL_DISABLED": 503,
        "YOUTUBE_VIDEO_PROVIDER_UNAVAILABLE": 503,
        "YOUTUBE_PROXY_UNAVAILABLE": 503,
        "YOUTUBE_VIDEO_TOO_LONG": 413,
        "YOUTUBE_VIDEO_DOWNLOAD_EMPTY": 422,
        "YOUTUBE_VIDEO_TOO_LARGE": 413,
        "YOUTUBE_VIDEO_PO_TOKEN_REQUIRED": 422,
        "YOUTUBE_VIDEO_ACCESS_RESTRICTED": 403,
        "YOUTUBE_VIDEO_DOWNLOAD_ERROR": 422,
    }
    return HTTPException(
        status_code=status_by_code.get(exc.code, 422),
        detail={"code": exc.code, "message": exc.message, "retryable": exc.retryable},
    )


def _youtube_languages(payload: dict) -> list[str]:
    value = payload.get("languages")
    if isinstance(value, str):
        languages = [part.strip() for part in value.split(",") if part.strip()]
    elif isinstance(value, list):
        languages = [str(part).strip() for part in value if str(part).strip()]
    else:
        languages = list(DEFAULT_LANGUAGES)
    return languages or list(DEFAULT_LANGUAGES)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": "markitdown",
        "version": APP_VERSION,
        "max_upload_mb": MAX_UPLOAD_MB,
        "url_engine": {"enabled": True, "max_mb": MAX_URL_MB, "timeout_seconds": URL_TIMEOUT_SECONDS, "max_redirects": URL_MAX_REDIRECTS, "youtube": True},
        "ocr": {"enabled": OCR_ENABLED, "configured": bool(OCR_API_KEY), "model": OCR_MODEL if OCR_ENABLED and OCR_API_KEY else None},
        "video_analysis": {"enabled": bool(VIDEO_API_KEY), "max_mb": VIDEO_MAX_MB, "model": VIDEO_MODEL if VIDEO_API_KEY else None, "frame_interval_seconds": VIDEO_FRAME_INTERVAL},
        "youtube": {"enabled": True, "provider": "youtube-transcript-api", "cache_ttl_seconds": YOUTUBE_CACHE_TTL_SECONDS, "proxy_configured": bool(YOUTUBE_HTTP_PROXY or YOUTUBE_HTTPS_PROXY), "default_languages": list(DEFAULT_LANGUAGES), "visual_analysis": {"enabled": YOUTUBE_VISUAL_ENABLED, "max_mb": YOUTUBE_VISUAL_MAX_MB, "max_duration_seconds": YOUTUBE_VISUAL_MAX_DURATION_SECONDS, "max_height": YOUTUBE_VISUAL_MAX_HEIGHT, "provider": "yt-dlp"}},
    }


@app.post("/api/convert")
async def convert(file: UploadFile = File(...)):
    filename, suffix = _read_upload(file)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    return _convert_bytes(filename, suffix, data)


@app.post("/api/youtube/resolve")
async def youtube_resolve(payload: dict):
    url = str(payload.get("url") or "").strip()
    try:
        source = _youtube_service.parse_url(url)
    except YouTubeServiceError as exc:
        raise _youtube_error(exc) from exc
    return {
        "ok": True,
        "engine": "youtube-router",
        "provider": "youtube-transcript-api",
        "video_id": source.video_id,
        "url": source.original_url,
        "canonical_url": source.canonical_url,
        "source_type": source.source_type,
    }


@app.post("/api/youtube/transcripts")
async def youtube_transcripts(payload: dict):
    url = str(payload.get("url") or "").strip()
    try:
        source = _youtube_service.parse_url(url)
        result = _youtube_service.list_transcripts(source.video_id)
    except YouTubeServiceError as exc:
        raise _youtube_error(exc) from exc
    result.update({
        "ok": True,
        "engine": "youtube-transcript-api",
        "url": source.original_url,
        "canonical_url": source.canonical_url,
        "source_type": source.source_type,
    })
    return result


@app.post("/api/youtube/transcribe")
async def youtube_transcribe(payload: dict):
    url = str(payload.get("url") or "").strip()
    translate_to = str(payload.get("translate_to") or "").strip() or None
    preserve_formatting = bool(payload.get("preserve_formatting", False))
    try:
        result = _youtube_service.transcribe_url(
            url,
            languages=_youtube_languages(payload),
            translate_to=translate_to,
            preserve_formatting=preserve_formatting,
        )
        result["ok"] = True
        result["engine"] = "youtube-transcript-api"
        return result
    except YouTubeServiceError as exc:
        raise _youtube_error(exc) from exc


@app.post("/api/youtube/analyze")
async def youtube_analyze(payload: dict):
    url = str(payload.get("url") or "").strip()
    task_prompt = str(payload.get("task_prompt") or "").strip()
    translate_to = str(payload.get("translate_to") or "").strip() or None
    analysis_mode = str(payload.get("analysis_mode") or "visual").strip().lower()

    transcript = None
    transcript_error = None
    try:
        transcript = _youtube_service.transcribe_url(
            url,
            languages=_youtube_languages(payload),
            translate_to=translate_to,
            preserve_formatting=False,
        )
    except YouTubeServiceError as exc:
        transcript_error = {
            "code": exc.code,
            "message": exc.message,
            "retryable": exc.retryable,
        }

    if analysis_mode in {"transcript", "transcript_only", "transcricao"}:
        if not transcript:
            raise HTTPException(status_code=422, detail="Não foi encontrada transcrição disponível para este vídeo do YouTube.")
        result = _analyze_transcript_text(
            " ".join(item.get("text", "") for item in transcript.get("segments", [])),
            transcript.get("segments", []),
            task_prompt,
            source={
                "type": "youtube",
                "video_id": transcript.get("video_id"),
                "url": transcript.get("url", url),
                "canonical_url": transcript.get("canonical_url", url),
                "source_type": transcript.get("source_type"),
                "mode": "transcript_only",
                "visual_download": False,
            },
        )
        result["transcript_metadata"] = {
            "available": True,
            "provider": transcript.get("provider"),
            "language": transcript.get("language"),
            "language_code": transcript.get("language_code"),
            "is_generated": transcript.get("is_generated"),
            "translated": transcript.get("translated", False),
            "quality": transcript.get("quality"),
            "error": transcript_error,
        }
        return result

    try:
        video = _youtube_video_service.download(url)
        result = _analyze_video_file(
            video["filename"],
            video["data"],
            task_prompt,
            transcript_override=(
                " ".join(item.get("text", "") for item in transcript.get("segments", []))
                if transcript
                else None
            ),
            transcript_segments=transcript.get("segments", []) if transcript else [],
            source={
                "type": "youtube",
                "video_id": transcript.get("video_id") if transcript else video.get("video_id"),
                "url": transcript.get("url", url) if transcript else url,
                "canonical_url": transcript.get("canonical_url", url) if transcript else video.get("canonical_url", url),
                "source_type": transcript.get("source_type") if transcript else video.get("source_type"),
                "title": video.get("title"),
                "channel": video.get("channel"),
                "duration_seconds": video.get("duration_seconds"),
                "filesize_bytes": video.get("filesize_bytes"),
                "visual_provider": "yt-dlp",
                "mode": "visual",
            },
        )
        result["transcript_metadata"] = {
            "available": bool(transcript),
            "provider": transcript.get("provider") if transcript else None,
            "language": transcript.get("language") if transcript else None,
            "language_code": transcript.get("language_code") if transcript else None,
            "is_generated": transcript.get("is_generated") if transcript else None,
            "translated": transcript.get("translated") if transcript else False,
            "quality": transcript.get("quality") if transcript else None,
            "error": transcript_error,
        }
        return result
    except YouTubeVideoServiceError as exc:
        raise _youtube_error(exc) from exc


@app.post("/api/convert-url")
async def convert_url(payload: dict):
    url = str(payload.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL não informada.")
    if _is_youtube_url(url):
        started = time.perf_counter()
        try:
            result = _youtube_service.transcribe_url(url, languages=list(DEFAULT_LANGUAGES))
            markdown = result.get("markdown", "")
            if markdown.strip():
                return {
                    "ok": True,
                    "engine": "youtube-transcript-api",
                    "url": url,
                    "final_url": result.get("canonical_url", url),
                    "markdown": markdown,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                    "quality": _quality(markdown),
                    "transcript": {
                        "provider": result.get("provider"),
                        "language": result.get("language"),
                        "language_code": result.get("language_code"),
                        "is_generated": result.get("is_generated"),
                        "segments": result.get("segments", []),
                        "quality": result.get("quality", {}),
                    },
                }
        except YouTubeServiceError:
            pass

        try:
            result = _engine.convert(url)
            markdown = result.markdown or ""
            if not markdown.strip():
                raise HTTPException(status_code=422, detail="Nenhum transcript/conteúdo foi retornado para o vídeo do YouTube.")
            return {
                "ok": True,
                "engine": "markitdown-youtube-fallback",
                "url": url,
                "final_url": url,
                "markdown": markdown,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                "quality": _quality(markdown),
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Falha ao processar YouTube: {type(exc).__name__}") from exc
    return _convert_remote_url(url)


@app.post("/api/analyze-video")
async def analyze_video(file: UploadFile = File(...), task_prompt: str = "", analysis_mode: str = Form("visual")):
    filename = Path(file.filename or "video.mp4").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".mp4", ".mov", ".webm", ".mkv", ".avi"}:
        raise HTTPException(status_code=415, detail="Formato de vídeo não habilitado.")
    mode = str(analysis_mode or "visual").strip().lower()
    if mode in {"transcript", "transcript_only", "transcricao"}:
        root = Path(tempfile.mkdtemp(prefix="markai_transcript_"))
        video_path = root / filename
        total = 0
        try:
            with video_path.open("wb") as target:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > VIDEO_TRANSCRIPT_MAX_BYTES:
                        raise HTTPException(status_code=413, detail=f"Vídeo para transcrição excede o limite de {VIDEO_TRANSCRIPT_MAX_MB} MB.")
                    target.write(chunk)
            transcription = _transcribe_video_file(video_path)
            return _analyze_transcript_text(
                transcription["text"],
                transcription.get("segments", []),
                task_prompt,
                source={"type": "local_file", "filename": filename, "mode": "transcript_only", "size_bytes": total},
            )
        finally:
            import shutil
            shutil.rmtree(root, ignore_errors=True)
    data = await file.read(VIDEO_MAX_BYTES + 1)
    return _analyze_video_file(filename, data, task_prompt, source={"type": "local_file", "filename": filename, "mode": "visual"})


@app.post("/api/convert-batch")
async def convert_batch(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo recebido.")
    results = []
    for file in files:
        try:
            filename, suffix = _read_upload(file)
            data = await file.read(MAX_UPLOAD_BYTES + 1)
            results.append(_convert_bytes(filename, suffix, data))
        except HTTPException as exc:
            results.append({"ok": False, "filename": Path(file.filename or "documento").name, "error": exc.detail, "status_code": exc.status_code})
    return {"ok": all(item.get("ok") for item in results), "engine": "markitdown", "total": len(results), "successful": sum(1 for item in results if item.get("ok")), "failed": sum(1 for item in results if not item.get("ok")), "results": results}
