'use strict';

const assert = require('node:assert/strict');

const ConversionQuality = require('../frontend/modules/conversion_quality.js');

assert.ok(ConversionQuality);
assert.deepEqual(ConversionQuality.metrics('# T\n\ntexto'), {
  characters: 10, lines: 3, headings: 1, tables: 0, links: 0, words: 3
});
assert.equal(ConversionQuality.diffScore('a', 'a'), 0);
assert.equal(ConversionQuality.diffScore('a', 'b'), 100);

const realisticMarkdown = '# Relatório de conversão\\n\\nEste é um documento com [um link](https://example.com).\\n\\n| Coluna A | Coluna B |\\n| --- | --- |\\n| 10 | 20 |';
assert.deepEqual(ConversionQuality.metrics(realisticMarkdown), {
  characters: 132,
  lines: 7,
  headings: 1,
  tables: 3,
  links: 1,
  words: 28
});

console.log('conversion_quality module tests: ok');
