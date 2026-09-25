(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousNetworkCapture = api;
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


  function normalizePayload(value) {
    if (value == null) return null;
    if (typeof value === 'object') return redactObject(value);
    const text = clip(value, 12000);
    try {
      return redactObject(JSON.parse(text));
    } catch (_) {
      return text;
    }
  }

  function normalizeRequest(params, timestamp) {
    const request = params?.request || {};
    return {
      requestId: params?.requestId || null,
      url: clip(request.url, 2000),
      method: request.method || null,
      payload: normalizePayload(request.postData || null),
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

    async function handleResponseReceived(tab, params) {
      if (!state?.active || tab?.tabId !== state.tabId) return;

      const request = pending.get(params?.requestId);
      if (!request) return;

      pending.delete(params.requestId);

      let body = '';
      try {
        const result = await api?.debugger?.sendCommand?.(
          { tabId: state.tabId },
          'Network.getResponseBody',
          { requestId: params.requestId }
        );
        body = result?.body || '';
      } catch (_) {
        // Response bodies are optional; preserve the network record.
      }

      let payload = request.postData;
      try {
        payload = request.postData ? redactObject(JSON.parse(request.postData)) : undefined;
      } catch (_) {
        // Keep non-JSON request bodies as strings.
      }

      const response = params?.response || {};
      const preview = typeof body === 'string' ? body.slice(0, 1000) : clip(body, 1000);

      push({
        requestId: params.requestId || null,
        url: response.url || request.url || null,
        method: request.method || null,
        status: response.status ?? null,
        mimeType: response.mimeType || null,
        headers: redactHeaders(request.headers || {}),
        ...(payload === undefined ? {} : { payload }),
        response_preview: preview,
        timestamp_epoch_ms: now()
      });
    }

    function onEvent(tab, method, params) {
      if (!state?.active || tab?.tabId !== state.tabId) return;

      if (method === 'Network.requestWillBeSent') {
        pending.set(params?.requestId, {
          url: params?.request?.url,
          method: params?.request?.method,
          headers: params?.request?.headers || {},
          postData: params?.request?.postData
        });
        return;
      }

      if (method === 'Network.responseReceived') {
        void handleResponseReceived(tab, params);
      }
    }

    function install() {
      if (installed || !api?.debugger?.onEvent?.addListener) return false;
      api.debugger.onEvent.addListener(onEvent);
      installed = true;
      return true;
    }

    return Object.freeze({
      install,
      onEvent,
      normalizeRequest,
      normalizeResponse,
      handleResponseReceived
    });
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
