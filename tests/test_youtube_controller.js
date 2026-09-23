'use strict';

const assert = require('node:assert/strict');
const YouTubeController = require('../frontend/modules/youtube_controller.js');

assert.equal(typeof YouTubeController.create, 'function');

const calls = [];
const fakeFetch = async (url, options) => {
  calls.push({ url, options });
  return {
    ok: true,
    async json() {
      if (url.endsWith('/transcripts')) {
        return { transcripts: [{ language: 'Português', language_code: 'pt-BR', is_generated: false, is_translatable: true }] };
      }
      return {
        markdown: '# Transcrição',
        video_id: 'abc123',
        is_generated: true,
        language_code: 'pt-BR',
        quality: { segments: 2, words: 8 }
      };
    }
  };
};

const events = [];
const controller = YouTubeController.create({
  urlService: { isYouTubeUrl: url => String(url).includes('youtube.com/watch') },
  getSettings: () => ({ markitdownEndpoint: 'http://localhost:8000/' }),
  fetchImpl: fakeFetch,
  ui: {
    setControlsVisible: value => events.push(['visible', value]),
    setStatusText: value => events.push(['text', value]),
    setStatus: (value, state) => events.push(['status', value, state]),
    showProcessing: value => events.push(['processing', value]),
    hideProcessing: () => events.push(['hide']),
    loadMarkdown: (md, name) => events.push(['markdown', md, name]),
    toast: (message, type) => events.push(['toast', message, type])
  }
});

(async () => {
  assert.deepEqual(controller.languagePriority('auto'), ['pt-BR', 'pt', 'en', 'es']);
  assert.deepEqual(controller.languagePriority('en'), ['en', 'pt-BR', 'pt', 'es']);
  assert.equal(controller.updateControls('https://example.com'), false);
  assert.equal(controller.updateControls('https://youtube.com/watch?v=abc'), true);

  const transcription = await controller.transcribe('https://youtube.com/watch?v=abc', {
    language: 'pt-BR',
    translateTo: 'en'
  });
  assert.equal(transcription.video_id, 'abc123');
  assert.ok(events.some(e => e[0] === 'markdown' && e[1] === '# Transcrição'));
  assert.equal(calls[0].url, 'http://localhost:8000/api/youtube/transcribe');
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload.languages, ['pt-BR', 'pt', 'en', 'es']);
  assert.equal(payload.translate_to, 'en');

  await controller.listLanguages('https://youtube.com/watch?v=abc');
  assert.equal(calls[1].url, 'http://localhost:8000/api/youtube/transcripts');
  assert.ok(events.some(e => e[0] === 'text' && e[1].includes('Legendas disponíveis')));

  console.log('youtube_controller module tests: ok');
})();
