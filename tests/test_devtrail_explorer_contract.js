'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'extension', 'explorer', 'explorer_policy.js'), 'utf8');
const state = fs.readFileSync(path.join(root, 'extension', 'explorer', 'explorer_state.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'extension', 'explorer', 'explorer_engine.js'), 'utf8');

assert.match(background, /importScripts\('explorer\/explorer_policy\.js', 'explorer\/explorer_state\.js', 'explorer\/explorer_engine\.js'\)/);
assert.match(background, /explorerSession/);
assert.match(background, /DEVTRAIL_EXPLORER_START/);
assert.match(background, /DEVTRAIL_EXPLORER_STOP/);
assert.match(background, /DEVTRAIL_EXPLORER_STATUS/);
assert.match(background, /DEVTRAIL_EXPLORER_PAGE/);
assert.match(background, /DEVTRAIL_EXPLORER_ACTION/);
assert.match(background, /DEVTRAIL_EXPLORER_FINISHED/);
assert.match(policy, /sameOriginOnly/);
assert.match(policy, /allowMutatingMethods/);
assert.match(policy, /MUTATING_METHODS/);
assert.match(state, /visitedUrls/);
assert.match(state, /addBounded/);
assert.match(engine, /maxDurationMs/);
assert.match(engine, /maxPages/);
assert.match(engine, /maxActions/);
assert.match(engine, /recordPage/);
assert.match(engine, /recordAction/);

console.log('devtrail explorer architecture contract: ok');
