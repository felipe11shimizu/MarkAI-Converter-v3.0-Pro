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
    READY: PREFIX + 'READY',
    CORRELATE: PREFIX + 'CORRELATE',
    BUILD_MAP: PREFIX + 'BUILD_MAP',
    BUILD_MAP_MD: PREFIX + 'BUILD_MAP_MD',
    CYCLE: PREFIX + 'CYCLE',
    KILL: PREFIX + 'KILL',
    PLAN: PREFIX + 'PLAN',
    EXECUTE: PREFIX + 'EXECUTE'
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
      lastError: null,
      limits: {
        maxSessionMs: 15 * 60 * 1000,
        maxCycles: 10,
        maxActionsTotal: 50,
        cyclesExecuted: 0,
        actionsExecuted: 0,
        killSwitch: false
      }
    };
  }

  function createAgent(api) {
    const state = createState();
    const networkCapture = globalThis.DevTrailAutonomousNetworkCapture?.create?.(api, { state });
    const eventCorrelator = globalThis.DevTrailAutonomousEventCorrelator || null;
    const systemMapApi = globalThis.DevTrailAutonomousSystemMap || null;
    const systemMapMarkdownApi = globalThis.DevTrailAutonomousSystemMapMarkdown || null;
    const plannerApi = globalThis.DevTrailAutonomousPlanner || null;
    const executorApi = globalThis.DevTrailAutonomousExecutor || null;
    const domScannerApi = globalThis.DevTrailAutonomousDomScanner || null;
    const cycleApi = globalThis.DevTrailAutonomousCycle || null;
    let systemMap = null;
    let installed = false;
    let sessionTimer = null;
    let cycleRunning = false;

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

    const clearSessionTimer = () => {
      if (sessionTimer != null) clearTimeout(sessionTimer);
      sessionTimer = null;
    };

    const reset = () => {
      clearSessionTimer();
      cycleRunning = false;
      Object.assign(state, createState());
      systemMap = null;
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
      const requestedLimits = payload.limits || {};
      state.limits.maxSessionMs = Number.isInteger(requestedLimits.maxSessionMs) && requestedLimits.maxSessionMs > 0
        ? Math.min(requestedLimits.maxSessionMs, 30 * 60 * 1000) : state.limits.maxSessionMs;
      state.limits.maxCycles = Number.isInteger(requestedLimits.maxCycles) && requestedLimits.maxCycles > 0
        ? Math.min(requestedLimits.maxCycles, 50) : state.limits.maxCycles;
      state.limits.maxActionsTotal = Number.isInteger(requestedLimits.maxActionsTotal) && requestedLimits.maxActionsTotal > 0
        ? Math.min(requestedLimits.maxActionsTotal, 200) : state.limits.maxActionsTotal;
      state.limits.cyclesExecuted = 0;
      state.limits.actionsExecuted = 0;
      state.limits.killSwitch = false;
      systemMap = systemMapApi?.create?.({
        session_id: state.sessionId,
        target_url: state.targetUrl
      }) || null;

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
      sessionTimer = setTimeout(() => { stop('max_session_duration').catch(() => reset()); }, state.limits.maxSessionMs);

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

    async function runCycle(payload = {}) {
      if (!state.active) return { ok: false, code: 'AUTONOMOUS_SESSION_REQUIRED' };
      if (state.limits.killSwitch) return { ok: false, code: 'AUTONOMOUS_KILL_SWITCH_ACTIVE' };
      if (cycleRunning) return { ok: false, code: 'AUTONOMOUS_CYCLE_ACTIVE' };
      if (state.limits.cyclesExecuted >= state.limits.maxCycles) return { ok: false, code: 'AUTONOMOUS_MAX_CYCLES_REACHED' };
      if (state.limits.actionsExecuted >= state.limits.maxActionsTotal) return { ok: false, code: 'AUTONOMOUS_MAX_ACTIONS_REACHED' };
      if (!cycleApi?.run || !domScannerApi?.scanTab || !plannerApi?.plan || !executorApi?.execute || !systemMapApi || !systemMap) {
        return { ok: false, code: 'AUTONOMOUS_CYCLE_UNAVAILABLE' };
      }
      cycleRunning = true;
      try {
        const map = systemMapApi.finalize(systemMap);
        const networkBefore = Array.isArray(state.network) ? state.network.length : 0;
        const result = await cycleApi.run(
          api,
          state,
          plannerApi,
          executorApi,
          domScannerApi,
          map,
          payload.options || {}
        );
        if (result?.snapshot && systemMapApi.addDomSnapshot) {
          systemMapApi.addDomSnapshot(systemMap, result.snapshot);
        }
        if (Array.isArray(state.network) && state.network.length > networkBefore && systemMapApi.addNetworkEvents) {
          systemMapApi.addNetworkEvents(systemMap, state.network.slice(networkBefore));
        }
        result.persisted = {
          snapshot: Boolean(result?.snapshot),
          network_events: Math.max(0, (Array.isArray(state.network) ? state.network.length : 0) - networkBefore),
          map_totals: systemMapApi.finalize(systemMap).totals
        };
        state.limits.cyclesExecuted += 1;
        state.limits.actionsExecuted += Number(result?.execution?.executed || 0);
        if (state.limits.actionsExecuted >= state.limits.maxActionsTotal) {
          state.lastError = 'Limite total de ações atingido.';
        }
        return { ...result, limits: { ...state.limits } };
      } finally {
        cycleRunning = false;
      }
    }

    async function kill(reason = 'kill_switch') {
      state.limits.killSwitch = true;
      if (!state.active) return { ok: true, code: 'AUTONOMOUS_KILL_SWITCH_ACTIVE' };
      return stop(reason);
    }

    function onMessage(message, sender, sendResponse) {
      const type = message?.type;
      if (type !== MESSAGE.START && type !== MESSAGE.STOP && type !== MESSAGE.STATUS && type !== MESSAGE.CORRELATE && type !== MESSAGE.BUILD_MAP && type !== MESSAGE.BUILD_MAP_MD && type !== MESSAGE.CYCLE && type !== MESSAGE.KILL && type !== MESSAGE.PLAN && type !== MESSAGE.EXECUTE) return false;

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

      if (type === MESSAGE.STATUS) {
        sendResponse({ ok: true, state: { ...state, limits: { ...state.limits } } });
        return false;
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

      if (type === MESSAGE.BUILD_MAP) {
        if (!state.active || !systemMapApi || !systemMap) {
          sendResponse({ ok: false, code: 'SYSTEM_MAP_UNAVAILABLE' });
          return false;
        }
        const payload = message?.payload || {};
        if (payload.domSnapshot) systemMapApi.addDomSnapshot(systemMap, payload.domSnapshot);
        if (Array.isArray(payload.domSnapshots)) {
          payload.domSnapshots.forEach(snapshot => systemMapApi.addDomSnapshot(systemMap, snapshot));
        }
        if (Array.isArray(payload.steps)) systemMapApi.addCorrelatedSteps(systemMap, payload.steps);
        if (Array.isArray(payload.flows)) payload.flows.forEach(flow => systemMapApi.addFlow(systemMap, flow));
        if (Array.isArray(payload.diagnostics)) systemMapApi.addDiagnostics(systemMap, payload.diagnostics);
        const result = systemMapApi.finalize(systemMap);
        sendResponse({ ok: true, map: result });
        return false;
      }

      if (type === MESSAGE.BUILD_MAP_MD) {
        if (!state.active || !systemMapMarkdownApi || !systemMap) {
          sendResponse({ ok: false, code: 'SYSTEM_MAP_MARKDOWN_UNAVAILABLE' });
          return false;
        }
        const payload = message?.payload || {};
        if (payload.domSnapshot) systemMapApi?.addDomSnapshot?.(systemMap, payload.domSnapshot);
        if (Array.isArray(payload.domSnapshots)) payload.domSnapshots.forEach(snapshot => systemMapApi?.addDomSnapshot?.(systemMap, snapshot));
        if (Array.isArray(payload.steps)) systemMapApi?.addCorrelatedSteps?.(systemMap, payload.steps);
        if (Array.isArray(payload.flows)) payload.flows.forEach(flow => systemMapApi?.addFlow?.(systemMap, flow));
        if (Array.isArray(payload.diagnostics)) systemMapApi?.addDiagnostics?.(systemMap, payload.diagnostics);
        const result = systemMapApi.finalize(systemMap);
        sendResponse({ ok: true, markdown: systemMapMarkdownApi.render(result), map: result });
        return false;
      }

      if (type === MESSAGE.KILL) {
        kill(message?.payload?.reason || 'kill_switch')
          .then(sendResponse)
          .catch(error => sendResponse({
            ok: false,
            code: 'AUTONOMOUS_KILL_ERROR',
            message: safeMessage(error, 'Erro no kill switch.')
          }));
        return true;
      }

      if (type === MESSAGE.CYCLE) {
        const targetTabId = Number(message?.payload?.targetTabId);
        if (!state.active || !Number.isInteger(targetTabId) || targetTabId !== state.tabId) {
          sendResponse({ ok: false, code: 'AUTONOMOUS_SESSION_REQUIRED' });
          return false;
        }
        runCycle(message?.payload || {})
          .then(sendResponse)
          .catch(error => sendResponse({
            ok: false,
            code: 'AUTONOMOUS_CYCLE_ERROR',
            message: safeMessage(error, 'Erro no ciclo autônomo.')
          }));
        return true;
      }

      if (type === MESSAGE.PLAN) {
        const targetTabId = Number(message?.payload?.targetTabId);
        if (!state.active || !Number.isInteger(targetTabId) || targetTabId !== state.tabId) {
          sendResponse({ ok: false, code: 'AUTONOMOUS_SESSION_REQUIRED' });
          return false;
        }
        if (!plannerApi?.plan || !systemMapApi || !systemMap) {
          sendResponse({ ok: false, code: 'AUTONOMOUS_PLANNER_UNAVAILABLE' });
          return false;
        }
        const map = systemMapApi.finalize(systemMap);
        const plan = plannerApi.plan(map, message?.payload?.options || {});
        sendResponse({ ok: true, plan });
        return false;
      }

      if (type === MESSAGE.EXECUTE) {
        const targetTabId = Number(message?.payload?.targetTabId);
        if (!state.active || !Number.isInteger(targetTabId) || targetTabId !== state.tabId) {
          sendResponse({ ok: false, code: 'AUTONOMOUS_SESSION_REQUIRED' });
          return false;
        }
        if (!executorApi?.execute) {
          sendResponse({ ok: false, code: 'AUTONOMOUS_EXECUTOR_UNAVAILABLE' });
          return false;
        }
        executorApi.execute(
          api,
          state,
          message?.payload?.plan,
          { ...(message?.payload?.options || {}), execute: message?.payload?.execute === true }
        ).then(sendResponse).catch(error => sendResponse({
          ok: false,
          code: 'AUTONOMOUS_EXECUTION_ERROR',
          message: safeMessage(error, 'Erro na execução autônoma.')
        }));
        return true;
      }

      if (type === MESSAGE.CORRELATE) {
        const targetTabId = Number(message?.payload?.targetTabId);
        if (!state.active || !Number.isInteger(targetTabId) || targetTabId !== state.tabId) {
          sendResponse({ ok: false, code: 'AUTONOMOUS_SESSION_REQUIRED' });
          return false;
        }
        if (!eventCorrelator?.correlate) {
          sendResponse({ ok: false, code: 'EVENT_CORRELATOR_UNAVAILABLE' });
          return false;
        }
        const steps = eventCorrelator.correlate(
          message?.payload?.domEvents || [],
          state.network,
          message?.payload?.options || {}
        );
        sendResponse({ ok: true, steps, summary: eventCorrelator.summarize(steps) });
        return false;
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
      networkCapture,
      eventCorrelator,
      plannerApi,
      executorApi,
      domScannerApi,
      cycleApi,
      systemMap
    });
  }

  // The module is a factory in both Node tests and the browser.
  // Installation is explicit at the integration boundary (background.js).
  return createAgent(chromeApi);
});
