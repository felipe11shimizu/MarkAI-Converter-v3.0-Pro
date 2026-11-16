""""Secure, opt-in bridge from MarkAI to the private JARVIS Markdown vault.

The GitHub write credential stays server-side. OAuth identifies the human user;
a short-lived HMAC-signed session is returned only in the redirect fragment.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import unicodedata
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, Header, HTTPException, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/jarvis", tags=["jarvis-bridge"])

GITHUB_API = "https://api.github.com"
TARGET_REPO = "felipe11shimizu/jarvis-segundo-cerebro"
ALLOWED_CATEGORIES = {
    "inbox": "00-Inbox",
    "projetos": "10-Projetos",
    "areas": "20-Areas",
    "colaboradores": "30-Rede-Colaboradores",
    "entidades": "40-Entidades",
    "recursos": "50-Recursos-e-Modelos",
}
MAX_MARKDOWN_BYTES = 100_000
SESSION_TTL_SECONDS = 600
STATE_COOKIE = "markai_jarvis_oauth_state"


def _config(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _require_auth_config() -> tuple[str, str]:
    client_id = _config("JARVIS_GITHUB_OAUTH_CLIENT_ID")
    client_secret = _config("JARVIS_GITHUB_OAUTH_CLIENT_SECRET")
    session_secret = _config("JARVIS_SESSION_SECRET")
    if not client_id or not client_secret or len(session_secret) < 32:
        raise HTTPException(status_code=503, detail="A autenticação do JARVIS ainda não está configurada.")
    return client_id, client_secret


def _sign(value: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), value.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _encode_session(login: str) -> str:
    secret = _config("JARVIS_SESSION_SECRET")
    if len(secret) < 32:
        raise HTTPException(status_code=503, detail="A sessão segura do JARVIS não está configurada.")
    payload = {"login": login, "exp": int(time.time()) + SESSION_TTL_SECONDS, "aud": "markai-jarvis"}
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    return raw + "." + _sign(raw, secret)


def _decode_session(token: str) -> dict:
    secret = _config("JARVIS_SESSION_SECRET")
    try:
        raw, signature = token.split(".", 1)
        if len(secret) < 32 or not hmac.compare_digest(signature, _sign(raw, secret)):
            raise ValueError("signature")
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        if payload.get("aud") != "markai-jarvis" or int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("expired")
        if payload.get("login") != (_config("JARVIS_ALLOWED_GITHUB_LOGIN") or "felipe11shimizu") or not payload.get("login"):
            raise ValueError("user")
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Sessão JARVIS inválida ou expirada.") from exc


def _session_from_header(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Autentique-se com o GitHub para ensinar o JARVIS.")
    return _decode_session(authorization[7:].strip())


def _slug(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title.lower().strip()).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    if not slug:
        raise HTTPException(status_code=422, detail="Informe um título que gere um nome de arquivo válido.")
    return slug[:90].rstrip("-")


def _apply_sensitive_redirect_headers(response: RedirectResponse) -> RedirectResponse:
    """Prevent caching/referrer propagation on OAuth redirects carrying session material."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


class NoteDraft(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    category: str
    content: str = Field(min_length=1, max_length=MAX_MARKDOWN_BYTES)


class NotePublish(NoteDraft):
    confirm_publish: bool


@router.get("/status")
def bridge_status():
    """Expose integration readiness without returning secrets or private credential values."""
    client_id = _config("JARVIS_GITHUB_OAUTH_CLIENT_ID")
    client_secret = _config("JARVIS_GITHUB_OAUTH_CLIENT_SECRET")
    session_secret = _config("JARVIS_SESSION_SECRET")
    callback_url = _config("JARVIS_GITHUB_OAUTH_CALLBACK_URL")
    return {
        "ok": True,
        "repository": TARGET_REPO,
        "authentication_configured": bool(client_id and client_secret and len(session_secret) >= 32 and callback_url),
        "publishing_configured": bool(_config("JARVIS_GITHUB_TOKEN")),
        "requires_user_confirmation": True,
        "max_markdown_bytes": MAX_MARKDOWN_BYTES,
    }


@router.get("/auth/start")
def auth_start():
    client_id, _ = _require_auth_config()
    state = secrets.token_urlsafe(32)
    secret = _config("JARVIS_SESSION_SECRET")
    signed_state = state + "." + _sign(state, secret)
    callback = _config("JARVIS_GITHUB_OAUTH_CALLBACK_URL")
    if not callback:
        raise HTTPException(status_code=503, detail="Configure JARVIS_GITHUB_OAUTH_CALLBACK_URL.")
    params = urlencode({
        "client_id": client_id,
        "redirect_uri": callback,
        "scope": "read:user",
        "state": state,
        "allow_signup": "false",
    })
    response = RedirectResponse("https://github.com/login/oauth/authorize?" + params, status_code=302)
    response.set_cookie(STATE_COOKIE, signed_state, max_age=300, httponly=True, secure=True, samesite="lax", path="/api/jarvis")
    return response


@router.get("/auth/callback")
def auth_callback(code: str, state: str, response: Response, markai_jarvis_oauth_state: str | None = Cookie(default=None)):
    client_id, client_secret = _require_auth_config()
    secret = _config("JARVIS_SESSION_SECRET")
    try:
        cookie_state, cookie_signature = (markai_jarvis_oauth_state or "").split(".", 1)
        if not hmac.compare_digest(cookie_signature, _sign(cookie_state, secret)) or not hmac.compare_digest(cookie_state, state):
            raise ValueError("state")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Validação OAuth state falhou. Tente entrar novamente.") from exc

    callback = _config("JARVIS_GITHUB_OAUTH_CALLBACK_URL")
    try:
        token_response = httpx.post(
            "https://github.com/login/oauth/access_token",
            data={"client_id": client_id, "client_secret": client_secret, "code": code, "redirect_uri": callback},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        token_response.raise_for_status()
        oauth_token = token_response.json().get("access_token")
        if not oauth_token:
            raise ValueError("token")
        user_response = httpx.get(
            GITHUB_API + "/user",
            headers={"Authorization": "Bearer " + oauth_token, "Accept": "application/vnd.github+json"},
            timeout=10,
        )
        user_response.raise_for_status()
        login = user_response.json().get("login")
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Não foi possível validar a identidade no GitHub.") from exc

    allowed_login = _config("JARVIS_ALLOWED_GITHUB_LOGIN") or "felipe11shimizu"
    if login != allowed_login:
        raise HTTPException(status_code=403, detail="Esta conta GitHub não está autorizada a gravar no JARVIS.")

    frontend_origin = _config("JARVIS_FRONTEND_ORIGIN") or "https://felipe11shimizu.github.io/MarkAI-Converter-v3.0-Pro"
    redirect = RedirectResponse(frontend_origin.rstrip("/") + "/#jarvis_session=" + _encode_session(login), status_code=302)
    redirect.delete_cookie(STATE_COOKIE, path="/api/jarvis")
    return _apply_sensitive_redirect_headers(redirect)


@router.get("/auth/status")
def auth_status(authorization: str | None = Header(default=None)):
    session = _session_from_header(authorization)
    return {"ok": True, "login": session["login"], "expires_at": session["exp"]}


@router.post("/notes/preview")
def preview_note(draft: NoteDraft, authorization: str | None = Header(default=None)):
    _session_from_header(authorization)
    category = ALLOWED_CATEGORIES.get(draft.category)
    if not category:
        raise HTTPException(status_code=422, detail="Categoria de destino não permitida.")
    content = draft.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="O Markdown está vazio.")
    if len(content.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise HTTPException(status_code=413, detail="O Markdown excede o limite de 100 KB.")
    path = f"{category}/{_slug(draft.title)}.md"
    return {"ok": True, "repository": TARGET_REPO, "path": path, "bytes": len(content.encode("utf-8")), "requires_confirmation": True}


@router.post("/notes")
def publish_note(note: NotePublish, authorization: str | None = Header(default=None)):
    session = _session_from_header(authorization)
    if note.confirm_publish is not True:
        raise HTTPException(status_code=400, detail="A publicação exige confirmação explícita.")
    category = ALLOWED_CATEGORIES.get(note.category)
    if not category:
        raise HTTPException(status_code=422, detail="Categoria de destino não permitida.")
    content = note.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="O Markdown está vazio.")
    encoded_content = content.encode("utf-8")
    if len(encoded_content) > MAX_MARKDOWN_BYTES:
        raise HTTPException(status_code=413, detail="O Markdown excede o limite de 100 KB.")

    github_token = _config("JARVIS_GITHUB_TOKEN")
    if not github_token:
        raise HTTPException(status_code=503, detail="A credencial de escrita do JARVIS ainda não foi configurada no servidor.")
    path = f"{category}/{_slug(note.title)}.md"
    headers = {
        "Authorization": "Bearer " + github_token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    api_url = f"{GITHUB_API}/repos/{TARGET_REPO}/contents/{path}"
    try:
        with httpx.Client(timeout=15, headers=headers) as client:
            existing = client.get(api_url)
            if existing.status_code == 200:
                raise HTTPException(status_code=409, detail="Já existe uma nota com esse nome. Altere o título para evitar sobrescrita.")
            if existing.status_code not in (404,):
                existing.raise_for_status()
            body = {
                "message": f"JARVIS: registrar nota '{note.title.strip()}' via MarkAI",
                "content": base64.b64encode(encoded_content).decode("ascii"),
                "branch": _config("JARVIS_GITHUB_BRANCH") or "main",
            }
            created = client.put(api_url, json=body)
            if created.status_code == 409:
                raise HTTPException(status_code=409, detail="Conflito ao criar a nota. Atualize e tente novamente.")
            created.raise_for_status()
            result = created.json()
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Falha ao gravar a nota no GitHub. Nenhum conteúdo adicional foi registrado nos logs.") from exc

    return {
        "ok": True,
        "repository": TARGET_REPO,
        "path": path,
        "url": result.get("content", {}).get("html_url"),
        "commit": result.get("commit", {}).get("sha"),
        "created_by": session["login"],
    }
