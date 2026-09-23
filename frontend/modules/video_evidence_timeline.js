(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkAIVideoEvidenceTimeline = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REVIEW_STATUSES = new Set(['pending', 'approved', 'ignored']);

  function finiteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function text(value) {
    return String(value ?? '').trim();
  }

  function numberArray(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map(item => finiteNumber(item))
      .filter(item => item !== null)
      .map(item => Math.trunc(item)))];
  }

  function timestampSeconds(value, fallback = null) {
    const numeric = finiteNumber(value);
    if (numeric !== null) return Math.max(0, numeric);

    const raw = text(value);
    if (!raw) return fallback;

    const parts = raw.split(':').map(part => Number(part));
    if (parts.some(part => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) {
      return fallback;
    }

    if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
    return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }

  function normalizeReviewStatus(value) {
    const status = text(value).toLowerCase();
    return REVIEW_STATUSES.has(status) ? status : 'pending';
  }

  function normalizeFrames(frames) {
    if (!Array.isArray(frames)) return [];

    return frames
      .map((frame, index) => {
        const item = frame && typeof frame === 'object' ? frame : {};
        const frameIndex = finiteNumber(item.frame_index ?? item.frameIndex ?? item.index, index + 1);
        return {
          frameIndex: Math.max(1, Math.trunc(frameIndex)),
          timestamp: timestampSeconds(item.timestamp ?? item.timestamp_seconds, 0),
          transcriptSegmentIndices: numberArray(
            item.transcript_segment_indices ?? item.transcriptSegmentIndices
          ),
          evidence: item.evidence && typeof item.evidence === 'object'
            ? { ...item.evidence }
            : {}
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp || a.frameIndex - b.frameIndex);
  }

  function normalizeTranscriptSegments(segments) {
    if (!Array.isArray(segments)) return [];

    return segments.map((segment, index) => {
      const item = segment && typeof segment === 'object' ? segment : {};
      const start = timestampSeconds(item.start ?? item.start_seconds, 0);
      const duration = Math.max(0, finiteNumber(item.duration, 0));
      const end = timestampSeconds(item.end ?? item.end_seconds, start + duration);

      return {
        index: Math.trunc(finiteNumber(item.index, index + 1)),
        start,
        duration,
        end: Math.max(start, end),
        text: text(item.text),
        language: text(item.language),
        source: item.source ?? null
      };
    });
  }

  function normalizeStep(step, index) {
    const item = step && typeof step === 'object' ? step : {};
    const evidenceSource = item.evidencia && typeof item.evidencia === 'object'
      ? item.evidencia
      : {};

    const frameIndices = numberArray(
      evidenceSource.frame_indices ??
      evidenceSource.frameIndices ??
      item.frame_indices ??
      item.frameIndices
    );

    const transcriptSegmentIndices = numberArray(
      evidenceSource.transcript_segment_indices ??
      evidenceSource.transcriptSegmentIndices ??
      item.transcript_segment_indices ??
      item.transcriptSegmentIndices ??
      item.segmentos_transcricao
    );

    const timestamp = timestampSeconds(
      evidenceSource.timestamp_seconds ??
      evidenceSource.timestamp ??
      item.timestamp,
      null
    );

    const confidenceValue = finiteNumber(item.confianca ?? item.confidence, null);
    const confidence = confidenceValue === null
      ? null
      : Math.max(0, Math.min(1, confidenceValue));

    const evidence = {
      ...evidenceSource,
      timestampSeconds: timestamp,
      frameIndices,
      transcriptSegmentIndices
    };

    return {
      order: Math.max(1, Math.trunc(finiteNumber(item.ordem ?? item.order, index + 1))),
      timestamp,
      action: text(item.acao ?? item.action),
      actionType: text(item.tipo_acao ?? item.actionType),
      details: text(item.detalhes ?? item.details),
      precondition: text(item.precondicao ?? item.precondition),
      postcondition: text(item.poscondicao ?? item.postcondition),
      result: text(item.resultado ?? item.result),
      confidence,
      reviewStatus: normalizeReviewStatus(item.review_status ?? item.reviewStatus),
      frameIndices,
      transcriptSegmentIndices,
      evidence
    };
  }

  function normalizeDuration(data) {
    const analysis = data?.analysis && typeof data.analysis === 'object' ? data.analysis : {};
    return Math.max(0, finiteNumber(
      data?.duration ??
      data?.duration_seconds ??
      analysis.duration ??
      analysis.duracao ??
      0,
      0
    ));
  }

  function normalize(data = {}) {
    const source = data && typeof data === 'object' ? data : {};
    const analysis = source.analysis && typeof source.analysis === 'object'
      ? source.analysis
      : {};

    const rawFrames = source.timeline ?? analysis.timeline ?? source.frames ?? [];
    const rawSegments = source.transcript_segments ?? analysis.transcript_segments ?? [];
    const rawSteps = analysis.etapas ?? source.steps ?? [];

    return {
      duration: normalizeDuration(source),
      frames: normalizeFrames(rawFrames),
      transcriptSegments: normalizeTranscriptSegments(rawSegments),
      steps: Array.isArray(rawSteps)
        ? rawSteps.map(normalizeStep).sort((a, b) => a.order - b.order || (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity))
        : []
    };
  }

  return {
    REVIEW_STATUSES: Array.from(REVIEW_STATUSES),
    normalize,
    normalizeFrames,
    normalizeTranscriptSegments,
    normalizeStep,
    timestampSeconds
  };
});
