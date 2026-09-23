'use strict';

const assert = require('node:assert/strict');

const ConversionQuality = require('../frontend/modules/conversion_quality.js');

assert.ok(ConversionQuality);
assert.deepEqual(ConversionQuality.metrics('# T\n\ntexto'), {
  characters: 10, lines: 3, headings: 1, tables: 0, links: 0, words: 3
});
assert.equal(ConversionQuality.diffScore('a', 'a'), 0);
assert.equal(ConversionQuality.diffScore('a', 'b'), 100);

console.log('conversion_quality module tests: ok');
