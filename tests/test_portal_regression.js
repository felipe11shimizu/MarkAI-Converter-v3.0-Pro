'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

const requiredModules = [
  'frontend/modules/core_state.js',
  'frontend/modules/ui_dom.js',
  'frontend/modules/markitdown_engine.js',
  'frontend/modules/workspace_store.js',
  'frontend/modules/workspace_controller.js',
  'frontend/modules/workspace_ui_controller.js',
  'frontend/modules/queue_ui_controller.js',
  'frontend/modules/youtube_controller.js',
  'frontend/modules/editor_controller.js',
  'frontend/modules/editor_ui_controller.js',
  'frontend/modules/file_parser.js',
  'frontend/modules/merge_engine.js',
  'frontend/modules/conversion_controller.js',
  'frontend/modules/ai_engine.js',
  'frontend/modules/ai_ui_controller.js',
  'frontend/modules/comparison_ui_controller.js',
  'frontend/modules/file_actions_ui_controller.js',
  'frontend/modules/url_fetcher.js',
  'frontend/modules/url_ui_controller.js',
  'frontend/modules/chat_formatter.js',
  'frontend/modules/conversion_quality.js',
  'frontend/modules/video_evidence_timeline.js',
  'video_automation_validator.js',
  'frontend/modules/video_automation_controller.js',
  'frontend/modules/settings_controller.js',
  'script.js'
];

for (const modulePath of requiredModules) {
  assert.ok(
    index.includes(`<script src="${modulePath}"></script>`),
    `Portal must load module: ${modulePath}`
  );
}

const requiredElements = [
  'fileInput',
  'dropZone',
  'queueList',
  'urlInput',
  'btnFetchUrl',
  'btnYoutubeTranscribe',
  'btnYoutubeLanguages',
  'btnEnhanceAI',
  'workspaceProjectSelect',
  'btnCompare',
  'btnUseMarkItDown',
  'btnUseBrowser',
  'btnDownload',
  'btnReset',
  'btnSettings',
  'modalSettings',
  'btnSaveSettings',
  'videoAutomationTarget',
  'btnFinalizeVideoReview',
  'btnDownloadVideoReviewPackage',
  'btnDownloadVideoReviewAudit'
];

for (const id of requiredElements) {
  assert.match(
    index,
    new RegExp(`id=["']${id}["']`),
    `Portal must expose DOM contract: ${id}`
  );
}

const bootstrapContracts = [
  'MarkAIWorkspaceController.create',
  'MarkAIQueueUIController.create',
  'MarkAIYouTubeController.create',
  'MarkAIVideoAutomationController.create',
  'MarkAISettingsController.create',
  'MarkAIFileActionsUIController.create',
  'MarkAIComparisonUIController.create',
  'UrlUIController.bind()',
  'AIUIController.bind()',
  'FileActionsUIController.bind()',
  'ComparisonUIController.bind()'
];

for (const contract of bootstrapContracts) {
  assert.match(
    script,
    new RegExp(contract.replace(/[.*+?^{}()|[\]\\]/g, '\\$&')),
    `Bootstrap contract missing: ${contract}`
  );
}

assert.match(
  script,
  /File ingestion is centralized in QueueUIController/,
  'File ingestion must remain centralized'
);

assert.match(
  script,
  /openSettings:s*()s*=>s*{s*SettingsController.sync();s*els.modalSettings.showModal();s*}/,
  'Settings opener contract must remain intact'
);

console.log('portal regression contract tests: ok');
