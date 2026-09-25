importScripts('autonomous_agent.js');
const devTrailAutonomousAgent = globalThis.DevTrailAutonomousAgent?.(chrome);
devTrailAutonomousAgent?.install?.();

importScripts('explorer/explorer_policy.js', 'explorer/explorer_state.js', 'explorer/explorer_engine.js');

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
  let explorerSession = null;
  const explorerEngine = globalThis.MarkAIDevTrailExplorerEngine.create({
    policy: globalThis.MarkAIDevTrailExplorerPolicy,
    stateFactory: globalThis.MarkAIDevTrailExplorerState
  });
  const pendingAreas = new Map();
  const portalByTargetTab = new Map();

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
  function sendToTab(tabId, type, payload = {}) {
    if (tabId == null) return Promise.resolve(false);
    return chrome.tabs.sendMessage(tabId, { type, payload })
      .then(() => true)
      .catch(() => false);
  }
  function sendToPortal(type, payload = {}, portalTabId = session?.portalTabId) {
    return sendToTab(portalTabId, type, payload);
  }
  async function ensureContentScript(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:/i.test(tab.url || '')) return false;
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return true;
    } catch (_) { return false; }
  }

  async function injectIntoOpenWebTabs() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter(t => /^https?:/i.test(t.url || '')).map(t => ensureContentScript(t.id)));
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
  async function captureVisualEvidence() {
    if (!session || session.paused || !session.area || session.visualCaptures.length >= 30) return;
    const nowMs = now();
    if (nowMs - session.lastVisualCaptureAt < 700) return;
    session.lastVisualCaptureAt = nowMs;
    const area = session.area;
    const clipRect = {
      x: Math.max(0, Number(area.x) || 0),
      y: Math.max(0, Number(area.y) || 0),
      width: Math.max(20, Number(area.width) || 20),
      height: Math.max(20, Number(area.height) || 20),
      scale: 1
    };
    try {
      const result = await chrome.debugger.sendCommand({ tabId: session.targetTabId }, 'Page.captureScreenshot', { format: 'jpeg', quality: 55, clip: clipRect, captureBeyondViewport: false });
      if (result?.data) session.visualCaptures.push({ timestamp_epoch_ms: nowMs, formato: 'image/jpeg', qualidade: 55, imagem_base64: result.data });
    } catch (_) {}
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
        versao_schema: '1.1'
      },
      steps,
      area_captura: finished.area || null,
      capturas_visuais: finished.visualCaptures.map(c => ({
        timestamp_relativo_ms: Math.max(0, c.timestamp_epoch_ms - finished.startedAt),
        formato: c.formato,
        qualidade: c.qualidade,
        imagem_base64: c.imagem_base64
      })),
      diagnostics: finished.diagnostics.map(d => ({
        tipo_evento: d.tipo_evento,
        timestamp_relativo_ms: Math.max(0, d.timestamp_epoch_ms - finished.startedAt),
        mensagem: d.mensagem,
        stack: d.stack
      }))
    };

    await chrome.storage.local.set({ devtrail_last_session: result });
    await detach(finished.targetTabId);
    if (finished.portalTabId != null) {
      chrome.tabs.sendMessage(finished.portalTabId, {
        type: 'DEVTRAIL_SESSION_FINALIZED',
        payload: { json: result }
      }).catch(() => {});
    }
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
      area: pendingAreas.get(targetTabId) || null,
      visualCaptures: [],
      lastVisualCaptureAt: 0,
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
        area: session.area,
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

  chrome.runtime.onInstalled.addListener(() => { injectIntoOpenWebTabs().catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { injectIntoOpenWebTabs().catch(() => {}); });

  chrome.runtime.onMessage.addListener((message, sender) => {
    const type = message?.type;
    const payload = message?.payload || {};
    if (type === 'DEVTRAIL_PING' || type === 'DEVTRAIL_CONTENT_READY') {
      sendToPortal('DEVTRAIL_READY', {
        extension: true,
        tabId: sender.tab?.id ?? null,
        page: payload.page || null,
        reason: type
      }, sender.tab?.id);
      return;
    }
    if (type === 'DEVTRAIL_LIST_TABS') {
      const portalTabId = sender.tab?.id;
      chrome.tabs.query({}).then(async tabs => {
        const webTabs = tabs.filter(t => /^https?:/i.test(t.url || '') && t.id != null);
        const results = await Promise.all(webTabs.map(async t => ({
          tab: t,
          injected: await ensureContentScript(t.id)
        })));
        const safeTabs = results.map(({ tab, injected }) => {
          portalByTargetTab.set(tab.id, portalTabId);
          return {
            id: tab.id,
            title: clip(tab.title || tab.url || 'Aba', 120),
            url: clip(tab.url || '', 500),
            ready: injected || tab.id === portalTabId
          };
        });
        await sendToPortal('DEVTRAIL_TABS', {
          tabs: safeTabs,
          portalTabId,
          total: safeTabs.length,
          timestamp_epoch_ms: now()
        }, portalTabId);
        await sendToPortal('DEVTRAIL_STATUS', {
          extension: true,
          message: safeTabs.length
            ? safeTabs.length + ' aba(s) HTTP/HTTPS encontrada(s).'
            : 'Nenhuma aba HTTP/HTTPS disponível para o DevTrail.'
        }, portalTabId);
      }).catch(error => {
        sendToPortal('DEVTRAIL_ERROR', {
          message: 'Falha ao listar abas: ' + (error?.message || 'erro desconhecido')
        }, portalTabId);
      });
      return;
    }
    if (type === 'DEVTRAIL_AREA_SELECTED') {
      const area = payload.area || null;
      const targetTabId = sender.tab?.id;
      if (area && Number(area.width) > 0 && Number(area.height) > 0 && targetTabId != null) {
        pendingAreas.set(targetTabId, area);
        if (session && session.targetTabId === targetTabId) session.area = area;
        sendToPortal('DEVTRAIL_AREA_SELECTED', { area, targetTabId }, session?.targetTabId === targetTabId ? session.portalTabId : portalByTargetTab.get(targetTabId));
      }
      return;
    }
    if (type === 'DEVTRAIL_CLEAR_AREA') {
      const requestedTarget = Number(payload.targetTabId);
      const targetTabId = Number.isInteger(requestedTarget) ? requestedTarget : sender.tab?.id;
      const portalTabId = session?.targetTabId === targetTabId ? session.portalTabId : (sender.tab?.id === targetTabId ? portalByTargetTab.get(targetTabId) : sender.tab?.id);
      if (targetTabId != null) pendingAreas.delete(targetTabId);
      if (session && session.targetTabId === targetTabId) session.area = null;
      if (sender.tab?.id !== targetTabId) sendToTab(targetTabId, 'DEVTRAIL_CLEAR_AREA', { targetTabId });
      sendToPortal('DEVTRAIL_AREA_CLEARED', { targetTabId }, portalTabId);
      return;
    }
    if (type === 'DEVTRAIL_PICK_AREA') {
      const targetTabId = Number(payload.targetTabId);
      const portalTabId = sender.tab?.id;
      if (!Number.isInteger(targetTabId)) return;
      portalByTargetTab.set(targetTabId, portalTabId);
      ensureContentScript(targetTabId).then(ok => {
        if (!ok) {
          sendToPortal('DEVTRAIL_ERROR', { message: 'Não foi possível preparar a aba selecionada para definir a área.' }, portalTabId);
          return;
        }
        sendToTab(targetTabId, 'DEVTRAIL_PICK_AREA', { targetTabId });
      });
      return;
    }
    if (type === 'DEVTRAIL_CLEAR_AREA_FROM_PORTAL') {
      const targetTabId = Number(payload.targetTabId);
      const portalTabId = sender.tab?.id;
      if (!Number.isInteger(targetTabId)) return;
      pendingAreas.delete(targetTabId);
      sendToTab(targetTabId, 'DEVTRAIL_CLEAR_AREA', { targetTabId });
      sendToPortal('DEVTRAIL_AREA_CLEARED', { targetTabId }, portalTabId);
      return;
    }
    if (type === 'DEVTRAIL_EXPLORER_START') {
      if (explorerSession) {
        sendToPortal('DEVTRAIL_EXPLORER_ERROR', { message: 'Já existe uma exploração ativa.' }, sender.tab?.id);
        return;
      }
      const targetTabId = Number(payload.targetTabId);
      if (!Number.isInteger(targetTabId)) {
        sendToPortal('DEVTRAIL_EXPLORER_ERROR', { message: 'Aba alvo inválida para exploração.' }, sender.tab?.id);
        return;
      }
      const policy = globalThis.MarkAIDevTrailExplorerPolicy.normalize(payload.policy || {});
      explorerSession = explorerEngine.start({
        portalTabId: sender.tab?.id ?? null,
        targetTabId,
        policy
      });
      explorerSession.status = 'running';
      explorerSession.timer = setTimeout(() => {
        if (!explorerSession) return;
        const result = explorerEngine.finish(explorerSession, 'max_duration');
        explorerSession = null;
        sendToPortal('DEVTRAIL_EXPLORER_FINISHED', { result }, result.portal_tab_id);
      }, policy.maxDurationMs);
      sendToTab(targetTabId, 'DEVTRAIL_EXPLORER_STARTED', {
        session_id: explorerSession.sessionId,
        policy
      });
      sendToPortal('DEVTRAIL_EXPLORER_STATUS', {
        status: 'running',
        session_id: explorerSession.sessionId,
        targetTabId,
        policy
      }, explorerSession.portalTabId);
      return;
    }
    if (type === 'DEVTRAIL_EXPLORER_STOP') {
      if (!explorerSession) return;
      clearTimeout(explorerSession.timer);
      const result = explorerEngine.finish(explorerSession, 'manual');
      explorerSession = null;
      sendToPortal('DEVTRAIL_EXPLORER_FINISHED', { result }, result.portal_tab_id);
      return;
    }
    if (type === 'DEVTRAIL_EXPLORER_STATUS') {
      if (!explorerSession) {
        sendToPortal('DEVTRAIL_EXPLORER_STATUS', { status: 'idle' }, sender.tab?.id);
        return;
      }
      sendToPortal('DEVTRAIL_EXPLORER_STATUS', {
        status: explorerSession.status,
        session_id: explorerSession.sessionId,
        targetTabId: explorerSession.targetTabId,
        pages: explorerSession.pages.length,
        actions: explorerSession.actions.length
      }, explorerSession.portalTabId);
      return;
    }
    if (type === 'DEVTRAIL_EXPLORER_PAGE') {
      if (!explorerSession || sender.tab?.id !== explorerSession.targetTabId) return;
      const accepted = explorerEngine.recordPage(explorerSession, payload.page || {});
      if (!accepted) return;
      sendToPortal('DEVTRAIL_EXPLORER_PAGE', {
        page: payload.page,
        pages: explorerSession.pages.length
      }, explorerSession.portalTabId);
      return;
    }
    if (type === 'DEVTRAIL_EXPLORER_ACTION') {
      if (!explorerSession || sender.tab?.id !== explorerSession.targetTabId) return;
      const accepted = explorerEngine.recordAction(explorerSession, payload.action || {});
      if (!accepted) return;
      sendToPortal('DEVTRAIL_EXPLORER_ACTION', {
        action: payload.action,
        actions: explorerSession.actions.length
      }, explorerSession.portalTabId);
      return;
    }
    if (type === 'DEVTRAIL_START') { start(payload, sender.tab.id); return; }
    if (type === 'DEVTRAIL_PAUSE') { pause(); return; }
    if (type === 'DEVTRAIL_RESUME') { resume(); return; }
    if (type === 'DEVTRAIL_STOP') { finish('manual'); return; }
    if (type === 'DEVTRAIL_DOM_EVENT' && session && sender.tab?.id === session.targetTabId) {
      if (session.paused) return;
      session.domEvents.push(payload.event);
      captureVisualEvidence();
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
    portalByTargetTab.forEach((portalTabId, targetTabId) => {
      if (targetTabId === tabId || portalTabId === tabId) portalByTargetTab.delete(targetTabId);
    });
    pendingAreas.delete(tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.status === 'complete' && /^https?:/i.test(tab.url || '')) ensureContentScript(tabId).catch(() => {});
    if (!session || tabId !== session.targetTabId || !changeInfo.url) return;
    session.targetUrl = tab.url || changeInfo.url || session.targetUrl;
    chrome.tabs.sendMessage(tabId, { type: 'DEVTRAIL_CAPTURE_STARTED', payload: { session_id: session.sessionId } }).catch(() => {});
  });
})();
