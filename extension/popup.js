(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const output = $('output');
  const message = $('message');
  let lastSnapshot = null;

  function show(value) {
    output.textContent = JSON.stringify(value, null, 2);
    message.textContent = value?.code || (value?.ok ? 'OK' : '');
  }

  async function activeTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return Number(tabs?.[0]?.id);
  }

  async function resolveTabId() {
    const field = Number($('tabId').value);
    if (Number.isInteger(field) && field >= 0) return field;
    const id = await activeTabId();
    if (Number.isInteger(id)) {
      $('tabId').value = String(id);
      return id;
    }
    throw new Error('Não foi possível identificar a aba alvo.');
  }

  function send(type, payload = {}) {
    return chrome.runtime.sendMessage({ type, payload });
  }

  $('start').addEventListener('click', async () => {
    try {
      const targetTabId = await resolveTabId();
      show(await send('DEVTRAIL_AUTONOMOUS_START', {
        targetTabId,
        limits: { maxCycles: 10, maxActionsTotal: 50, maxSessionMs: 15 * 60 * 1000 }
      }));
    } catch (error) { show({ ok: false, code: 'POPUP_ERROR', message: error.message }); }
  });

  $('scan').addEventListener('click', async () => {
    try {
      const targetTabId = await resolveTabId();
      lastSnapshot = await send('DEVTRAIL_AUTONOMOUS_SCAN_DOM', { targetTabId });
      show(lastSnapshot);
    } catch (error) { show({ ok: false, code: 'POPUP_ERROR', message: error.message }); }
  });

  $('map').addEventListener('click', async () => {
    try {
      if (!lastSnapshot?.ok || !lastSnapshot.map) throw new Error('Faça o mapeamento DOM antes de construir o mapa.');
      show(await send('DEVTRAIL_AUTONOMOUS_BUILD_MAP', { targetTabId: await resolveTabId(), domSnapshot: lastSnapshot.map }));
    } catch (error) { show({ ok: false, code: 'POPUP_ERROR', message: error.message }); }
  });

  $('cycle').addEventListener('click', async () => {
    try {
      const targetTabId = await resolveTabId();
      show(await send('DEVTRAIL_AUTONOMOUS_CYCLE', {
        targetTabId,
        options: { execute: true, executor: { maxActions: 1, validationDelayMs: 100 } }
      }));
    } catch (error) { show({ ok: false, code: 'POPUP_ERROR', message: error.message }); }
  });

  $('status').addEventListener('click', async () => {
    try { show(await send('DEVTRAIL_AUTONOMOUS_STATUS', { targetTabId: await resolveTabId() })); }
    catch (error) { show({ ok: false, code: 'POPUP_ERROR', message: error.message }); }
  });

  $('kill').addEventListener('click', async () => {
    try { show(await send('DEVTRAIL_AUTONOMOUS_KILL', { reason: 'popup_kill_switch' })); }
    catch (error) { show({ ok: false, code: 'POPUP_ERROR', message: error.message }); }
  });

  resolveTabId().catch(() => {});
})();
