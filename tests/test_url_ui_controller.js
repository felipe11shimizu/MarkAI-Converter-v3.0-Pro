'use strict';

const assert = require('node:assert/strict');
const UrlUIController = require('../frontend/modules/url_ui_controller.js');

function element(value = '') {
  const listeners = {};
  return {
    value,
    addEventListener(type, handler) { listeners[type] = handler; },
    dispatch(type, event = {}) { return listeners[type]?.(event); }
  };
}

(async () => {
  const calls = [];
  const events = [];
  const urlInput = element('https://example.com/artigo');
  const btnFetchUrl = element();
  const controller = UrlUIController.create({
    urlService: {
      fetch: async url => {
        calls.push(['fetch', url]);
        return '# artigo';
      }
    },
    youtubeController: {
      updateControls: url => url.includes('youtube.com'),
      transcribe: async (url, options) => calls.push(['youtube', url, options])
    },
    elements: { urlInput, btnFetchUrl },
    ui: {
      showProcessing: (...args) => events.push(['processing', ...args]),
      hideProcessing: () => events.push(['hide']),
      setStatus: (...args) => events.push(['status', ...args]),
      loadMarkdown: (...args) => events.push(['markdown', ...args]),
      toast: (...args) => events.push(['toast', ...args])
    }
  });

  controller.bind();
  await controller.submit();

  assert.deepEqual(calls, [['fetch', 'https://example.com/artigo']]);
  assert.ok(events.some(event => event[0] === 'markdown' && event[1] === '# artigo'));

  urlInput.value = 'https://youtube.com/watch?v=abc';
  await controller.submit();
  assert.deepEqual(calls.at(-1), ['youtube', 'https://youtube.com/watch?v=abc', { language: 'auto', translateTo: null }]);

  urlInput.value = 'ftp://example.com';
  await controller.submit();
  assert.equal(calls.at(-1)[0], 'youtube');

  console.log('url_ui_controller module tests: ok');
})();
