'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync(require.resolve('../script.js'), 'utf8');

assert.match(
  script,
  /workspaceController:\s*\{\s*saveVersion:\s*\(\.\.\.args\)\s*=>\s*WorkspaceController\.saveVersion\(\.\.\.args\)\s*\}/,
  'AI UI bootstrap must resolve WorkspaceController lazily'
);

assert.doesNotMatch(
  script,
  /workspaceStore:\s*WorkspaceStore,\s*workspaceController:\s*WorkspaceController,/,
  'AI UI bootstrap must not capture WorkspaceController before initialization'
);

assert.match(
  script,
  /youtubeController:\s*\{\s*updateControls:\s*\(\.\.\.args\)\s*=>\s*YouTubeController\.updateControls\(\.\.\.args\),\s*transcribe:\s*\(\.\.\.args\)\s*=>\s*YouTubeController\.transcribe\(\.\.\.args\),\s*listLanguages:\s*\(\.\.\.args\)\s*=>\s*YouTubeController\.listLanguages\(\.\.\.args\)\s*\}/,
  'URL UI bootstrap must resolve YouTubeController lazily'
);

assert.doesNotMatch(
  script,
  /urlService:\s*URLFetcher,\s*youtubeController:\s*YouTubeController,/,
  'URL UI bootstrap must not capture YouTubeController before initialization'
);

console.log('bootstrap dependency order tests: ok');
