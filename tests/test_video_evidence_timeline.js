'use strict';

const assert = require('node:assert/strict');
const Timeline = require('../frontend/modules/video_evidence_timeline.js');

const input = {
  duration_seconds: '42',
  timeline: [
    { frame_index: 2, timestamp: 5, transcript_segment_indices: [2, 2, '3'] },
    { frame_index: 1, timestamp: '00:01', transcript_segment_indices: [] }
  ],
  transcript_segments: [
    { index: 1, start: '00:00', duration: 1.5, text: 'Abra o sistema', language: 'pt-BR' },
    { index: 2, start: 4, end: 6, text: 'Clique em continuar' }
  ],
  analysis: {
    etapas: [
      {
        ordem: '2',
        timestamp: '00:05',
        acao: 'Clique em continuar',
        tipo_acao: 'click',
        confianca: 1.2,
        review_status: 'approved',
        evidencia: {
          timestamp_seconds: 5,
          frame_indices: [2, 2],
          transcript_segment_indices: [2]
        }
      },
      {
        ordem: 1,
        timestamp: '00:01',
        acao: 'Abrir sistema',
        tipo_acao: 'open',
        confianca: 0.7
      },
      {
        ordem: 3,
        timestamp: '01:02',
        acao: 'Ignorar esta etapa',
        review_status: 'unknown'
      }
    ]
  }
};

const timeline = Timeline.normalize(input);

assert.equal(timeline.duration, 42);
assert.deepEqual(timeline.frames, [
  {
    frameIndex: 1,
    timestamp: 1,
    transcriptSegmentIndices: [],
    evidence: {}
  },
  {
    frameIndex: 2,
    timestamp: 5,
    transcriptSegmentIndices: [2, 3],
    evidence: {}
  }
]);

assert.deepEqual(timeline.transcriptSegments[0], {
  index: 1,
  start: 0,
  duration: 1.5,
  end: 1.5,
  text: 'Abra o sistema',
  language: 'pt-BR',
  source: null
});

assert.equal(timeline.transcriptSegments[1].end, 6);
assert.equal(timeline.steps.length, 3);
assert.equal(timeline.steps[0].order, 1);
assert.equal(timeline.steps[0].timestamp, 1);
assert.equal(timeline.steps[0].reviewStatus, 'pending');
assert.equal(timeline.steps[1].frameIndices[0], 2);
assert.deepEqual(timeline.steps[1].transcriptSegmentIndices, [2]);
assert.equal(timeline.steps[1].confidence, 1);
assert.equal(timeline.steps[2].timestamp, 62);

const before = JSON.stringify(input);
Timeline.normalize(input);
assert.equal(JSON.stringify(input), before);

{
  const legacy = Timeline.normalize({
    analysis: {
      etapas: [{
        ordem: 1,
        timestamp: 3,
        acao: 'Digitar',
        tipo_acao: 'type',
        segmentos_transcricao: [4],
        evidencia: { frame_indices: [3] }
      }]
    },
    frames: [{ index: 3, timestamp_seconds: 3 }]
  });

  assert.deepEqual(legacy.steps[0].frameIndices, [3]);
  assert.deepEqual(legacy.steps[0].transcriptSegmentIndices, [4]);
  assert.equal(legacy.frames[0].frameIndex, 3);
}

assert.equal(Timeline.timestampSeconds('01:02'), 62);
assert.equal(Timeline.timestampSeconds('01:02:03'), 3723);
assert.equal(Timeline.timestampSeconds('invalid'), null);

console.log('video evidence timeline tests: ok');

const quality = normalizeStep({ evidencia: { correlacao_evidencia: { status: 'forte', base: 'frame', frame_delta_seconds: 1.25 } } }, 0);
assert.deepEqual(quality.evidenceCorrelation, { status: 'forte', base: 'frame', frameDeltaSeconds: 1.25 });
