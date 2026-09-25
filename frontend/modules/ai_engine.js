(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkAIAIEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SYSTEM_PROMPT = `You are a professional Markdown formatter and technical writer.
Your task: receive raw text (possibly from OCR, PDFs, or code) and return ONLY clean, well-structured Markdown.
Rules:
- Fix OCR noise (garbled characters, broken words, misread ligatures)
- Organize content with proper heading hierarchy (H1 > H2 > H3)
- Align and fix broken Markdown tables
- Preserve code blocks with correct language tags
- Clean up redundant whitespace and line breaks
- Format lists properly (bulleted and numbered)
- Use blockquotes for important callouts
- Do NOT add commentary, preamble, or explanation — return ONLY the Markdown.`;

  function create({ getSettings, fetchImpl, timeoutMs = 60000 } = {}) {
    if (typeof getSettings !== 'function') throw new TypeError('AIEngine requires getSettings.');
    const requestFetch = fetchImpl || (typeof window !== 'undefined' ? window.fetch.bind(window) : null);
    if (typeof requestFetch !== 'function') throw new TypeError('AIEngine requires fetchImpl in non-browser environments.');

    async function enhance(markdown, customPrompt = '') {
      const settings = getSettings() || {};
      const prompt = String(customPrompt || '').trim();
      if (!settings.apiKey) throw new Error('API Key não configurada. Abra Configurações.');

      if (settings.aiProvider === 'gemini') {
        return _callGemini(markdown, settings.apiKey, settings.aiModel, prompt);
      }
      return _callOpenAI(markdown, settings.apiKey, settings.aiModel, prompt);
    }

    async function _callGemini(text, apiKey, model, customPrompt = '') {
      const effectiveSystemPrompt = customPrompt
        ? SYSTEM_PROMPT + '\\n\\nAdditional user instructions:\\n' + customPrompt
        : SYSTEM_PROMPT;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = {
        system_instruction: { parts: [{ text: effectiveSystemPrompt }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: { maxOutputTokens: 8192 }
      };
      const resp = await requestFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(timeoutMs)
          : undefined
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
      }
      const data = await resp.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || text;
    }

    async function _callOpenAI(text, apiKey, model, customPrompt = '') {
      const effectiveSystemPrompt = customPrompt
        ? SYSTEM_PROMPT + '\\n\\nAdditional user instructions:\\n' + customPrompt
        : SYSTEM_PROMPT;
      const resp = await requestFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: effectiveSystemPrompt },
            { role: 'user', content: text }
          ],
          temperature: 0.2,
          max_tokens: 8192
        }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(timeoutMs)
          : undefined
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `OpenAI API error ${resp.status}`);
      }
      const data = await resp.json();
      return data?.choices?.[0]?.message?.content || text;
    }

    return { enhance };
  }

  return { SYSTEM_PROMPT, create };
});
