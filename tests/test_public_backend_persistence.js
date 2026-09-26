'use strict';

const assert = require('node:assert/strict');

global.location = {
  hostname: 'felipe11shimizu.github.io',
  href: 'https://felipe11shimizu.github.io/MarkAI-Converter-v3.0-Pro/'
};

global.localStorage = {
  _value: JSON.stringify({
    aiProvider: 'gemini',
    aiModel: 'gemini-3.5-flash-lite',
    apiKey: '',
    markitdownEnabled: true,
    markitdownEndpoint: '',
    syntaxHL: true,
    autoPreview: true
  }),
  getItem() { return this._value; },
  setItem(_key, value) { this._value = value; }
};

global.MARKAI_CONFIG = {
  backendUrl: 'https://example.run.app'
};

delete require.cache[require.resolve('../frontend/modules/core_state.js')];
require('../frontend/modules/core_state.js');

const AppState = global.MarkAICore.AppState;
AppState.loadSettings();

assert.equal(
  AppState.get('settings').markitdownEndpoint,
  'https://example.run.app',
  'public portal must restore configured backend when saved endpoint is empty'
);

console.log('public backend persistence test: ok');
