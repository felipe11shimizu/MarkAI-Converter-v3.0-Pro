(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIDevTrailExplorerPolicy = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    maxDurationMs: 10 * 60 * 1000,
    maxPages: 25,
    maxActions: 100,
    sameOriginOnly: true,
    allowForms: false,
    allowMutatingMethods: false
  });

  const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const SENSITIVE_NAME = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|passwd|senha|token)$/i;

  function normalize(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    return {
      maxDurationMs: Math.max(30_000, Number(source.maxDurationMs) || DEFAULTS.maxDurationMs),
      maxPages: Math.max(1, Math.min(100, Number(source.maxPages) || DEFAULTS.maxPages)),
      maxActions: Math.max(1, Math.min(500, Number(source.maxActions) || DEFAULTS.maxActions)),
      sameOriginOnly: source.sameOriginOnly !== false,
      allowForms: source.allowForms === true,
      allowMutatingMethods: source.allowMutatingMethods === true
    };
  }

  function canNavigate(currentUrl, targetUrl, policy) {
    try {
      const current = new URL(currentUrl);
      const target = new URL(targetUrl, currentUrl);
      if (!/^https?:$/i.test(target.protocol)) return false;
      return !policy.sameOriginOnly || current.origin === target.origin;
    } catch (_) {
      return false;
    }
  }

  function canExecuteAction(action, policy) {
    const type = String(action?.type || '').toLowerCase();
    if (type === 'navigate') return canNavigate(action.currentUrl, action.url, policy);
    if (type === 'submit' || type === 'form') return policy.allowForms === true;
    if (type === 'network') {
      const method = String(action.method || 'GET').toUpperCase();
      return !MUTATING_METHODS.has(method) || policy.allowMutatingMethods === true;
    }
    return ['scan', 'inspect'].includes(type);
  }

  function redactKey(key) {
    return SENSITIVE_NAME.test(String(key || ''));
  }

  return { DEFAULTS, normalize, canNavigate, canExecuteAction, redactKey };
});
