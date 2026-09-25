const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'frontend/config.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(config, /MARKAI_CONFIG/);
assert.match(config, /https:\/\/markai-converter-v3-0-pro-690234982000\.europe-west1\.run\.app/);
assert.match(index, /frontend\/config\.js/);

const configPos = index.indexOf('frontend/config.js');
const corePos = index.indexOf('frontend/modules/core_state.js');
assert.ok(configPos >= 0, 'public runtime config must be loaded');
assert.ok(corePos >= 0, 'core state module must be loaded');
assert.ok(configPos < corePos, 'runtime config must load before core state');

console.log('test_public_backend_config: ok');
