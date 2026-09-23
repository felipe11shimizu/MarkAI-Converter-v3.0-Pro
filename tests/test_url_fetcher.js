'use strict';

const assert = require('node:assert/strict');

const UrlService = require('../frontend/modules/url_fetcher.js');

assert.ok(UrlService);
assert.equal(typeof UrlService.fetch, 'function');
assert.equal(typeof UrlService.isYouTubeUrl, 'function');

assert.equal(UrlService.isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
assert.equal(UrlService.isYouTubeUrl('https://example.com/video'), false);
assert.equal(UrlService.isYouTubeUrl('not-a-url'), false);

console.log('url_fetcher module tests: ok');
