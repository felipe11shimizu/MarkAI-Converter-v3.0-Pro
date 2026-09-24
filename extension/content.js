(function () {
  'use strict';

  const EVENT_SOURCE = 'markai-devtrail';
  const CONTROL_TYPES = new Set([
    'DEVTRAIL_PING', 'DEVTRAIL_LIST_TABS', 'DEVTRAIL_START',
    'DEVTRAIL_PAUSE', 'DEVTRAIL_RESUME', 'DEVTRAIL_STOP'
  ]);
  const sensitiveName = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|passwd|senha|token)$/i;
  const passwordType = /password/i;

  function post(type, payload = {}) {
    window.postMessage({ source: EVENT_SOURCE, type, ...payload }, '*');
  }
  function redactValue(value, name = '') {
    if (sensitiveName.test(String(name || ''))) return '[REDACTED]';
    if (value == null) return null;
    const text = String(value);
    return text.length > 1000 ? text.slice(0, 1000) + '…' : text;
  }
  function visibleText(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ').slice(0, 240);
  }
  function xpath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '//*[@id="' + String(el.id).replace(/"/g, '\\"') + '"]';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      node = node.parentElement;
    }
    return '/' + parts.join('/').slice(0, 260);
  }
  function selectors(el) {
    if (!el || el.nodeType !== 1) return {};
    const out = {};
    for (const attr of ['data-testid', 'data-cy', 'id', 'name']) {
      const value = el.getAttribute(attr);
      if (value) out[attr === 'data-testid' ? 'testid' : attr === 'data-cy' ? 'cy' : attr] = value.slice(0, 160);
    }
    const css = cssPath(el);
    const xp = xpath(el);
    if (css) out.css = css;
    if (xp) out.xpath = xp;
    return out;
  }
  function elementInfo(el) {
    return { tag: el?.tagName || null, texto_visivel: visibleText(el), seletores: selectors(el) };
  }
  function inputValue(el) {
    if (!el || passwordType.test(el.type || '') || sensitiveName.test(el.name || '') || sensitiveName.test(el.id || '')) {
      return el ? '[REDACTED]' : null;
    }
    return redactValue(el.value, el.name || el.id || '');
  }
  function emit(tipo, el, extra = {}) {
    post('DEVTRAIL_DOM_EVENT', {
      event: {
        tipo_evento: tipo,
        timestamp_epoch_ms: Date.now(),
        elemento: elementInfo(el),
        valor_entrada: extra.valor_entrada ?? null,
        ...extra
      }
    });
  }

  let inputTimer = null;
  function scheduleInput(el) {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => emit('input', el, { valor_entrada: inputValue(el) }), 500);
  }

  document.addEventListener('click', e => {
    const el = e.target?.closest?.('button,a,input,textarea,select,[role="button"],[role="link"]') || e.target;
    emit('click', el);
  }, true);
  document.addEventListener('input', e => scheduleInput(e.target), true);
  document.addEventListener('change', e => {
    clearTimeout(inputTimer);
    emit('input', e.target, { valor_entrada: inputValue(e.target), motivo: 'change' });
  }, true);
  document.addEventListener('blur', e => {
    if (e.target?.matches?.('input,textarea,[contenteditable="true"]')) {
      clearTimeout(inputTimer);
      emit('input', e.target, { valor_entrada: inputValue(e.target), motivo: 'blur' });
    }
  }, true);
  document.addEventListener('submit', e => emit('submit', e.target), true);
  document.addEventListener('keydown', e => {
    if (['Enter', 'Tab', 'Escape'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
      emit('keyboard', e.target, {
        tecla: e.key,
        modificadores: { ctrl: !!e.ctrlKey, meta: !!e.metaKey, alt: !!e.altKey, shift: !!e.shiftKey }
      });
    }
  }, true);

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== EVENT_SOURCE || !CONTROL_TYPES.has(event.data.type)) return;
    chrome.runtime.sendMessage({ type: event.data.type, payload: event.data.payload || {} }).catch(() => {});
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type?.startsWith('DEVTRAIL_')) post(message.type, message.payload || {});
  });

  post('DEVTRAIL_READY', {
    page: { url: location.href, title: document.title, viewport: { largura: innerWidth, altura: innerHeight } }
  });
})();
