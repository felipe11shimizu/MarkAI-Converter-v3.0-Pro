'use strict';
const assert = require('node:assert/strict');
const Controller = require('../frontend/modules/file_actions_ui_controller.js');

function button() {
  const listeners = {};
  return {
    addEventListener(type, handler) { listeners[type] = handler; },
    async dispatch(type) { return listeners[type]?.(); }
  };
}

(async () => {
  const calls = [];
  const btnDownload = button();
  const btnReset = button();
  const state = { currentMd: '# documento', currentFileName: 'documento.md' };
  const anchor = { href:'', download:'', click(){ calls.push(['click']); } };
  const fakeDocument = {
    body: {
      appendChild(node){ calls.push(['append', node]); },
      removeChild(node){ calls.push(['remove', node]); }
    },
    createElement(){ return anchor; }
  };
  const urlApi = {
    createObjectURL(blob){ calls.push(['url', blob]); return 'blob:test'; },
    revokeObjectURL(url){ calls.push(['revoke', url]); }
  };
  class FakeBlob { constructor(parts, options){ this.parts=parts; this.options=options; } }
  const editor = { reset(){ calls.push(['reset']); return 'reset-result'; } };
  const controller = Controller.create({
    getState: () => state,
    editorController: editor,
    ui: { toast: (...args) => calls.push(['toast', ...args]) },
    document: fakeDocument,
    URL: urlApi,
    Blob: FakeBlob,
    elements: { btnDownload, btnReset }
  });

  controller.bind();
  assert.equal(await btnDownload.dispatch('click'), true);
  assert.deepEqual(calls.map(call => call[0]), ['url','append','click','remove','revoke','toast']);
  assert.equal(anchor.download, 'documento.md');

  state.currentMd = '';
  assert.equal(await controller.download(), false);
  assert.equal(calls.at(-1)[0], 'toast');
  assert.equal(calls.at(-1)[2], 'warning');

  state.currentMd = '# documento';
  assert.equal(await btnReset.dispatch('click'), 'reset-result');
  assert.equal(calls.at(-1)[0], 'reset');

  console.log('file_actions_ui_controller tests passed');
})();
