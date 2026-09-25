/**
 * MarkAI Converter — MarkItDown service module
 * Extracted from the legacy controller without changing the public API.
 */
(function (root) {
  'use strict';

  const AppState = root.MarkAICore.AppState;

// ══════════════════════════════════════════════
// 3. MARKITDOWN ENGINE — server-side document conversion
// ══════════════════════════════════════════════
const MarkItDownEngine = (() => {
  let healthCache = { ok: false, at: 0 };

  function _endpoint() {
    const s = AppState.get('settings');
    return (s.markitdownEndpoint || 'http://localhost:8000').replace(/\/$/, '');
  }

  async function isAvailable(force = false) {
    const s = AppState.get('settings');
    if (s.markitdownEnabled === false) return false;
    if (!force && Date.now() - healthCache.at < 30000) return healthCache.ok;

    try {
      const resp = await window.fetch(_endpoint() + '/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(1200),
      });
      healthCache = { ok: resp.ok, at: Date.now() };
    } catch (_) {
      healthCache = { ok: false, at: Date.now() };
    }
    return healthCache.ok;
  }

  async function convert(file, onProgress) {
    if (!(await isAvailable())) return null;

    if (onProgress) onProgress(0.15);
    const form = new FormData();
    form.append('file', file, file.name);

    const resp = await window.fetch(_endpoint() + '/api/convert', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body?.detail || `MarkItDown API error ${resp.status}`);
    }

    const data = await resp.json();
    if (!data?.markdown) throw new Error('MarkItDown retornou conteúdo vazio.');
    if (onProgress) onProgress(1);
    return { markdown: data.markdown, meta: data };
  }

  async function deepExtract(file, onProgress) {
    if (!(await isAvailable(true))) {
      throw new Error('Backend MarkItDown indisponível para leitura profunda.');
    }
    if (onProgress) onProgress(0.05);
    const form = new FormData();
    form.append('file', file, file.name);
    const resp = await window.fetch(_endpoint() + '/api/deep-extract', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(180000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message;
      throw new Error(detail || 'Leitura profunda OCR/IA indisponível.');
    }
    if (!data?.markdown) throw new Error('Leitor OCR/IA retornou conteúdo vazio.');
    if (onProgress) onProgress(1);
    return { markdown: data.markdown, meta: data };
  }

  async function convertUrl(url) {
    if (!(await isAvailable(true))) {
      throw new Error('Backend MarkItDown indisponível. Para converter URLs, inicie o backend local antes da conversão.');
    }

    const resp = await window.fetch(_endpoint() + '/api/convert-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body?.detail || `MarkItDown URL API error ${resp.status}`);
    if (!body?.markdown) throw new Error('Nenhum conteúdo/transcrição foi retornado pelo MarkItDown.');
    return { markdown: body.markdown, meta: body };
  }

  return { isAvailable, convert, deepExtract, convertUrl };
})();



  root.MarkAIConversion = { MarkItDownEngine };
})(typeof globalThis !== 'undefined' ? globalThis : window);
