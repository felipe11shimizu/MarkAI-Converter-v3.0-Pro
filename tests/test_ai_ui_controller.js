'use strict';

const assert = require('node:assert/strict');
const AIUIController = require('../frontend/modules/ai_ui_controller.js');

function button() {
  const classes = new Set();
  const listeners = {};
  return {
    disabled: false,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      has(name) { return classes.has(name); }
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    async dispatch(type) { return listeners[type]?.(); }
  };
}

(async () => {
  const btnEnhanceAI = button();
  const calls = [];
  const state = {
    currentMd: '# original',
    currentFileName: 'documento.md',
    currentProjectId: 'p1',
    settings: { apiKey: 'key', aiProvider: 'openai', aiModel: 'test-model' }
  };
  const controller = AIUIController.create({
    aiEngine: { enhance: async (md, prompt) => { calls.push(['enhance', md, prompt]); return '# melhorado'; } },
    getState: () => state,
    workspaceStore: {
      async saveAIHistory(projectId, record) { calls.push(['history', projectId, record.outputMarkdown]); }
    },
    workspaceController: {
      async saveVersion(source) { calls.push(['version', source]); }
    },
    elements: { btnEnhanceAI },
    ui: {
      toast: (...args) => calls.push(['toast', ...args]),
      openSettings: () => calls.push(['settings']),
      setStatus: (...args) => calls.push(['status', ...args]),
      loadMarkdown: (...args) => calls.push(['load', ...args])
    }
  });

  controller.bind();
  await btnEnhanceAI.dispatch('click');

  assert.deepEqual(calls.map(c => c[0]), ['enhance', 'history', 'load', 'version', 'toast', 'status']);
  assert.equal(btnEnhanceAI.disabled, false);
  assert.equal(btnEnhanceAI.classList.has('loading'), false);
  console.log('ai_ui_controller module tests: ok');
})();
