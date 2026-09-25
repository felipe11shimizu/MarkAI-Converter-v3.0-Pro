(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.DevTrailAutonomousDomScanner = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const INTERACTIVE_SELECTOR = 'a[href],button,input,select,textarea,option,[role],[contenteditable="true"],summary';
  const SENSITIVE_TYPES = new Set(['password']);

  function normalizeText(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit || 160);
  }

  function stableSelector(element) {
    if (element.id) return '#' + String(element.id);
    const testId = element.getAttribute && element.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId.replace(/"/g, '\\\"') + '"]';
    const name = element.getAttribute && element.getAttribute('name');
    if (name) return element.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\\"') + '"]';
    const aria = element.getAttribute && element.getAttribute('aria-label');
    if (aria) return element.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, '\\\"') + '"]';

    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== node.ownerDocument.body && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.parentElement) {
        const siblings = Array.from(node.parentElement.children).filter(x => x.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ') || element.tagName.toLowerCase();
  }

  function isVisible(element, win) {
    if (!element || !element.getBoundingClientRect) return false;
    const style = win && win.getComputedStyle ? win.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function collectElement(element, win, index) {
    const tag = String(element.tagName || '').toLowerCase();
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    const sensitive = SENSITIVE_TYPES.has(type);
    const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : {};
    return {
      index, tag, type: type || null,
      role: element.getAttribute?.('role') || null,
      text: sensitive ? '' : normalizeText(element.innerText || element.textContent),
      ariaLabel: element.getAttribute?.('aria-label') || null,
      id: element.id || null,
      name: element.getAttribute?.('name') || null,
      placeholder: sensitive ? null : element.getAttribute?.('placeholder') || null,
      selector: stableSelector(element),
      href: tag === 'a' ? element.href || element.getAttribute?.('href') || null : null,
      valuePresent: !sensitive && 'value' in element ? Boolean(element.value) : false,
      disabled: Boolean(element.disabled || element.getAttribute?.('aria-disabled') === 'true'),
      visible: isVisible(element, win),
      contentEditable: element.getAttribute?.('contenteditable') === 'true',
      rect: {
        x: Math.round(rect.x || 0), y: Math.round(rect.y || 0),
        width: Math.round(rect.width || 0), height: Math.round(rect.height || 0)
      }
    };
  }

  function scanDocument(doc, win) {
    if (!doc) throw new Error('Document is required');
    const controls = [];
    const seen = new Set();
    Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR)).forEach((element, index) => {
      const item = collectElement(element, win || doc.defaultView, index);
      const key = item.selector + '|' + item.tag + '|' + item.type;
      if (!seen.has(key)) {
        seen.add(key);
        controls.push(item);
      }
    });
    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      page: {
        url: doc.location?.href || '',
        title: normalizeText(doc.title, 300),
        viewport: { width: Number(win?.innerWidth || 0), height: Number(win?.innerHeight || 0) }
      },
      counts: {
        interactive: controls.length,
        visible: controls.filter(x => x.visible).length,
        enabled: controls.filter(x => !x.disabled).length
      },
      controls
    };
  }

  async function scanTab(api, tabId) {
    if (!api?.scripting?.executeScript) return { ok: false, code: 'SCRIPTING_API_UNAVAILABLE' };
    try {
      const results = await api.scripting.executeScript({
        target: { tabId },
        func: function () {
          const selector = 'a[href],button,input,select,textarea,option,[role],[contenteditable="true"],summary';
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
          const controls = Array.from(document.querySelectorAll(selector)).map((el, index) => ({
            index,
            tag: String(el.tagName || '').toLowerCase(),
            type: el.getAttribute('type') || null,
            role: el.getAttribute('role') || null,
            text: el.type === 'password' ? '' : normalize(el.innerText || el.textContent),
            ariaLabel: el.getAttribute('aria-label') || null,
            id: el.id || null,
            name: el.getAttribute('name') || null,
            placeholder: el.type === 'password' ? null : el.getAttribute('placeholder') || null,
            selector: el.id ? '#' + el.id : el.tagName.toLowerCase(),
            href: el.tagName.toLowerCase() === 'a' ? el.href || null : null,
            disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
            visible: Boolean(el.getBoundingClientRect().width && el.getBoundingClientRect().height)
          }));
          return {
            version: 1,
            capturedAt: new Date().toISOString(),
            page: {
              url: location.href,
              title: normalize(document.title, 300),
              viewport: { width: innerWidth, height: innerHeight }
            },
            counts: {
              interactive: controls.length,
              visible: controls.filter(x => x.visible).length,
              enabled: controls.filter(x => !x.disabled).length
            },
            controls
          };
        }
      });
      return { ok: true, map: results?.[0]?.result || null };
    } catch (error) {
      return { ok: false, code: 'DOM_SCAN_FAILED', error: error?.message || String(error) };
    }
  }

  return Object.freeze({ INTERACTIVE_SELECTOR, stableSelector, scanDocument, scanTab });
});
