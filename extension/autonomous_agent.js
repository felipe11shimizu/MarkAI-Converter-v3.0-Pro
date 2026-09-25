(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.DevTrailAutonomousAgent = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (chromeApi) {
  'use strict';

  const PREFIX = 'DEVTRAIL_AUTONOMOUS_';
  const MESSAGE = Object.freeze({
    START: PREFIX + 'START',
    STOP: PREFIX + 'STOP',
    STATUS: PREFIX + 'STATUS',
    ERROR: PREFIX + 'ERROR',
    READY: PREFIX + 'READY'
  });
  const PHASE = Object.freeze({
    IDLE: 'idle',
    ATTACHING: 'attaching',
    READY: 'ready',
    STOPPING: 'stopping',
    ERROR: 'error'
  });

  function createState() {
    return {
      active: false,
      debuggerAttached: false,
      network: [],
      sessionId: null,
      tabId: null,
      portalTabId: null,
      targetUrl: '',
      phase: PHASE.IDLE,
      startedAt: null,
      lastError: null
    };
  }

  function createAgent(api) {
    const state = createState();
    const networkCapture = globalThis.DevTrailAutonomousNetworkCapture?.create?.(api, { state });
    let installed = false;

    const safeMessage = (error, fallback) => {
      try { return error && error.message ? String(error.message) : fallback; }
      catch (_) { return fallback; }
    };

    const emit = (tabId, type, payload = {}) => {
      if (!api?.tabs?.sendMessage || tabId == null) return Promise.resolve(false);
      return Promise.resolve(api.tabs.sendMessage(tabId, { type, payload }))
        .then(() => true)
        .catch(() => false);
    };

    const reset = () => {
      Object.assign(state, createState());
    };

    async function attachAndInitialize(tabId) {
      const target = { tabId };
      let attachedByAgent = false;

      try {
        await api.debugger.attach(target, '1.3');
        attachedByAgent = true;
        state.debuggerAttached = true;

        for (const method of [
          'Network.enable',
          'Runtime.enable',
          'Page.enable'
        ]) {
          await api.debugger.sendCommand(target, method);
        }

        return { ok: true };
      } catch (error) {
        // Never detach when attach() itself failed. The debugger may belong
        // to another extension or operating mode.
        if (attachedByAgent) {
          try { await api.debugger.detach(target); } catch (_) {}
        }

        state.debuggerAttached = false;

        return {
          ok: false,
          code: 'CDP_ATTACH_FAILED',
          error: safeMessage(error, 'Falha ao inicializar o CDP.')
        };
      }
    }

    async function detach(tabId) {
      if (tabId == null) return;
      try { await api.debugger.detach({ tabId }); } catch (_) {}
    }

    async function start(payload = {}, sender = {}) {
      if (state.active) {
        return { ok: false, code: 'AUTONOMOUS_SESSION_ACTIVE', state: { ...state } };
      }

      const requestedTabId = Number(payload.targetTabId);
      const senderTabId = Number(sender?.tab?.id);
      const tabId = Number.isInteger(requestedTabId)
        ? requestedTabId
        : (Number.isInteger(senderTabId) ? senderTabId : null);

      if (!Number.isInteger(tabId)) {
        return { ok: false, code: 'TARGET_TAB_REQUIRED', message: 'targetTabId é obrigatório.' };
      }

      let tab;
      try {
        tab = await api.tabs.get(tabId);
        if (!/^https?:/i.test(tab?.url || '')) {
          return { ok: false, code: 'UNSUPPORTED_TARGET', message: 'O agente autônomo exige uma aba HTTP/HTTPS.' };
        }
      } catch (error) {
        return { ok: false, code: 'TARGET_TAB_UNAVAILABLE', message: safeMessage(error, 'A aba alvo não está disponível.') };
      }

      state.active = false;
      state.debuggerAttached = false;
      state.sessionId = (api.crypto?.randomUUID || (() => 'autonomous-' + Date.now()))();
      state.tabId = tabId;
      state.portalTabId = Number.isInteger(senderTabId) ? senderTabId : null;
      state.targetUrl = tab.url || '';
      state.phase = PHASE.ATTACHING;
      state.startedAt = Date.now();
      state.lastError = null;

      const result = await attachAndInitialize(tabId);

      if (!result.ok) {
        state.phase = PHASE.ERROR;
        state.lastError = result.error;

        const failure = {
          ok: false,
          code: result.code,
          message: result.error,
          state: { ...state }
        };

        reset();
        return failure;
      }

      state.active = true;
      state.phase = PHASE.READY;

      await emit(state.portalTabId, MESSAGE.READY, {
        sessionId: state.sessionId,
        tabId: state.tabId,
        targetUrl: state.targetUrl
      });

      return { ok: true, state: { ...state } };
    }

    async function stop(reason = 'manual') {
      if (!state.active) return { ok: true, code: 'AUTONOMOUS_SESSION_INACTIVE' };
      const tabId = state.tabId;
      const sessionId = state.sessionId;
      state.phase = PHASE.STOPPING;
      if (state.debuggerAttached) {
        await detach(tabId);
        state.debuggerAttached = false;
      }
      await emit(state.portalTabId, MESSAGE.STATUS, {
        sessionId,
        tabId,
        phase: 'stopped',
        reason
      });
      reset();
      return { ok: true, code: 'AUTONOMOUS_SESSION_STOPPED' };
    }

    function onMessage(message, sender, sendResponse) {
      const type = message?.type;
      if (type !== MESSAGE.START && type !== MESSAGE.STOP && type !== MESSAGE.STATUS) return false;

      if (type === MESSAGE.START) {
        start(message.payload || {}, sender)
          .then(sendResponse)
          .catch(error => sendResponse({
            ok: false,
            code: 'AUTONOMOUS_UNHANDLED_ERROR',
            message: safeMessage(error, 'Erro inesperado no agente autônomo.')
          }));
        return true;
      }

      if (type === MESSAGE.STOP) {
        stop(message?.payload?.reason || 'manual')
          .then(sendResponse)
          .catch(error => sendResponse({
            ok: false,
            code: 'AUTONOMOUS_STOP_ERROR',
            message: safeMessage(error, 'Erro ao finalizar o agente autônomo.')
          }));
        return true;
      }

      sendResponse({ ok: true, state: { ...state } });
      return false;
    }

    function onDetach(source, reason) {
      if (!state.active || source?.tabId !== state.tabId) return;
      state.phase = PHASE.ERROR;
      state.lastError = 'Debugger detached: ' + String(reason || 'unknown');
      emit(state.portalTabId, MESSAGE.ERROR, {
        sessionId: state.sessionId,
        tabId: state.tabId,
        reason: state.lastError
      }).finally(reset);
    }

    function onTabRemoved(tabId) {
      if (state.active && tabId === state.tabId) stop('target_tab_closed').catch(() => reset());
      if (state.active && tabId === state.portalTabId) state.portalTabId = null;
    }

    function install() {
      if (installed) return false;

      const runtime = api && api.runtime;
      const onMessageEvent = runtime && runtime.onMessage;
      if (!onMessageEvent || typeof onMessageEvent.addListener !== 'function') return false;

      onMessageEvent.addListener(onMessage);
      api.debugger?.onDetach?.addListener?.(onDetach);
      api.tabs?.onRemoved?.addListener?.(onTabRemoved);
      networkCapture?.install?.();
      installed = true;
      return true;
    }

    return Object.freeze({
      MESSAGE,
      PHASE,
      state,
      start,
      stop,
      onMessage,
      onDetach,
      onTabRemoved,
      install,
      networkCapture
    });
  }

  // The module is a factory in both Node tests and the browser.
  // Installation is explicit at the integration boundary (background.js).
  return createAgent(chromeApi);
});
