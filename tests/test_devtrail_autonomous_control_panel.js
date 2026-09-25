const assert = require('node:assert/strict');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
const popup = fs.readFileSync('extension/popup.html', 'utf8');
const popupJs = fs.readFileSync('extension/popup.js', 'utf8');

assert.equal(manifest.action.default_popup, 'popup.html');
assert.match(popup, /id="start"/);
assert.match(popup, /id="scan"/);
assert.match(popup, /id="map"/);
assert.match(popup, /id="cycle"/);
assert.match(popup, /id="status"/);
assert.match(popup, /id="kill"/);
assert.match(popupJs, /DEVTRAIL_AUTONOMOUS_START/);
assert.match(popupJs, /DEVTRAIL_AUTONOMOUS_SCAN_DOM/);
assert.match(popupJs, /DEVTRAIL_AUTONOMOUS_BUILD_MAP/);
assert.match(popupJs, /DEVTRAIL_AUTONOMOUS_CYCLE/);
assert.match(popupJs, /DEVTRAIL_AUTONOMOUS_STATUS/);
assert.match(popupJs, /DEVTRAIL_AUTONOMOUS_KILL/);

console.log('devtrail autonomous control panel tests: ok');
