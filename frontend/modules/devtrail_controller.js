(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_SESSION_MS = 15 * 60 * 1000;
  function create({ elements, formatters, windowObj = globalThis.window, documentObj = globalThis.document, clock = () => Date.now(), setIntervalImpl = globalThis.setInterval, clearIntervalImpl = globalThis.clearInterval, setTimeoutImpl = globalThis.setTimeout }) {
    let state = { status: 'idle', startedAt: null, json: null, markdown: '' };
    let ticker = null;
    function emit(type, payload = {}) { windowObj.postMessage({ source: 'markai-devtrail', type, payload }, '*'); }
    function download(filename, content, type) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = documentObj.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeoutImpl(() => URL.revokeObjectURL(url), 1000); }
    function render() {
      const elapsed = state.startedAt ? Math.max(0, clock() - state.startedAt) : 0;
      const remaining = Math.max(0, MAX_SESSION_MS - elapsed);
      if (elements.timer) { const sec = Math.ceil(remaining / 1000); elements.timer.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
      if (elements.status) elements.status.textContent = ({ idle: 'Pronto', starting: 'Iniciando', recording: 'Gravando telemetria', paused: 'Pausado', finalized: 'Finalizado', error: 'Erro' })[state.status] || state.status;
      if (elements.start) elements.start.disabled = ['starting', 'recording', 'paused'].includes(state.status);
      if (elements.pause) { elements.pause.disabled = !['recording', 'paused'].includes(state.status); elements.pause.textContent = state.status === 'paused' ? 'Retomar' : 'Pausar'; }
      if (elements.stop) elements.stop.disabled = !['recording', 'paused'].includes(state.status);
      if (elements.exportJson) elements.exportJson.disabled = !state.json;
      if (elements.exportMd) elements.exportMd.disabled = !state.json;
      if (elements.json) elements.json.value = state.json ? JSON.stringify(state.json, null, 2) : '';
      if (elements.markdown) elements.markdown.value = state.markdown || '';
    }
    function handleMessage(event) {
      if (event.source !== windowObj || event.data?.source !== 'markai-devtrail') return;
      const type = event.data.type, payload = event.data.payload || {};
      if (type === 'DEVTRAIL_READY') { if (elements.extensionStatus) elements.extensionStatus.textContent = payload.extension ? 'Extensão conectada' : 'Aguardando extensão'; }
      else if (type === 'DEVTRAIL_TABS') {
        const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
        if (elements.target) { elements.target.replaceChildren(); tabs.forEach(tab => { const option = documentObj.createElement('option'); option.value = String(tab.id); option.dataset.url = tab.url || ''; option.textContent = (tab.title || 'Aba') + ' — ' + (tab.url || ''); elements.target.appendChild(option); }); }
      } else if (type === 'DEVTRAIL_CAPTURE_STARTED') { state.status = 'recording'; state.startedAt = payload.startedAt || clock(); state.json = null; state.markdown = ''; if (!ticker) ticker = setIntervalImpl(render, 250); render();
      } else if (type === 'DEVTRAIL_PAUSED') { state.status = 'paused'; render();
      } else if (type === 'DEVTRAIL_RESUMED') { state.status = 'recording'; render();
      } else if (type === 'DEVTRAIL_SESSION_FINALIZED') { state.json = payload.json || null; state.markdown = state.json ? formatters.convertJsonToMarkdown(state.json) : ''; state.status = 'finalized'; if (ticker) { clearIntervalImpl(ticker); ticker = null; } render();
      } else if (type === 'DEVTRAIL_ERROR') { state.status = 'error'; if (ticker) { clearIntervalImpl(ticker); ticker = null; } if (elements.extensionStatus) elements.extensionStatus.textContent = payload.message || 'Erro na extensão'; render(); }
    }
    function start() {
      if (!elements.target?.value) { if (elements.extensionStatus) elements.extensionStatus.textContent = 'Nenhuma aba HTTP/HTTPS disponível.'; return; }
      state.status = 'starting'; state.json = null; state.markdown = ''; render();
      const option = elements.target.selectedOptions?.[0];
      emit('DEVTRAIL_START', { targetTabId: Number(elements.target.value), targetUrl: option?.dataset?.url || '', viewport: { largura: windowObj.innerWidth, altura: windowObj.innerHeight } });
    }
    function pauseResume() { emit(state.status === 'paused' ? 'DEVTRAIL_RESUME' : 'DEVTRAIL_PAUSE'); }
    function stop() { emit('DEVTRAIL_STOP'); }
    function refreshTabs() { emit('DEVTRAIL_LIST_TABS'); }
    function bind() {
      windowObj.addEventListener('message', handleMessage);
      elements.start?.addEventListener('click', start); elements.pause?.addEventListener('click', pauseResume); elements.stop?.addEventListener('click', stop); elements.refresh?.addEventListener('click', refreshTabs);
      elements.exportJson?.addEventListener('click', () => state.json && download('devtrail-session.json', JSON.stringify(state.json, null, 2), 'application/json;charset=utf-8'));
      elements.exportMd?.addEventListener('click', () => state.markdown && download('devtrail-session.md', state.markdown, 'text/markdown;charset=utf-8'));
      render(); emit('DEVTRAIL_PING'); refreshTabs();
    }
    return { bind, refreshTabs, getState: () => ({ ...state }) };
  }
  return { create };
});