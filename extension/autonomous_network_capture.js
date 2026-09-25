(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.DevTrailAutonomousNetworkCapture = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SENSITIVE = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|passwd|senha|token)$/i;
  const NOISE = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|css)(?:\?|$)|google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|fonts\.(?:googleapis|gstatic)\.com/i;
  const BINARY = /^(image\/|font\/|audio\/|video\/|application\/octet-stream)/i;

  const clip = (value, limit) => {
    if (value == null) return null;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  };

  function redactObject(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(redactObject);
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [
      key, SENSITIVE.test(key) ? '[REDACTED]' : redactObject(val)
    ]));
  }

  function redactHeaders(headers) {
    return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [
      key, SENSITIVE.test(key) ? '[REDACTED]' : clip(value, 1000)
    ]));
  }

  function normalizeRequest(params, timestamp) {
    const request = params?.request || {};
    return {
      requestId: params?.requestId || null,
      url: clip(request.url, 2000),
      method: request.method || null,
      payload: redactObject(clip(request.postData || null, 12000)),
      headers: redactHeaders(request.headers || {}),
      timestamp_epoch_ms: timestamp
    };
  }

  function normalizeResponse(params, request, responsePreview, timestamp) {
    const response = params?.response || {};
    return {
      requestId: params?.requestId || request?.requestId || null,
      url: clip(response.url || request?.url, 2000),
      method: request?.method || null,
      status: response.status ?? null,
      mimeType: response.mimeType || null,
      payload: request?.payload || null,
      headers: request?.headers || {},
      response_preview: clip(responsePreview, 5000),
      tempo_resposta_ms: request?.timestamp_epoch_ms ? Math.max(0, timestamp - request.timestamp_epoch_ms) : null,
      timestamp_epoch_ms: timestamp
    };
  }

  function shouldCapture(url, mimeType) {
    return Boolean(url) && !NOISE.test(String(url)) && !BINARY.test(String(mimeType || ''));
  }

  function create(api, options = {}) {
    const state = options.state;
    const now = options.now || (() => Date.now());
    const pending = new Map();
    let installed = false;

    function push(record) {
      if (!state) return;
      if (!Array.isArray(state.network)) state.network = [];
      state.network.push(record);
      if (state.network.length > 2000) state.network.shift();
    }

    function onEvent(source, method, params) {
      if (!state?.active || source?.tabId !== state.tabId) return;

      if (method === 'Network.requestWillBeSent') {
        const record = normalizeRequest(params, now());
        if (!shouldCapture(record.url)) return;
        pending.set(record.requestId, record);
        return;
      }

      if (method === 'Network.responseReceived') {
        const request = pending.get(params?.requestId);
        const response = params?.response || {};
        if (!request || !shouldCapture(response.url || request.url, response.mimeType)) return;

        const record = normalizeResponse(params, request, null, now());
        pending.delete(params.requestId);

        if (api?.debugger?.sendCommand) {
          Promise.resolve(api.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId }))
            .then(body => {
              push(normalizeResponse(params, request, body?.body || null, now()));
            })
            .catch(() => push(record));
        } else {
          push(record);
        }
      }
    }

    function install() {
      if (installed || !api?.debugger?.onEvent?.addListener) return false;
      api.debugger.onEvent.addListener(onEvent);
      installed = true;
      return true;
    }

    return Object.freeze({ install, onEvent, normalizeRequest, normalizeResponse });
  }

  return Object.freeze({
    create,
    normalizeRequest,
    normalizeResponse,
    shouldCapture,
    redactObject,
    redactHeaders
  });
});
