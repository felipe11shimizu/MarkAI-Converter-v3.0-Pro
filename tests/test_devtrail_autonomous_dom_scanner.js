const assert = require('node:assert/strict');
const createScanner = require('../extension/autonomous_dom_scanner.js');

function element(tag, attrs, text, rect) {
  const data = Object.assign({}, attrs);
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: data.id || '',
    parentElement: null,
    children: [],
    innerText: text || '',
    textContent: text || '',
    disabled: Boolean(data.disabled),
    value: data.value || '',
    href: data.href || '',
    getAttribute(name) { return data[name] ?? null; },
    getBoundingClientRect() { return Object.assign({ x: 0, y: 0, width: 100, height: 30 }, rect); }
  };
}

(async () => {
  const scanner = createScanner();
  const button = element('button', { id: 'save', 'aria-label': 'Salvar' }, 'Salvar');
  const password = element('input', { type: 'password', name: 'password', value: 'secret' }, '', { width: 80, height: 20 });
  const hidden = element('button', { id: 'hidden' }, 'Oculto', { width: 0, height: 0 });
  const doc = {
    title: 'Sistema Teste',
    location: { href: 'https://example.test/app' },
    body: {},
    defaultView: {
      innerWidth: 1280,
      innerHeight: 720,
      getComputedStyle() { return { display: 'block', visibility: 'visible' }; }
    },
    querySelectorAll() { return [button, password, hidden]; }
  };

  const map = scanner.scanDocument(doc, doc.defaultView);

  assert.equal(map.version, 1);
  assert.equal(map.page.url, 'https://example.test/app');
  assert.equal(map.page.title, 'Sistema Teste');
  assert.equal(map.counts.interactive, 3);
  assert.equal(map.counts.visible, 2);
  assert.equal(map.counts.enabled, 3);
  assert.equal(map.controls[0].selector, '#save');
  assert.equal(map.controls[1].text, '', 'password text must never be captured');
  assert.equal(map.controls[1].placeholder, null);
  assert.equal(map.controls[1].valuePresent, false);

  const unavailable = await scanner.scanTab({}, 1);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'SCRIPTING_API_UNAVAILABLE');

  console.log('devtrail autonomous DOM scanner tests: ok');
})();
