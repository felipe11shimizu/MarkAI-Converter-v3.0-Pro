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

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown

APP_VERSION = "3.1.0"
MAX_UPLOAD_MB = int(os.getenv("MARKAI_MAX_UPLOAD_MB", "100"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

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

_engine = MarkItDown()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": "markitdown",
        "version": APP_VERSION,
        "max_upload_mb": MAX_UPLOAD_MB,
    }


@app.post("/api/convert")
async def convert(file: UploadFile = File(...)):
    filename = Path(file.filename or "documento").name
    suffix = Path(filename).suffix.lower()

    if not suffix:
        raise HTTPException(status_code=400, detail="Arquivo sem extensão.")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Arquivo excede o limite de {MAX_UPLOAD_MB} MB.",
        )

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="markai_", suffix=suffix, delete=False
        ) as tmp:
            tmp.write(data)
            temp_path = Path(tmp.name)

        result = _engine.convert(str(temp_path))
        markdown = result.markdown or ""

        if not markdown.strip():
            raise HTTPException(
                status_code=422,
                detail="O MarkItDown não retornou conteúdo Markdown.",
            )

        return {
            "ok": True,
            "engine": "markitdown",
            "filename": filename,
            "markdown": markdown,
        }
    except HTTPException:
        raise
    except Exception as exc:
        # Do not expose local paths or internal tracebacks to clients.
        raise HTTPException(
            status_code=422,
            detail=f"Falha na conversão de {filename}: {type(exc).__name__}",
        ) from exc
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)
