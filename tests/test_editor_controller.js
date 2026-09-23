'use strict';

const assert = require('node:assert/strict');
const EditorController = require('../frontend/modules/editor_controller.js');

const state = {
  currentMd: '',
  currentFileName: '',
  activePanel: 'panelRaw',
  settings: { autoPreview: true, syntaxHL: true },
  previewItemId: null
};
const events = [];
const ui = {
  setStats: value => events.push(['stats', value]),
  setPreviewHtml: (html, settings) => events.push(['preview', html, settings]),
  setWorkspaceVisible: value => events.push(['visible', value]),
  setDocumentName: value => events.push(['name', value]),
  setEditorValues: value => events.push(['editors', value]),
  setSplitEditorValue: value => events.push(['split', value]),
  setActivePanel: value => events.push(['panel', value]),
  syncEditorValues: value => events.push(['sync', value]),
  clearEditorsAndPreview: () => events.push(['clear']),
  setProgress: (...args) => events.push(['progress', ...args]),
  setStatus: (...args) => events.push(['status', ...args]),
  setPreviewFileName: value => events.push(['preview-name', value]),
  clearPreviewContent: () => events.push(['preview-clear']),
  showProcessing: (...args) => events.push(['processing', ...args]),
  hideProcessing: () => events.push(['hide']),
  renderQueue: () => events.push(['queue']),
  toast: (...args) => events.push(['toast', ...args]),
  setPreviewRawLabel: value => events.push(['raw-label', value]),
  setPreviewRawContent: value => events.push(['raw', value]),
  showPreviewModal: () => events.push(['modal'])
};

const queueItems = [{ id: '1', name: 'a.txt', result: '# A', status: 'done' }];
const queue = {
  getById: id => queueItems.find(item => item.id === id),
  update: (id, patch) => Object.assign(queueItems.find(item => item.id === id), patch)
};
const parser = { parse: async () => '# parsed' };

const controller = EditorController.create({
  getState: () => ({ ...state }),
  setState: patch => Object.assign(state, patch),
  ui,
  queueManager: queue,
  fileParserStrategy: parser,
  sanitizeMarkdownHtml: md => '<p>' + md + '</p>',
  scheduleSave: () => events.push(['save']),
  timers: { setTimeout: fn => { events.push(['timer']); return 1; }, clearTimeout: () => {} }
});

controller.loadMarkdown('# T\ntexto', 'doc.md');
assert.equal(state.currentMd, '# T\ntexto');
assert.equal(state.currentFileName, 'doc.md');
assert.ok(events.some(e => e[0] === 'stats'));

state.activePanel = 'panelPreview';
controller.switchTab('panelPreview');
assert.ok(events.some(e => e[0] === 'preview'));

controller.handleInput('# novo');
assert.equal(state.currentMd, '# novo');
assert.ok(events.some(e => e[0] === 'save'));

controller.reset();
assert.equal(state.currentMd, '');
assert.ok(events.some(e => e[0] === 'clear'));

(async () => {
  await controller.previewItem('1');
  assert.ok(events.some(e => e[0] === 'modal'));
  controller.togglePreviewRaw();
  assert.ok(events.some(e => e[0] === 'raw'));
  controller.togglePreviewRaw();
  assert.ok(events.some(e => e[0] === 'preview'));
  console.log('editor_controller module tests: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
