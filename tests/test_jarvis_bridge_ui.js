const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'frontend/modules/jarvis_bridge_controller.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'backend/jarvis_bridge.py'), 'utf8');

assert.match(html, /id="btnTeachJarvis"/);
assert.match(html, /Salvar no Segundo Cérebro/);
assert.match(html, /repositório privado do Segundo Cérebro JARVIS/);
assert.match(html, /sincronizado com o cofre/);
assert.match(html, /id="modalJarvis"/);
assert.match(html, /id="btnJarvisPublish"[^>]*disabled/);
assert.match(html, /frontend\/modules\/jarvis_bridge_controller\.js/);
assert.match(controller, /\/api\/jarvis\/notes\/preview/);
assert.match(controller, /confirm_publish: true/);
assert.match(controller, /Markdown salvo no Segundo Cérebro JARVIS/);
assert.match(controller, /window\.confirm/);
assert.match(backend, /TARGET_REPO = "felipe11shimizu\/jarvis-segundo-cerebro"/);
assert.match(backend, /JARVIS_GITHUB_TOKEN/);
assert.match(backend, /confirm_publish is not True/);
assert.match(backend, /status_code=409/);

console.log('test_jarvis_bridge_ui: ok');
