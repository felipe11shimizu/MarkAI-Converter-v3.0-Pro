'use strict';

const assert = require('assert');
const Dom = require('../frontend/modules/ui_dom.js');

assert.ok(Dom);
assert.strictEqual(Dom.EXT_LABELS.pdf, 'PDF');
assert.ok(Dom.CODE_EXTS.has('js'));
assert.strictEqual(Dom.extClass('pdf'), 'ext-pdf');
assert.strictEqual(Dom.formatSize(1024), '1.0 KB');
assert.strictEqual(Dom.escapeHtml('<script>'), '&lt;script&gt;');

global.document = {
  getElementById(id) {
    return { id };
  },
  createElement(tag) {
    return {
      tagName: tag,
      children: [],
      appendChild(node) { this.children.push(node); },
      set textContent(value) { this._text = value; },
      get outerHTML() { return '<pre><code>' + this._text + '</code></pre>'; }
    };
  }
};
global.marked = { parse(value) { return '<p>' + value + '</p>'; } };

const view = Dom.create();
assert.strictEqual(view.$('foo').id, 'foo');
assert.strictEqual(view.els.fileInput.id, 'fileInput');
assert.strictEqual(typeof view.els.queueList.id, 'string');

console.log('ui_dom tests passed');
