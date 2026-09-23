'use strict';

const assert = require('node:assert/strict');

const ChatFormatter = require('../frontend/modules/chat_formatter.js');

assert.ok(ChatFormatter);
assert.equal(typeof ChatFormatter.format, 'function');

const out = ChatFormatter.format('User: Olá\nAI: Olá!\n');
assert.match(out, /Usuário/);
assert.match(out, /IA/);

console.log('chat_formatter module tests: ok');
