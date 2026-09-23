'use strict';
const assert = require('node:assert/strict');
require('../frontend/modules/chat_formatter.js');
assert.ok(global.MarkAIChatFormatter);
assert.equal(typeof global.MarkAIChatFormatter.format, 'function');
const out = global.MarkAIChatFormatter.format('User: Olá\nAI: Olá!\n');
assert.match(out, /Usuário/);
assert.match(out, /IA/);
console.log('chat_formatter module tests: ok');
