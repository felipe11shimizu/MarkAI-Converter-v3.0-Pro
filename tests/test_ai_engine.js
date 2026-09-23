'use strict';

const assert = require('node:assert/strict');
const { SYSTEM_PROMPT, create } = require('../frontend/modules/ai_engine.js');

assert.ok(SYSTEM_PROMPT.includes('professional Markdown formatter'));
assert.equal(typeof create, 'function');

(async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '# Resultado' } }] })
    };
  };
  const engine = create({
    getSettings: () => ({ apiKey: 'test-key', aiProvider: 'openai', aiModel: 'test-model' }),
    fetchImpl
  });
  assert.equal(await engine.enhance('texto'), '# Resultado');
  assert.match(calls[0].url, /api\.openai\.com/);
  assert.equal(calls[0].options.method, 'POST');

  const geminiFetch = async (url) => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: '# Gemini' }] } }] })
  });
  const gemini = create({
    getSettings: () => ({ apiKey: 'test-key', aiProvider: 'gemini', aiModel: 'gemini-test' }),
    fetchImpl: geminiFetch
  });
  assert.equal(await gemini.enhance('texto', 'preserve tables'), '# Gemini');

  const noKey = create({ getSettings: () => ({}), fetchImpl });
  await assert.rejects(() => noKey.enhance('texto'), /API Key não configurada/);

  console.log('ai_engine module tests: ok');
})();
