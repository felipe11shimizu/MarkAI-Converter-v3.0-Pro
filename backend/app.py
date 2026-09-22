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
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown

APP_VERSION = "3.2.0"
MAX_UPLOAD_MB = max(1, int(os.getenv("MARKAI_MAX_UPLOAD_MB", "100")))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
OCR_ENABLED = os.getenv("MARKAI_OCR_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
OCR_MODEL = os.getenv("MARKAI_OCR_MODEL", "gpt-4o")
OCR_API_KEY = os.getenv("MARKAI_OCR_API_KEY") or os.getenv("OPENAI_API_KEY")

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
        "ocr": {"enabled": OCR_ENABLED, "configured": bool(OCR_API_KEY), "model": OCR_MODEL if OCR_ENABLED and OCR_API_KEY else None},
    }


@app.post("/api/convert")
async def convert(file: UploadFile = File(...)):
    filename = Path(file.filename or "documento").name
    suffix = Path(filename).suffix.lower()

    if not suffix:
        raise HTTPException(status_code=400, detail="Arquivo sem extensão.")
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Extensão não habilitada: {suffix}")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Arquivo excede o limite de {MAX_UPLOAD_MB} MB.",
        )

    temp_path: Path | None = None
    started = time.perf_counter()
    try:
        with tempfile.NamedTemporaryFile(
            prefix="markai_", suffix=suffix, delete=False
        ) as tmp:
            tmp.write(data)
            temp_path = Path(tmp.name)

        result = _engine.convert_local(str(temp_path))
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
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "quality": {"characters": len(markdown), "lines": len(markdown.splitlines()), "headings": sum(1 for line in markdown.splitlines() if line.lstrip().startswith("#")), "table_lines": sum(1 for line in markdown.splitlines() if "|" in line), "links": markdown.count("](")},
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


@app.post("/api/convert-batch")
async def convert_batch(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo recebido.")
    results = []
    for file in files:
        try:
            filename, suffix, data = _read_upload(file)
            results.append(_convert_bytes(filename, suffix, data))
        except HTTPException as exc:
            results.append({"ok": False, "filename": Path(file.filename or "documento").name, "error": exc.detail, "status_code": exc.status_code})
    return {"ok": all(item.get("ok") for item in results), "engine": "markitdown", "total": len(results), "successful": sum(1 for item in results if item.get("ok")), "failed": sum(1 for item in results if not item.get("ok")), "results": results}
