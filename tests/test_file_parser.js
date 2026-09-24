'use strict';

const assert = require('node:assert/strict');

const FileParser = require('../frontend/modules/file_parser.js');

assert.ok(FileParser);
for (const method of ['parse', 'parseBrowser']) {
  assert.equal(typeof FileParser[method], 'function', method + ' should be exported');
}

// PPTX browser fallback should extract slide text without the MarkItDown backend.
{
  const originalJSZip = globalThis.JSZip;
  globalThis.JSZip = {
    async loadAsync() {
      return {
        files: {
          'ppt/slides/slide2.xml': {
            async async() {
              return '<p:sld><a:p><a:r><a:t>Segundo slide</a:t></a:r></a:p></p:sld>';
            }
          },
          'ppt/slides/slide1.xml': {
            async async() {
              return '<p:sld><a:p><a:r><a:t>Primeiro</a:t></a:r><a:r><a:t> slide</a:t></a:r></a:p></p:sld>';
            }
          }
        }
      };
    }
  };

  const progress = [];
  const markdown = await FileParser.parsePptx({
    name: 'apresentacao.pptx',
    async arrayBuffer() { return new ArrayBuffer(0); }
  }, value => progress.push(value));

  assert.match(markdown, /# apresentacao/);
  assert.match(markdown, /## Slide 1/);
  assert.match(markdown, /Primeiro slide/);
  assert.match(markdown, /## Slide 2/);
  assert.match(markdown, /Segundo slide/);
  assert.deepEqual(progress, [0.5, 1]);

  globalThis.JSZip = originalJSZip;
}

console.log('file_parser module tests: ok');
