'use strict';

const assert = require('node:assert/strict');
const SettingsController = require('../frontend/modules/settings_controller.js');

const state = {
  settings: {
    aiProvider: 'openai',
    aiModel: 'gpt-4o-mini',
    apiKey: 'secret',
    markitdownEnabled: false,
    markitdownEndpoint: 'http://example.test',
    syntaxHL: false,
    autoPreview: true
  }
};
const events = [];
const form = { ...state.settings };

const ui = {
  setSettingsForm: value => Object.assign(form, value),
  readSettingsForm: () => ({ ...form }),
  filterAIModels: provider => events.push(['filter', provider]),
  closeSettings: () => events.push(['close']),
  toast: (...args) => events.push(['toast', ...args]),
  setApiKeyValue: value => { form.apiKey = value; },
  toggleApiKeyVisibility: () => { events.push(['toggle']); return true; },
  bindSettingsEvents: handlers => { ui.handlers = handlers; }
};

const saved = [];
const controller = SettingsController.create({
  getSettings: () => state.settings,
  setSettings: next => { state.settings = next; },
  saveSettings: () => saved.push({ ...state.settings }),
  ui
});

const synced = controller.sync();
assert.equal(synced.aiProvider, 'openai');
assert.equal(form.apiKey, 'secret');
assert.deepEqual(events.shift(), ['filter', 'openai']);

form.aiProvider = 'gemini';
form.aiModel = 'gemini-3.5-flash-lite';
form.apiKey = 'new-secret';
controller.save();
assert.equal(state.settings.aiProvider, 'gemini');
assert.equal(state.settings.apiKey, 'new-secret');
assert.equal(saved.length, 1);
assert.ok(events.some(event => event[0] === 'close'));

controller.clearApiKey();
assert.equal(state.settings.apiKey, '');
assert.equal(form.apiKey, '');
assert.ok(events.some(event => event[0] === 'toast' && event[1] === 'Chave removida.'));

controller.toggleApiKey();
assert.ok(events.some(event => event[0] === 'toggle'));

controller.bind();
assert.ok(ui.handlers);
ui.handlers.open();
assert.ok(events.some(event => event[0] === 'filter' && event[1] === 'gemini'));

console.log('settings_controller module tests: ok');
