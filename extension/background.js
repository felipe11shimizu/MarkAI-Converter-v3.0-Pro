(function () {
  'use strict';

  const MAX_SESSION_MS = 15 * 60 * 1000;
  const PAYLOAD_LIMIT = 12000;
  const RESPONSE_PREVIEW_LIMIT = 5000;
  const NOISE = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|css)(?:\?|$)|google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|fonts\.(?:googleapis|gstatic)\.com/i;
  const SENSITIVE = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|passwd|senha|token)$/i;
  const BINARY_MIME = /^(image\/|font\/|audio\/|video\/|application\/octet-stream)/i;

  let session = null;
  let timer = null;

  const now = () => Date.now();
  const clip = (value, limit) => {
    if (value == null) return null;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  };
  function redactObject(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(redactObject);
    if (typeof value !== 'object') return value;
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = SENSITIVE.test(key) ? '[REDACTED]' : redactObject(val);
    return out;
  }
  function redactHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers || {})) out[key] = SENSITIVE.test(key) ? '[REDACTED]' : clip(value, 1000);
    return out;
  }
  function isNoise(url = '') { return NOISE.test(String(url)); }
  function sendToPortal(type, payload = {}) {
    if (session?.portalTabId == null) return;
    chrome.tabs.sendMessage(session.portalTabId, { type, payload }).catch(() => {});
  }
  async function attach(tabId) {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
  }
  async function detach(tabId) {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  }
  function pushNetwork(event) {
    if (!session || session.paused || isNoise(event.url)) return;
    session.network.push({
      url: clip(event.url, 2000),
      metodo: event.method || null,
      status: event.status ?? null,
      payload: redactObject(event.payload || null),
      headers: redactHeaders(event.headers || {}),
      response_preview: clip(event.response_preview, RESPONSE_PREVIEW_LIMIT),
      tempo_resposta_ms: event.tempo_resposta_ms ?? null,
      timestamp_epoch_ms: event.timestamp_epoch_ms || now()
    });
    if (session.network.length > 2000) session.network.shift();
  }
  function pushConsole(event) {
    if (!session || session.paused) return;
    session.diagnostics.push({
      tipo_evento: event.tipo_evento,
      timestamp_epoch_ms: event.timestamp_epoch_ms || now(),
      mensagem: clip(event.mensagem, 3000),
      stack: clip(event.stack, 5000)
    });
    if (session.diagnostics.length > 500) session.diagnostics.shift();
  }

  async function finish(reason = 'manual') {
    if (!session) return;
    const finished = session;
    session = null;
    clearTimeout(timer);
    timer = null;
    if (finished.pauseStartedAt) finished.pausedMs += now() - finished.pauseStartedAt;

    const steps = finished.domEvents.map((event, index) => {
      const calls = finished.network
        .filter(n => n.timestamp_epoch_ms >= event.timestamp_epoch_ms && n.timestamp_epoch_ms <= event.timestamp_epoch_ms + 5000)
        .map(n => ({
          url: n.url,
          metodo: n.metodo,
          status: n.status,
          payload: n.payload,
          tempo_resposta_ms: n.tempo_resposta_ms
        }));
      return {
        step_id: index + 1,
        tipo_evento: event.tipo_evento,
        timestamp_relativo_ms: Math.max(0, event.timestamp_epoch_ms - finished.startedAt),
        elemento: event.elemento || null,
        valor_entrada: event.valor_entrada ?? null,
        ...(event.tecla ? { detalhes: { tecla: event.tecla, modificadores: event.modificadores } } : {}),
        chamadas_rede: calls
      };
    });

    const result = {
      metadata: {
        session_id: finished.sessionId,
        timestamp_inicio: new Date(finished.startedAt).toISOString(),
        duracao_total_ms: Math.min(MAX_SESSION_MS, Math.max(0, (finished.endedAt || now()) - finished.startedAt)),
        url_alvo: finished.targetUrl,
        resolucao_tela: finished.viewport,
        motivo_finalizacao: reason,
        versao_schema: '1.0'
      },
      steps,
      diagnostics: finished.diagnostics.map(d => ({
        tipo_evento: d.tipo_evento,
        timestamp_relativo_ms: Math.max(0, d.timestamp_epoch_ms - finished.startedAt),
        mensagem: d.mensagem,
        stack: d.stack
      }))
    };

    await chrome.storage.local.set({ devtrail_last_session: result });
    await detach(finished.targetTabId);
    sendToPortal('DEVTRAIL_SESSION_FINALIZED', { json: result });
    chrome.tabs.sendMessage(finished.targetTabId, { type: 'DEVTRAIL_STOPPED', payload: { reason } }).catch(() => {});
  }

  function start(payload, senderTabId) {
    if (session) finish('restarted');
    const targetTabId = Number.isInteger(payload.targetTabId) ? payload.targetTabId : senderTabId;
    session = {
      sessionId: crypto.randomUUID(),
      startedAt: now(),
      endedAt: null,
      pausedMs: 0,
      pauseStartedAt: null,
      portalTabId: senderTabId,
      targetTabId,
      targetUrl: payload.targetUrl || '',
      viewport: payload.viewport || { largura: null, altura: null },
      domEvents: [],
      network: [],
      diagnostics: [],
      pendingRequests: new Map(),
      paused: false
    };

    chrome.tabs.get(targetTabId).then(tab => {
      if (!session) return;
      session.targetUrl = tab.url || session.targetUrl;
      return chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ['content.js'] });
    }).then(() => attach(targetTabId)).then(() => {
      if (!session) return;
      chrome.tabs.sendMessage(targetTabId, { type: 'DEVTRAIL_CAPTURE_STARTED', payload: { session_id: session.sessionId } }).catch(() => {});
      sendToPortal('DEVTRAIL_CAPTURE_STARTED', {
        session_id: session.sessionId,
        targetTabId,
        targetUrl: session.targetUrl,
        startedAt: session.startedAt
      });
      timer = setTimeout(() => finish('15_min_lock'), MAX_SESSION_MS);
    }).catch(error => {
      sendToPortal('DEVTRAIL_ERROR', { message: error?.message || 'Não foi possível iniciar a captura.' });
      session = null;
    });
  }

  function pause() {
    if (!session || session.paused) return;
    session.paused = true;
    session.pauseStartedAt = now();
    sendToPortal('DEVTRAIL_PAUSED');
  }
  function resume() {
    if (!session || !session.paused) return;
    session.pausedMs += now() - session.pauseStartedAt;
    session.pauseStartedAt = null;
    session.paused = false;
    sendToPortal('DEVTRAIL_RESUMED');
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    const type = message?.type;
    const payload = message?.payload || {};
    if (type === 'DEVTRAIL_PING') {
      chrome.tabs.sendMessage(sender.tab.id, { type: 'DEVTRAIL_READY', payload: { extension: true } }).catch(() => {});
      return;
    }
    if (type === 'DEVTRAIL_LIST_TABS') {
      chrome.tabs.query({}).then(tabs => {
        const safeTabs = tabs.filter(t => /^https?:/i.test(t.url || '')).map(t => ({
          id: t.id,
          title: clip(t.title || t.url || 'Aba', 120),
          url: clip(t.url || '', 500)
        }));
        chrome.tabs.sendMessage(sender.tab.id, { type: 'DEVTRAIL_TABS', payload: { tabs: safeTabs } }).catch(() => {});
      });
      return;
    }
    if (type === 'DEVTRAIL_START') { start(payload, sender.tab.id); return; }
    if (type === 'DEVTRAIL_PAUSE') { pause(); return; }
    if (type === 'DEVTRAIL_RESUME') { resume(); return; }
    if (type === 'DEVTRAIL_STOP') { finish('manual'); return; }
    if (type === 'DEVTRAIL_DOM_EVENT' && session && sender.tab?.id === session.targetTabId) {
      if (session.paused) return;
      session.domEvents.push(payload.event);
      if (session.domEvents.length > 1000) session.domEvents.shift();
    }
  });

  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (!session || source.tabId !== session.targetTabId || session.paused) return;

    if (method === 'Network.requestWillBeSent') {
      const req = params.request || {};
      if (isNoise(req.url)) return;
      session.pendingRequests.set(params.requestId, {
        url: req.url,
        method: req.method,
        payload: redactObject(clip(req.postData || null, PAYLOAD_LIMIT)),
        headers: redactHeaders(req.headers || {}),
        startedAt: now()
      });
      return;
    }

    if (method === 'Network.responseReceived') {
      const req = session.pendingRequests.get(params.requestId);
      const response = params.response || {};
      if (!req || isNoise(response.url || req.url) || BINARY_MIME.test(response.mimeType || '')) return;
      chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId })
        .then(body => pushNetwork({
          url: response.url || req.url,
          method: req.method,
          status: response.status,
          payload: req.payload,
          headers: req.headers,
          response_preview: body?.body || null,
          tempo_resposta_ms: now() - req.startedAt,
          timestamp_epoch_ms: now()
        }))
        .catch(() => pushNetwork({
          url: response.url || req.url,
          method: req.method,
          status: response.status,
          payload: req.payload,
          headers: req.headers,
          response_preview: null,
          tempo_resposta_ms: now() - req.startedAt,
          timestamp_epoch_ms: now()
        }));
      session.pendingRequests.delete(params.requestId);
      return;
    }

    if (method === 'Runtime.consoleAPICalled') {
      const type = params.type || '';
      if (!['error', 'warning'].includes(type)) return;
      const args = (params.args || []).map(arg => arg.value ?? arg.description ?? '[object]').join(' ');
      pushConsole({ tipo_evento: 'console_error', timestamp_epoch_ms: now(), mensagem: args });
      return;
    }

    if (method === 'Runtime.exceptionThrown') {
      const detail = params.exceptionDetails || {};
      pushConsole({
        tipo_evento: 'exception',
        timestamp_epoch_ms: now(),
        mensagem: detail.text || detail.exception?.description || 'JavaScript exception',
        stack: detail.stackTrace?.callFrames?.map(f => f.functionName + '@' + f.url + ':' + f.lineNumber).join('\n')
      });
    }
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    if (session && source.tabId === session.targetTabId) finish('debugger_detached:' + reason);
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    if (session && tabId === session.targetTabId) finish('target_tab_closed');
    else if (session && tabId === session.portalTabId) session.portalTabId = null;
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!session || tabId !== session.targetTabId || !changeInfo.url) return;
    session.targetUrl = tab.url || changeInfo.url || session.targetUrl;
    chrome.tabs.sendMessage(tabId, { type: 'DEVTRAIL_CAPTURE_STARTED', payload: { session_id: session.sessionId } }).catch(() => {});
  });
})();
