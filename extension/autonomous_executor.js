(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousExecutor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0';
  const DEFAULTS = Object.freeze({
    maxActions: 5,
    allowNavigation: true,
    allowInputs: false,
    requireExplicitExecute: true
  });
  const ALLOWED = new Set(['click', 'navigate', 'input']);

  function normalizeOptions(options = {}) {
    return {
      maxActions: Number.isInteger(options.maxActions) && options.maxActions > 0
        ? Math.min(options.maxActions, 20) : DEFAULTS.maxActions,
      allowNavigation: options.allowNavigation !== false,
      allowInputs: options.allowInputs === true,
      requireExplicitExecute: options.requireExplicitExecute !== false
    };
  }

  function validateAction(action, options) {
    if (!action || !ALLOWED.has(action.action)) return { ok: false, code: 'ACTION_NOT_ALLOWED' };
    if (action.requires_validation !== true) return { ok: false, code: 'ACTION_REQUIRES_VALIDATION' };
    if (!action.selector || typeof action.selector !== 'string') return { ok: false, code: 'SELECTOR_REQUIRED' };
    if (action.action === 'navigate' && !options.allowNavigation) return { ok: false, code: 'NAVIGATION_DISABLED' };
    if (action.action === 'input' && !options.allowInputs) return { ok: false, code: 'INPUT_DISABLED' };
    if (action.action === 'input' && typeof action.value !== 'string') return { ok: false, code: 'INPUT_VALUE_REQUIRED' };
    return { ok: true };
  }

  function validatePlan(plan, state, options = {}) {
    const cfg = normalizeOptions(options);
    if (!state?.active) return { ok: false, code: 'AUTONOMOUS_SESSION_REQUIRED' };
    if (!plan || plan.executable !== false || plan.mode !== 'observe-plan-only') {
      return { ok: false, code: 'INVALID_PLAN_MODE' };
    }
    if (cfg.requireExplicitExecute !== false && options.execute !== true) {
      return { ok: false, code: 'EXECUTION_NOT_EXPLICITLY_ENABLED' };
    }
    if (plan.source_session_id && plan.source_session_id !== state.sessionId) {
      return { ok: false, code: 'PLAN_SESSION_MISMATCH' };
    }
    if (!Array.isArray(plan.actions)) return { ok: false, code: 'PLAN_ACTIONS_REQUIRED' };

    const actions = plan.actions.slice(0, cfg.maxActions);
    for (const action of actions) {
      const result = validateAction(action, cfg);
      if (!result.ok) return { ok: false, code: result.code, plan_id: action?.plan_id || null };
    }
    return { ok: true, config: cfg, actions };
  }

  async function execute(api, state, plan, options = {}) {
    const validation = validatePlan(plan, state, options);
    if (!validation.ok) return { ok: false, ...validation };

    if (!api?.scripting?.executeScript) {
      return { ok: false, code: 'SCRIPTING_UNAVAILABLE' };
    }

    const results = [];
    for (const action of validation.actions) {
      if (!state.active) {
        results.push({ plan_id: action.plan_id || null, ok: false, code: 'SESSION_STOPPED' });
        break;
      }

      try {
        const result = await api.scripting.executeScript({
          target: { tabId: state.tabId },
          func: (selector, actionType, value) => {
            const element = document.querySelector(selector);
            if (!element) return { ok: false, code: 'ELEMENT_NOT_FOUND' };
            if (element instanceof HTMLInputElement && element.type === 'password') {
              return { ok: false, code: 'PASSWORD_INPUT_BLOCKED' };
            }
            if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') {
              return { ok: false, code: 'ELEMENT_DISABLED' };
            }

            if (actionType === 'input') {
              if (typeof value !== 'string') return { ok: false, code: 'INPUT_VALUE_REQUIRED' };
              const setter = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(element), 'value'
              )?.set;
              if (!setter) return { ok: false, code: 'INPUT_VALUE_UNSUPPORTED' };
              setter.call(element, value);
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true, code: 'INPUT_APPLIED' };
            }

            element.click();
            return {
              ok: true,
              code: actionType === 'navigate' ? 'NAVIGATION_TRIGGERED' : 'CLICK_TRIGGERED'
            };
          },
          args: [action.selector, action.action, action.value]
        });

        const value = result?.[0]?.result || { ok: false, code: 'NO_EXECUTION_RESULT' };
        results.push({ plan_id: action.plan_id || null, selector: action.selector, action: action.action, ...value });
      } catch (error) {
        results.push({
          plan_id: action.plan_id || null,
          selector: action.selector,
          action: action.action,
          ok: false,
          code: 'EXECUTION_ERROR',
          error: error?.message || String(error)
        });
      }
    }

    return {
      ok: results.every(item => item.ok),
      schema_version: VERSION,
      executed: results.length,
      results
    };
  }

  return Object.freeze({ VERSION, DEFAULTS, normalizeOptions, validateAction, validatePlan, execute });
});