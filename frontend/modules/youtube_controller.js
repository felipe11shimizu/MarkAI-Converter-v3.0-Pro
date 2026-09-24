(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIYouTubeController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ urlService, getSettings, ui = {}, fetchImpl = globalThis.fetch, timeoutMs = 120000 }) {
    if (!urlService?.isYouTubeUrl) throw new Error('YouTubeController requires urlService');
    if (typeof getSettings !== 'function') throw new Error('YouTubeController requires getSettings');

    const request = async (path, payload, timeout = timeoutMs) => {
      const settings = getSettings() || {};
      const endpoint = (settings.markitdownEndpoint || 'http://localhost:8000').replace(/\/$/, '');
      let response;
      try {
        response = await fetchImpl(endpoint + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout)
        });
      } catch (error) {
        const reason = error?.name === 'AbortError' || /timeout/i.test(error?.message || '')
          ? 'tempo limite excedido'
          : 'conexão recusada';
        throw new Error('Backend MarkItDown indisponível em ' + endpoint + ' (' + reason + '). Verifique o endpoint em Configurações.');
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof body.detail === 'object'
          ? (body.detail.message || body.detail.code)
          : body.detail;
        throw new Error(detail || ('Falha HTTP ' + response.status));
      }
      return body;
    };

    function isYouTubeUrl(url) {
      return urlService.isYouTubeUrl(String(url || '').trim());
    }

    function languagePriority(selected = 'auto') {
      if (selected === 'auto') return ['pt-BR', 'pt', 'en', 'es'];
      return [selected, 'pt-BR', 'pt', 'en', 'es']
        .filter((value, index, array) => array.indexOf(value) === index);
    }

    function updateControls(url) {
      const valid = isYouTubeUrl(url);
      ui.setControlsVisible?.(valid);
      if (valid) ui.setStatusText?.('YouTube detectado. A transcrição utiliza timestamps e informa se a legenda é manual ou automática.');
      return valid;
    }

    async function transcribe(url, options = {}) {
      const normalized = String(url || '').trim();
      if (!isYouTubeUrl(normalized)) {
        ui.toast?.('Informe uma URL válida do YouTube.', 'warning');
        return null;
      }
      ui.showProcessing?.('Transcrevendo YouTube…', normalized);
      ui.setStatus?.('Transcrevendo YouTube…', 'busy');
      ui.setStatusText?.('Consultando legendas disponíveis.');
      try {
        const body = await request('/api/youtube/transcribe', {
          url: normalized,
          languages: languagePriority(options.language || 'auto'),
          translate_to: options.translateTo || null,
          preserve_formatting: false
        });
        ui.loadMarkdown?.(body.markdown, 'youtube_' + (body.video_id || 'video') + '_transcricao.md');
        ui.setStatus?.('Transcrição do YouTube concluída', 'idle');
        const origin = body.is_generated ? 'legenda automática' : 'legenda manual';
        const quality = body.quality || {};
        ui.setStatusText?.(
          origin + ' · ' + (body.language_code || 'idioma desconhecido') +
          ' · ' + (quality.segments || 0) + ' segmentos · ' +
          (quality.words || 0) + ' palavras'
        );
        ui.toast?.('✓ Transcrição do YouTube concluída!', 'success');
        return body;
      } catch (error) {
        ui.setStatus?.('Erro na transcrição YouTube', 'error');
        ui.setStatusText?.('Falha: ' + (error.message || 'erro desconhecido'));
        ui.toast?.('Erro no YouTube: ' + error.message, 'error');
        return null;
      } finally {
        ui.hideProcessing?.();
      }
    }

    async function listLanguages(url) {
      const normalized = String(url || '').trim();
      if (!isYouTubeUrl(normalized)) {
        ui.toast?.('Informe uma URL válida do YouTube.', 'warning');
        return null;
      }
      try {
        const body = await request('/api/youtube/transcripts', { url: normalized }, 30000);
        const labels = (body.transcripts || []).map(item => {
          const type = item.is_generated ? 'automática' : 'manual';
          const translatable = item.is_translatable ? ' · traduzível' : '';
          return item.language + ' (' + item.language_code + ') — ' + type + translatable;
        });
        ui.setStatusText?.(labels.length
          ? 'Legendas disponíveis: ' + labels.join(' · ')
          : 'Nenhuma faixa de legenda encontrada.');
        return body;
      } catch (error) {
        ui.setStatusText?.('Não foi possível listar as legendas: ' + error.message);
        ui.toast?.('Erro ao consultar idiomas: ' + error.message, 'error');
        return null;
      }
    }

    async function analyze(url, options = {}) {
      const normalized = String(url || '').trim();
      if (!isYouTubeUrl(normalized)) {
        ui.toast?.('Informe uma URL do YouTube antes de analisar o processo.', 'warning');
        return null;
      }
      ui.analyze?.(normalized, options);
      return null;
    }

    return { isYouTubeUrl, languagePriority, updateControls, transcribe, listLanguages, analyze };
  }

  return { create };
});
