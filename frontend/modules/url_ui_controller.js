(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIUrlUIController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ urlService, youtubeController, elements, ui = {} } = {}) {
    if (!urlService?.fetch) throw new Error('UrlUIController requires urlService.fetch');
    if (!youtubeController) throw new Error('UrlUIController requires youtubeController');
    if (!elements?.urlInput || !elements?.btnFetchUrl) {
      throw new Error('UrlUIController requires urlInput and btnFetchUrl');
    }

    function getUrl() {
      return elements.urlInput.value.trim();
    }

    function youtubeOptions() {
      return {
        language: elements.youtubeLanguage?.value || 'auto',
        translateTo: elements.youtubeTranslate?.value || null
      };
    }

    async function fetchUrl() {
      const url = getUrl();
      if (!url) {
        ui.toast?.('Digite uma URL válida.', 'warning');
        return null;
      }
      if (!url.startsWith('http')) {
        ui.toast?.('URL deve começar com http:// ou https://', 'warning');
        return null;
      }

      ui.showProcessing?.('Buscando URL…', url);
      ui.setStatus?.('Buscando URL…', 'busy');
      try {
        const markdown = await urlService.fetch(url);
        ui.hideProcessing?.();
        ui.loadMarkdown?.(markdown, 'pagina_web.md');
        ui.setStatus?.('URL carregada', 'idle');
        ui.toast?.('✓ Conteúdo extraído com sucesso!', 'success');
        return markdown;
      } catch (error) {
        ui.hideProcessing?.();
        ui.setStatus?.('Erro na URL', 'error');
        ui.toast?.('Erro: ' + error.message, 'error');
        return null;
      }
    }

    function submit() {
      const url = getUrl();
      if (youtubeController.updateControls(url)) {
        return youtubeController.transcribe(url, youtubeOptions());
      }
      return fetchUrl();
    }

    function transcribeYouTube() {
      return youtubeController.transcribe(getUrl(), youtubeOptions());
    }

    function listYouTubeLanguages() {
      return youtubeController.listLanguages(getUrl());
    }

    function bind() {
      elements.btnFetchUrl.addEventListener('click', submit);
      elements.urlInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') submit();
      });
      elements.urlInput.addEventListener('input', () => youtubeController.updateControls(getUrl()));
      elements.btnYoutubeTranscribe?.addEventListener('click', transcribeYouTube);
      elements.btnYoutubeLanguages?.addEventListener('click', listYouTubeLanguages);
      youtubeController.updateControls(getUrl());
    }

    return { bind, fetchUrl, submit, youtubeOptions, transcribeYouTube, listYouTubeLanguages };
  }

  return { create };
});
