'use strict';

const assert = require('node:assert/strict');

require('../frontend/modules/url_fetcher.js');

assert.ok(global.MarkAIUrlService);
assert.equal(typeof global.MarkAIUrlService.fetch, 'function');
assert.equal(typeof global.MarkAIUrlService.isYouTubeUrl, 'function');

assert.equal(global.MarkAIUrlService.isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
assert.equal(global.MarkAIUrlService.isYouTubeUrl('https://example.com/video'), false);
assert.equal(global.MarkAIUrlService.isYouTubeUrl('not-a-url'), false);

console.log('url_fetcher module tests: ok');
