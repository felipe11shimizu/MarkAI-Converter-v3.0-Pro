'use strict';

const assert = require('node:assert/strict');

require('../frontend/modules/file_parser.js');

assert.ok(global.MarkAIFileParser);
for (const method of ['parse', 'parseBrowser']) {
  assert.equal(typeof global.MarkAIFileParser[method], 'function', method + ' should be exported');
}

console.log('file_parser module tests: ok');
