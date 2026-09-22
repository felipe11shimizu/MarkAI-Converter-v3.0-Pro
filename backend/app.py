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
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown

APP_VERSION = "3.3.0"
MAX_UPLOAD_MB = max(1, int(os.getenv("MARKAI_MAX_UPLOAD_MB", "100")))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_URL_MB = max(1, int(os.getenv("MARKAI_MAX_URL_MB", "20")))
MAX_URL_BYTES = MAX_URL_MB * 1024 * 1024
URL_TIMEOUT_SECONDS = max(5, int(os.getenv("MARKAI_URL_TIMEOUT_SECONDS", "30")))
URL_MAX_REDIRECTS = max(0, int(os.getenv("MARKAI_URL_MAX_REDIRECTS", "3")))
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

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".xls", ".csv", ".json", ".xml", ".html", ".htm", ".txt", ".md", ".epub", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".wav", ".mp3", ".m4a", ".py", ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".sql", ".sh", ".rb", ".go", ".rs", ".java", ".cpp", ".c", ".cs", ".php", ".yaml", ".yml", ".toml", ".ini", ".r", ".lua", ".pl", ".kt", ".swift", ".vue", ".svelte"}


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
        "http://localhost:3000,http://localhost:5173,http://localhost:8000",
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


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": "markitdown",
        "version": APP_VERSION,
        "max_upload_mb": MAX_UPLOAD_MB,
        "url_engine": {"enabled": True, "max_mb": MAX_URL_MB, "timeout_seconds": URL_TIMEOUT_SECONDS, "max_redirects": URL_MAX_REDIRECTS, "youtube": True},
        "ocr": {"enabled": OCR_ENABLED, "configured": bool(OCR_API_KEY), "model": OCR_MODEL if OCR_ENABLED and OCR_API_KEY else None},
    }


@app.post("/api/convert")
async def convert(file: UploadFile = File(...)):
    filename, suffix = _read_upload(file)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    return _convert_bytes(filename, suffix, data)


@app.post("/api/convert-url")
async def convert_url(payload: dict):
    url = str(payload.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL não informada.")
    if _is_youtube_url(url):
        started = time.perf_counter()
        try:
            result = _engine.convert(url)
            markdown = result.markdown or ""
            if not markdown.strip():
                raise HTTPException(status_code=422, detail="O MarkItDown não encontrou transcrição/conteúdo no vídeo.")
            return {
                "ok": True, "engine": "markitdown-youtube", "url": url, "final_url": url, "markdown": markdown,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                "quality": _quality(markdown),
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Falha ao processar YouTube: {type(exc).__name__}") from exc
    return _convert_remote_url(url)


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
