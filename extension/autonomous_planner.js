(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousPlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0';
  const DEFAULTS = Object.freeze({ maxActions: 20, maxPerElement: 1 });

  function visible(element) { return element && element.visible !== false && element.disabled !== true; }
  function score(element) {
    if (!visible(element)) return -1;
    let value = 10;
    const tag = String(element.tag || '').toLowerCase();
    const type = String(element.type || '').toLowerCase();
    const role = String(element.role || '').toLowerCase();
    if (tag === 'button' || role === 'button' || type === 'button' || type === 'submit') value += 30;
    if (tag === 'a' || element.href) value += 20;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') value += 15;
    if (role === 'link' || role === 'menuitem' || role === 'tab') value += 10;
    if (element.selector) value += 5;
    return value;
  }
  function normalizeOptions(options = {}) {
    return {
      maxActions: Number.isInteger(options.maxActions) && options.maxActions > 0 ? options.maxActions : DEFAULTS.maxActions,
      maxPerElement: Number.isInteger(options.maxPerElement) && options.maxPerElement > 0 ? options.maxPerElement : DEFAULTS.maxPerElement,
      allowNavigation: options.allowNavigation !== false,
      allowInputs: options.allowInputs === true
    };
  }
  function plan(map = {}, options = {}) {
    const cfg = normalizeOptions(options);
    const seen = new Set();
    const actions = [];
    const elements = Array.isArray(map.elements) ? map.elements : [];
    const existing = Array.isArray(map.actions) ? map.actions : [];
    const executed = new Set(existing.map(action => String(action.elemento || action.selector || '')).filter(Boolean));
    const candidates = elements.map((element, index) => ({ element, index, score: score(element) }))
      .filter(item => item.score >= 0)
      .filter(item => cfg.allowNavigation || !(item.element.href || String(item.element.tag || '').toLowerCase() === 'a'))
      .filter(item => cfg.allowInputs || !['input','select','textarea'].includes(String(item.element.tag || '').toLowerCase()))
      .sort((a, b) => b.score - a.score || String(a.element.page_id).localeCompare(String(b.element.page_id)) || String(a.element.selector).localeCompare(String(b.element.selector)) || a.index - b.index);
    for (const candidate of candidates) {
      const element = candidate.element;
      const key = String(element.page_id || '') + '|' + String(element.selector || candidate.index);
      if (seen.has(key) || executed.has(String(element.selector || ''))) continue;
      seen.add(key);
      const tag = String(element.tag || '').toLowerCase();
      const actionType = tag === 'a' || element.href ? 'navigate' : (['input','select','textarea'].includes(tag) ? 'input' : 'click');
      actions.push({
        plan_id: 'plan-' + (actions.length + 1),
        priority: actions.length + 1,
        action: actionType,
        page_id: element.page_id || null,
        selector: element.selector || null,
        rationale: 'Elemento visível e ainda não observado; prioridade determinística por tipo de interação.',
        score: candidate.score,
        requires_validation: true
      });
      if (actions.length >= cfg.maxActions) break;
    }
    return {
      schema_version: VERSION,
      mode: 'observe-plan-only',
      executable: false,
      generated_at: new Date().toISOString(),
      target_url: map.target_url || null,
      source_session_id: map.session_id || null,
      constraints: cfg,
      actions,
      totals: { candidates: candidates.length, planned: actions.length, skipped_observed: existing.length }
    };
  }
  return Object.freeze({ VERSION, DEFAULTS, plan });
});