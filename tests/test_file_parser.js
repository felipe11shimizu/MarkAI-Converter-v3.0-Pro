'use strict';

const assert = require('node:assert/strict');

const FileParser = require('../frontend/modules/file_parser.js');

assert.ok(FileParser);
for (const method of ['parse', 'parseBrowser']) {
  assert.equal(typeof FileParser[method], 'function', method + ' should be exported');
}

console.log('file_parser module tests: ok');
