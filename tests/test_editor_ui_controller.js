'use strict';

const assert = require('node:assert/strict');
const EditorUIController = require('../frontend/modules/editor_ui_controller.js');

function element(dataset = {}) {
  const listeners = {};
  return {
    dataset,
    addEventListener: (type, handler) => { listeners[type] = handler; },
    dispatch: (type, event = {}) => listeners[type]?.(event),
    value: ''
  };
}

const tabs = [element({ panel: 'panelRaw' }), element({ panel: 'panelPreview' })];
const markdownEditor = element();
const markdownEditorSplit = element();
const btnPreviewRaw = element();
const calls = [];

const controller = EditorUIController.create({
  editorController: {
    switchTab: panel => calls.push(['switchTab', panel]),
    handleInput: value => calls.push(['handleInput', value]),
    togglePreviewRaw: () => calls.push(['togglePreviewRaw'])
  },
  elements: { tabs, markdownEditor, markdownEditorSplit, btnPreviewRaw }
});

controller.bind();

tabs[1].dispatch('click');
markdownEditor.value = '# novo';
markdownEditor.dispatch('input');
markdownEditorSplit.value = '# split';
markdownEditorSplit.dispatch('input');
btnPreviewRaw.dispatch('click');

assert.deepEqual(calls, [
  ['switchTab', 'panelPreview'],
  ['handleInput', '# novo'],
  ['handleInput', '# split'],
  ['togglePreviewRaw']
]);

console.log('editor_ui_controller module tests: ok');
