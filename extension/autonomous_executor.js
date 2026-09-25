(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevTrailAutonomousExecutor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.1';
  const DEFAULTS = Object.freeze({
    maxActions: 5,
    allowNavigation: true,
    allowInputs: false,
    requireExplicitExecute: true,
    validationDelayMs: 100,
    maxRepeatedState: 2
  });
  const ALLOWED = new Set(['click', 'navigate', 'input']);

  function normalizeOptions(options = {}) {
    return {
      maxActions: Number.isInteger(options.maxActions) && options.maxActions > 0
        ? Math.min(options.maxActions, 20) : DEFAULTS.maxActions,
      allowNavigation: options.allowNavigation !== false,
      allowInputs: options.allowInputs === true,
      requireExplicitExecute: options.requireExplicitExecute !== false,
      validationDelayMs: Number.isInteger(options.validationDelayMs) && options.validationDelayMs >= 0
        ? Math.min(options.validationDelayMs, 2000) : DEFAULTS.validationDelayMs,
      maxRepeatedState: Number.isInteger(options.maxRepeatedState) && options.maxRepeatedState > 0
        ? Math.min(options.maxRepeatedState, 5) : DEFAULTS.maxRepeatedState
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

  function sleep(ms) {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }

  async function inspect(api, state, selector) {
    const result = await api.scripting.executeScript({
      target: { tabId: state.tabId },
      func: (targetSelector) => {
        const element = document.querySelector(targetSelector);
        const body = document.body;
        const text = body ? String(body.innerText || '').slice(0, 2000) : '';
        const rect = element?.getBoundingClientRect?.();
        return {
          url: location.href,
          title: document.title,
          targetPresent: Boolean(element),
          targetTag: element?.tagName?.toLowerCase() || null,
          targetDisabled: Boolean(element?.matches?.(':disabled')) || element?.getAttribute?.('aria-disabled') === 'true',
          targetTextLength: String(element?.innerText || element?.textContent || '').length,
          targetRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
          bodyTextLength: text.length
        };
      },
      args: [selector]
    });
    return result?.[0]?.result || null;
  }

  function fingerprint(snapshot) {
    if (!snapshot) return 'no-snapshot';
    return JSON.stringify({
      url: snapshot.url || '',
      targetPresent: Boolean(snapshot.targetPresent),
      targetTag: snapshot.targetTag || '',
      targetDisabled: Boolean(snapshot.targetDisabled),
      targetTextLength: Number(snapshot.targetTextLength || 0),
      targetRect: snapshot.targetRect || null,
      bodyTextLength: Number(snapshot.bodyTextLength || 0)
    });
  }

  function compareSnapshots(before, after) {
    if (!before || !after) return { changed: false, reason: 'VALIDATION_UNAVAILABLE' };
    const urlChanged = before.url !== after.url;
    const targetPresenceChanged = Boolean(before.targetPresent) !== Boolean(after.targetPresent);
    const targetStateChanged = before.targetDisabled !== after.targetDisabled ||
      before.targetTextLength !== after.targetTextLength ||
      JSON.stringify(before.targetRect) !== JSON.stringify(after.targetRect);
    const bodyChanged = before.bodyTextLength !== after.bodyTextLength;
    return {
      changed: urlChanged || targetPresenceChanged || targetStateChanged || bodyChanged,
      urlChanged,
      targetPresenceChanged,
      targetStateChanged,
      bodyChanged
    };
  }

  async function execute(api, state, plan, options = {}) {
    const validation = validatePlan(plan, state, options);
    if (!validation.ok) return { ok: false, ...validation };
    if (!api?.scripting?.executeScript) return { ok: false, code: 'SCRIPTING_UNAVAILABLE' };

    const results = [];
    const fingerprints = new Map();
    let loopDetected = false;

    for (const action of validation.actions) {
      if (!state.active) {
        results.push({ plan_id: action.plan_id || null, ok: false, code: 'SESSION_STOPPED' });
        break;
      }

      let before = null;
      let after = null;
      try {
        before = await inspect(api, state, action.selector);
        const beforeFingerprint = fingerprint(before);
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
            return { ok: true, code: actionType === 'navigate' ? 'NAVIGATION_TRIGGERED' : 'CLICK_TRIGGERED' };
          },
          args: [action.selector, action.action, action.value]
        });

        const value = result?.[0]?.result || { ok: false, code: 'NO_EXECUTION_RESULT' };
        if (!value.ok) {
          results.push({ plan_id: action.plan_id || null, selector: action.selector, action: action.action, ...value });
          continue;
        }

        await sleep(validation.config.validationDelayMs);
        after = await inspect(api, state, action.selector);
        const validationResult = compareSnapshots(before, after);
        const afterFingerprint = fingerprint(after);
        const repeatKey = action.action + '|' + action.selector + '|' + afterFingerprint;
        const repeated = (fingerprints.get(repeatKey) || 0) + 1;
        fingerprints.set(repeatKey, repeated);

        const item = {
          plan_id: action.plan_id || null,
          selector: action.selector,
          action: action.action,
          ...value,
          validation: {
            ...validationResult,
            before_fingerprint: beforeFingerprint,
            after_fingerprint: afterFingerprint
          },
          loop: { repeated, max_repeated: validation.config.maxRepeatedState }
        };
        results.push(item);

        if (repeated >= validation.config.maxRepeatedState) {
          loopDetected = true;
          results.push({
            plan_id: action.plan_id || null,
            ok: false,
            code: 'LOOP_DETECTED',
            selector: action.selector,
            action: action.action,
            repeated
          });
          break;
        }
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
      ok: !loopDetected && results.every(item => item.ok),
      schema_version: VERSION,
      executed: results.filter(item => item.plan_id && item.code !== 'LOOP_DETECTED').length,
      loop_detected: loopDetected,
      results
    };
  }

  return Object.freeze({
    VERSION,
    DEFAULTS,
    normalizeOptions,
    validateAction,
    validatePlan,
    compareSnapshots,
    fingerprint,
    execute
  });
});
