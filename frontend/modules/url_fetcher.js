(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIUrlService = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

const URLFetcher = (() => {
  async function fetch(url) {
    const normalized = String(url || '').trim();
    if (!normalized) throw new Error('Informe uma URL.');

    try {
      const result = await MarkItDownEngine.convertUrl(normalized);
      return result.markdown;
    } catch (error) {
      const message = error?.message || 'Não foi possível converter a URL.';
      if (/Backend MarkItDown indisponível/i.test(message)) {
        throw new Error('O motor de URLs está offline. Inicie o backend MarkItDown e tente novamente.');
      }
      throw new Error(message);
    }
  }

  function isYouTubeUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host);
    } catch (_) { return false; }
  }

  return { fetch, isYouTubeUrl };
})();



  return URLFetcher;
});