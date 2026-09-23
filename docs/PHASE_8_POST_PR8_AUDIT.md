# Phase 8 — Post-PR8 Audit

## Baseline

- Branch: `main`
- Commit: `e2ed1972c62991ad38b45d1df8b01a3932e6c9a3`
- PRs integrated in Phase 8: #5, #6, #7, #8
- Main CI after PR #8: `MarkAI CI #498` — success
- Open PRs at audit time: none

## Executive summary

The Phase 8 modularization goals were substantially advanced, but the post-PR8 review identified two items that must be addressed before further architectural extraction:

1. **P0 — Merge path is incorrectly wired in the production bootstrap.**
2. **P1 — CI does not execute the new PR #7/#8 frontend test/module checks.**

The first item is a functional contract defect hidden by dependency-injected unit tests. The second weakens the meaning of the green CI because newly added tests are not part of the workflow.

The remaining concentration of behavior in `script.js` is now suitable for incremental extraction, but should continue only after these two gaps are closed.

## Findings

### P0 — Production merge path has no MergeEngine in ConversionController state

`frontend/modules/conversion_controller.js` implements:

```js
const markdown = await getState().mergeEngine.merge(...)
```

The production bootstrap in `script.js` creates `ConversionController` with:

```js
getState: () => ({
}),
```

The `MergeEngine` instance is created separately in `script.js`, but it is not exposed through the `ConversionController` state dependency.

The unit test `tests/test_conversion_controller.js` supplies a mock `mergeEngine` through `getState()`, so the defect is not detected by CI.

**Impact:** the UI path `QueueUIController.mergeAll() -> ConversionController.mergeAll()` can fail at runtime because `getState().mergeEngine` is undefined.

**Required correction:** inject `mergeEngine` explicitly into `ConversionController.create()` and use that dependency in `mergeAll()`, or provide an equivalent explicit application dependency. Add a bootstrap-level regression test or dependency contract test that verifies the production composition.

### P1 — CI does not execute the new editor UI and ingestion tests

The repository contains:

- `tests/test_editor_ui_controller.js` — added by PR #7
- `tests/test_queue_ingestion.js` — added by PR #8
- `frontend/modules/editor_ui_controller.js` — added by PR #7

However, `.github/workflows/ci.yml` currently does not:

- run `node --check frontend/modules/editor_ui_controller.js`;
- run `node tests/test_editor_ui_controller.js`;
- run `node tests/test_queue_ingestion.js`.

Therefore PR #8's green CI did not execute the newly added ingestion regression tests, and PR #7's new UI controller is not syntax-checked or unit-tested by the workflow.

**Required correction:** add all three checks to the frontend CI job.

### P1 — `script.js` remains the principal orchestration concentration point

After PR #5–#8, `script.js` still directly owns or wires:

- URL ingestion;
- chat formatting;
- clipboard;
- direct document download;
- AI enhancement and AI history persistence;
- comparison modal adapter;
- preview modal adapter;
- several presentation helpers;
- application composition/bootstrap.

This is consistent with the Phase 8 target, but it should be handled as a sequence of narrow extractions rather than another broad refactor.

### P2 — Dead/compatibility adapters remain

The UI manager still contains small adapter functions such as `_switchTab()` while editor event wiring has already moved to `EditorUIController`.

These should only be removed after confirming no caller remains. They are cleanup candidates, not blockers.

### P2 — Integration coverage remains incomplete

The following contracts remain candidates for dedicated integration tests:

- conversion -> workspace persistence;
- merge -> workspace persistence;
- workspace load -> editor;
- AI enhancement -> history/version persistence;
- application bootstrap -> controller composition.

Existing controller tests cover individual contracts, but they do not fully exercise the production composition assembled by `script.js`.

## Updated roadmap

### PR #9 — Repair merge dependency composition

- make `MergeEngine` an explicit dependency of `ConversionController`;
- remove the implicit `getState().mergeEngine` contract;
- preserve current merge behavior;
- add regression coverage for the production dependency contract;
- CI must be green.

### PR #10 — Put Phase 8 tests under CI

- syntax-check `editor_ui_controller.js`;
- run `test_editor_ui_controller.js`;
- run `test_queue_ingestion.js`;
- CI must be green.

### PR #11+ — Continue `script.js` reduction

Candidate sequence:

1. URL ingestion UI;
2. AI enhancement UI;
3. comparison modal adapter;
4. download/reset UI.

Each extraction remains isolated, with regression coverage and CI before integration.

## Guardrails

- No wholesale rewrite of `script.js`.
- One functional concern per PR.
- No behavior change without regression coverage.
- No modification of already integrated PRs.
- `main` remains the stable line.
- A green CI is required before every integration.
- A new PR cannot start until the preceding merged `main` has a green CI.
