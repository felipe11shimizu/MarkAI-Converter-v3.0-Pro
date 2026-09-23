'use strict';
const assert = require('node:assert/strict');
require('../frontend/modules/conversion_quality.js');
assert.ok(global.MarkAIConversionQuality);
assert.deepEqual(global.MarkAIConversionQuality.metrics('# T\n\ntexto'), {
  characters: 8, lines: 3, headings: 1, tables: 0, links: 0, words: 2
});
assert.equal(global.MarkAIConversionQuality.diffScore('a','a'), 0);
assert.equal(global.MarkAIConversionQuality.diffScore('a','b'), 100);
console.log('conversion_quality module tests: ok');
