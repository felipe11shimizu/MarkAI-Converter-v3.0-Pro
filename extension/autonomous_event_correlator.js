(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousEventCorrelator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_WINDOW_MS = 5000;
  const MAX_NETWORK_PER_EVENT = 50;

  function toTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function normalizeDomEvent(event, index) {
    return {
      event_id: event?.event_id || 'dom-' + (index + 1),
      tipo_evento: event?.tipo_evento || event?.type || 'unknown',
      timestamp_epoch_ms: toTimestamp(event?.timestamp_epoch_ms),
      elemento: event?.elemento || event?.selector || null,
      valor_entrada: event?.valor_entrada ?? null,
      url: event?.url || null
    };
  }

  function normalizeNetworkEvent(event) {
    return {
      requestId: event?.requestId || null,
      url: event?.url || null,
      metodo: event?.metodo || event?.method || null,
      status: event?.status ?? null,
      timestamp_epoch_ms: toTimestamp(event?.timestamp_epoch_ms),
      tempo_resposta_ms: event?.tempo_resposta_ms ?? null,
      payload: event?.payload ?? null,
      response_preview: event?.response_preview ?? null
    };
  }

  function correlate(domEvents = [], networkEvents = [], options = {}) {
    const windowMs = Number.isFinite(Number(options.windowMs))
      ? Math.max(0, Number(options.windowMs))
      : DEFAULT_WINDOW_MS;
    const maxNetworkPerEvent = Number.isFinite(Number(options.maxNetworkPerEvent))
      ? Math.max(1, Number(options.maxNetworkPerEvent))
      : MAX_NETWORK_PER_EVENT;

    const network = networkEvents
      .map(normalizeNetworkEvent)
      .filter(event => event.timestamp_epoch_ms != null);

    return domEvents.map(normalizeDomEvent).map((dom, index) => {
      const calls = dom.timestamp_epoch_ms == null
        ? []
        : network
          .filter(net =>
            net.timestamp_epoch_ms >= dom.timestamp_epoch_ms &&
            net.timestamp_epoch_ms <= dom.timestamp_epoch_ms + windowMs
          )
          .sort((a, b) => a.timestamp_epoch_ms - b.timestamp_epoch_ms)
          .slice(0, maxNetworkPerEvent);

      return {
        step_id: index + 1,
        event_id: dom.event_id,
        tipo_evento: dom.tipo_evento,
        timestamp_epoch_ms: dom.timestamp_epoch_ms,
        elemento: dom.elemento,
        valor_entrada: dom.valor_entrada,
        url: dom.url,
        chamadas_rede: calls
      };
    });
  }

  function summarize(steps = []) {
    return {
      total_steps: steps.length,
      steps_with_network: steps.filter(step => step.chamadas_rede?.length > 0).length,
      total_network_calls: steps.reduce(
        (total, step) => total + (step.chamadas_rede?.length || 0),
        0
      )
    };
  }

  return Object.freeze({
    DEFAULT_WINDOW_MS,
    MAX_NETWORK_PER_EVENT,
    normalizeDomEvent,
    normalizeNetworkEvent,
    correlate,
    summarize
  });
});
