'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const content = fs.readFileSync(path.join(root, 'extension', 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes('debugger'));
assert.ok(manifest.permissions.includes('storage'));
assert.ok(manifest.permissions.includes('tabs'));
assert.match(background, /Network\.requestWillBeSent/);
assert.match(background, /Network\.responseReceived/);
assert.match(background, /Runtime\.consoleAPICalled/);
assert.match(background, /Runtime\.exceptionThrown/);
assert.match(background, /15 \* 60 \* 1000/);
assert.match(background, /target_tab_closed/);
assert.match(content, /data-testid/);
assert.match(content, /CSS\.escape/);
assert.match(content, /setTimeout\(\(\) => emit\('input'/);
assert.match(content, /password/i);
assert.match(index, /devtrail_controller\.js/);
assert.match(index, /devtrail_formatters\.js/);
assert.match(index, /btnDevTrailStart/);
assert.match(style, /devtrail-/);

console.log('devtrail contract tests: ok');
