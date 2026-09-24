(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailController = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_SESSION_MS = 15 * 60 * 1000;
  function create({ elements, formatters, windowObj = globalThis.window, documentObj = globalThis.document, clock = () => Date.now(), setIntervalImpl = globalThis.setInterval, clearIntervalImpl = globalThis.clearInterval, setTimeoutImpl = globalThis.setTimeout }) {
    let state = { status: 'idle', startedAt: null, json: null, markdown: '', area: null, analysis: null, quality: null, readiness: null };
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
      if (elements.area) elements.area.disabled = !elements.target?.value || ['starting', 'recording', 'paused'].includes(state.status);
      if (elements.areaClear) elements.areaClear.disabled = !state.area || ['starting', 'recording', 'paused'].includes(state.status);
      if (elements.areaStatus) elements.areaStatus.textContent = state.area ? `Área: ${Math.round(state.area.width)}×${Math.round(state.area.height)} px em (${Math.round(state.area.x)}, ${Math.round(state.area.y)})` : 'Área: página inteira';
      if (elements.exportJson) elements.exportJson.disabled = !state.json;
      if (elements.exportMd) elements.exportMd.disabled = !state.json;
      if (elements.exportPackage) elements.exportPackage.disabled = !state.json;
      if (elements.json) elements.json.value = state.json ? JSON.stringify(state.json, null, 2) : '';
      if (elements.markdown) elements.markdown.value = state.markdown || '';
    }
    function handleMessage(event) {
      if (event.source !== windowObj || event.data?.source !== 'markai-devtrail') return;
      const type = event.data.type, payload = event.data.payload || {};
      if (type === 'DEVTRAIL_READY') { if (elements.extensionStatus) elements.extensionStatus.textContent = payload.extension ? 'Extensão conectada' : 'Aguardando extensão'; }
      else if (type === 'DEVTRAIL_TABS') {
        const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
        if (elements.target) {
          elements.target.replaceChildren();
          tabs.forEach(tab => {
            const option = documentObj.createElement('option');
            option.value = String(tab.id);
            option.dataset.url = tab.url || '';
            option.textContent = (tab.title || 'Aba') + ' — ' + (tab.url || '');
            elements.target.appendChild(option);
          });
          if (tabs.length && !elements.target.value) elements.target.value = String(tabs[0].id);
        }
        if (elements.extensionStatus) {
          elements.extensionStatus.textContent = tabs.length
            ? 'Extensão conectada · ' + tabs.length + ' aba(s) HTTP/HTTPS encontrada(s).'
            : 'Extensão conectada · nenhuma aba HTTP/HTTPS encontrada.';
        }
        render();
      }
      else if (type === 'DEVTRAIL_STATUS') {
        if (elements.extensionStatus) elements.extensionStatus.textContent = payload.message || 'Extensão conectada.';
      } else if (type === 'DEVTRAIL_CAPTURE_STARTED') { state.status = 'recording'; state.startedAt = payload.startedAt || clock(); state.json = null; state.markdown = ''; if (!ticker) ticker = setIntervalImpl(render, 250); render();
      } else if (type === 'DEVTRAIL_PAUSED') { state.status = 'paused'; render();
      } else if (type === 'DEVTRAIL_RESUMED') { state.status = 'recording'; render();
      } else if (type === 'DEVTRAIL_SESSION_FINALIZED') { state.json = payload.json || null; state.markdown = state.json ? formatters.convertJsonToMarkdown(state.json) : ''; if (state.json && globalThis.MarkAIDevTrailAnalyzer?.analyze) { const analysis = globalThis.MarkAIDevTrailAnalyzer.analyze(state.json); state.analysis = analysis; state.markdown += '\n' + globalThis.MarkAIDevTrailAnalyzer.convertToMarkdown(analysis); let specification = null; if (globalThis.MarkAIDevTrailSpecification?.generate) { specification = globalThis.MarkAIDevTrailSpecification.generate(state.json, analysis); state.markdown += '\n' + globalThis.MarkAIDevTrailSpecification.convertToMarkdown(specification); } if (globalThis.MarkAIDevTrailQuality?.analyze) { const quality = globalThis.MarkAIDevTrailQuality.analyze(state.json, analysis); state.quality = quality; state.markdown += '\n' + globalThis.MarkAIDevTrailQuality.convertToMarkdown(quality); if (globalThis.MarkAIDevTrailReadiness?.generate) { const readiness = globalThis.MarkAIDevTrailReadiness.generate(state.json, analysis, quality, specification); state.readiness = readiness; state.markdown += '\n' + globalThis.MarkAIDevTrailReadiness.convertToMarkdown(readiness); } } } state.status = 'finalized'; if (ticker) { clearIntervalImpl(ticker); ticker = null; } render();
      } else if (type === 'DEVTRAIL_AREA_SELECTED') { state.area = payload.area || null; render(); }
      else if (type === 'DEVTRAIL_AREA_CLEARED') { state.area = null; render(); }
      else if (type === 'DEVTRAIL_ERROR') { state.status = 'error'; if (ticker) { clearIntervalImpl(ticker); ticker = null; } if (elements.extensionStatus) elements.extensionStatus.textContent = payload.message || 'Erro na extensão'; render(); }
    }
    function start() {
      if (!elements.target?.value) { if (elements.extensionStatus) elements.extensionStatus.textContent = 'Nenhuma aba HTTP/HTTPS disponível.'; return; }
      state.status = 'starting'; state.json = null; state.markdown = ''; render();
      const option = elements.target.selectedOptions?.[0];
      emit('DEVTRAIL_START', { targetTabId: Number(elements.target.value), targetUrl: option?.dataset?.url || '', viewport: { largura: windowObj.innerWidth, altura: windowObj.innerHeight } });
    }
    function pauseResume() { emit(state.status === 'paused' ? 'DEVTRAIL_RESUME' : 'DEVTRAIL_PAUSE'); }
    function pickArea() {
      if (!elements.target?.value) { if (elements.extensionStatus) elements.extensionStatus.textContent = 'Atualize as abas e selecione uma aba alvo primeiro.'; return; }
      emit('DEVTRAIL_PICK_AREA', { targetTabId: Number(elements.target.value) });
    }
    function clearArea() {
      const targetTabId = Number(elements.target?.value);
      emit('DEVTRAIL_CLEAR_AREA', Number.isInteger(targetTabId) ? { targetTabId } : {});
      state.area = null;
      render();
    }
    function stop() { emit('DEVTRAIL_STOP'); }
    function refreshTabs() { emit('DEVTRAIL_LIST_TABS'); }
    function bind() {
      windowObj.addEventListener('message', handleMessage);
      elements.start?.addEventListener('click', start); elements.pause?.addEventListener('click', pauseResume); elements.stop?.addEventListener('click', stop); elements.refresh?.addEventListener('click', refreshTabs); elements.area?.addEventListener('click', pickArea); elements.areaClear?.addEventListener('click', clearArea);
      elements.exportJson?.addEventListener('click', () => state.json && download('devtrail-session.json', JSON.stringify(state.json, null, 2), 'application/json;charset=utf-8'));
      elements.exportMd?.addEventListener('click', () => state.markdown && download('devtrail-session.md', state.markdown, 'text/markdown;charset=utf-8'));
      elements.exportPackage?.addEventListener('click', () => { if (!state.json || !globalThis.MarkAIDevTrailPackage?.build) return; const pkg = globalThis.MarkAIDevTrailPackage.build(state.json, state.analysis, state.quality, globalThis.MarkAIDevTrailSpecification?.generate ? globalThis.MarkAIDevTrailSpecification.generate(state.json, state.analysis) : null, state.readiness); download('devtrail-rpa-package.json', JSON.stringify(pkg, null, 2), 'application/json;charset=utf-8'); });
      elements.tabMarkdown?.addEventListener('click', () => {
        if (elements.markdown) elements.markdown.hidden = false;
        if (elements.json) elements.json.hidden = true;
        elements.tabMarkdown?.classList.add('active');
        elements.tabJson?.classList.remove('active');
      });
      elements.tabJson?.addEventListener('click', () => {
        if (elements.markdown) elements.markdown.hidden = true;
        if (elements.json) elements.json.hidden = false;
        elements.tabJson?.classList.add('active');
        elements.tabMarkdown?.classList.remove('active');
      });
      render(); emit('DEVTRAIL_PING'); refreshTabs();
    }
    return { bind, refreshTabs, getState: () => ({ ...state }) };
  }
  return { create };
});