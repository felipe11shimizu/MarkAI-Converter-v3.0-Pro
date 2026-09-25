/**
 * MarkAI Converter — production runtime configuration.
 *
 * This file contains public, non-secret configuration only.
 * Secrets (OpenAI/Gemini keys) must never be stored here.
 *
 * The backend URL can still be overridden with:
 *   ?backend=https://SEU-BACKEND
 */
(function (root) {
  'use strict';

  const existing = root.MARKAI_CONFIG || {};
  root.MARKAI_CONFIG = {
    ...existing,
    backendUrl: existing.backendUrl ||
      'https://markai-converter-v3-0-pro-690234982000.europe-west1.run.app'
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
