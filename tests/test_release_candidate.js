'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'backend', 'app.py'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

assert.match(index, /MarkAI Converter v3\.6 Pro/);
assert.match(index, /id="fileInput"/);
assert.match(index, /id="mergeMarkFiles"/);
assert.match(index, /id="dropZone"/);
assert.match(index, /id="btnDownload"/);
assert.match(index, /id="btnReset"/);
assert.match(index, /id="workspaceProjectSelect"/);
assert.match(index, /id="btnEnhanceAI"/);
assert.match(index, /id="btnFinalizeVideoReview"/);
assert.match(index, /id="btnDownloadVideoReviewPackage"/);

assert.match(readme, /^# MarkAI Converter v3\.6 Pro/m);
assert.doesNotMatch(readme, /^# MarkAI Converter v3\.1 Pro/m);

assert.match(backend, /APP_VERSION = "3\.6\.0"/);
assert.match(backend, /@app\.get\("\/api\/health"\)/);
assert.match(backend, /allow_credentials=False/);
assert.match(backend, /convert_local/);
assert.match(backend, /URLs com credenciais embutidas não são permitidas/);
assert.match(dockerfile, /ffmpeg/);
assert.match(dockerfile, /uvicorn backend\.app:app/);

console.log('release candidate smoke contracts: ok');
