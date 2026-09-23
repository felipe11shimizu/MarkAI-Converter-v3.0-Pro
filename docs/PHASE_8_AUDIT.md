# Phase 8 — Post-Phase 7 Audit

## Baseline audited
- Branch: `audit/phase-8-baseline`
- Baseline commit: `069a56bd677b45329bf97afa755c6df5e2688ac6`
- Main CI: successful
- Open PRs at audit time: none

## Findings

### P0 — Functional risk: global drop handler bypasses QueueUIController
`script.js` still registers a document-level `drop` handler after QueueUIController is initialized.

That handler calls `QueueManager.add(files)` directly and then `UIManager.renderQueue()`, bypassing:
- `QueueUIController.onFilesSelected()`
- `WorkspaceController.scheduleSave()`
- the normal single-file auto-conversion path.

This creates a second file-ingestion path and can produce behavior different from the drop-zone path. It is the first item to correct.

### P1 — Obsolete dependency injection
`script.js` still passes `mergeEngine: MergeEngine` into `QueueUIController.create()`.

Current QueueUIController delegates merge to `ConversionController.mergeAll()` and no longer declares/uses `mergeEngine`. The injection is therefore obsolete and should be removed in a dedicated small cleanup commit if not already removed from the target branch.

### P1 — Duplicate/dead comparison logic
`script.js` still contains a local `UIManager.compareItem()` implementation, while the active comparison button delegates to `ConversionController.compareItem()` and queue actions also delegate to the controller.

The local implementation should be reviewed for dead-code removal after confirming no external caller depends on it.

### P1 — Legacy orchestration remains concentrated in script.js
`script.js` remains responsible for:
- service composition;
- application bootstrap;
- several direct DOM event handlers;
- URL ingestion;
- chat formatting;
- AI enhancement;
- comparison modal behavior;
- editor event wiring;
- download/reset flows;
- global drag/drop behavior.

This is acceptable as a compatibility bootstrap, but it is the main architectural concentration point for Phase 8.

### P2 — Test coverage gap
There is strong unit coverage for the extracted controllers, but no dedicated regression test for the document-level fallback drop path in `script.js`.

The first fix should add coverage at the appropriate abstraction level rather than expanding the existing QueueUIController test with script.js internals.

## Functional inventory

| Area | Current state | Test coverage | Priority |
|---|---|---|---|
| File picker | Modularized | Covered | Maintain |
| Drop zone | Modularized | Covered partially | P0 review |
| Global fallback drop | Legacy in script.js | Gap | P0 |
| Single conversion | Controller | Covered | Maintain |
| Batch conversion | Controller | Covered | Maintain |
| Queue actions | QueueUIController | Covered | Maintain |
| ZIP export | QueueUIController | Covered | Maintain |
| Duplicate ZIP names | QueueUIController | Covered | Maintain |
| Merge | ConversionController | Covered | Maintain |
| Workspace persistence | WorkspaceController | Covered | Maintain |
| Workspace UI | WorkspaceUIController | Covered | Maintain |
| Editor | EditorController | Covered | Maintain |
| Settings | SettingsController | Covered | Maintain |
| YouTube | YouTubeController | Covered | Maintain |
| Video automation | Controller + validator | Covered | Maintain |
| AI enhancement | Partly orchestrated by script.js | Limited integration coverage | P1 |
| URL ingestion | script.js orchestration | Limited | P1 |
| Comparison | Controller + legacy UI logic | Partial | P1 |

## Phase 8 micro-PR roadmap

### PR 5 — Normalize global file drop
- remove/route the document-level duplicate drop path;
- ensure every file ingestion path uses QueueUIController;
- preserve current UX;
- add regression coverage;
- CI must be green.

### PR 6 — Remove dead comparison implementation
- verify all callers;
- remove duplicated UIManager comparison engine logic;
- preserve ConversionController as the use-case owner;
- add/adjust tests if required.

### PR 7 — Reduce script.js orchestration
Candidate extractions, one at a time:
1. document/editor event wiring;
2. URL ingestion UI;
3. AI enhancement UI;
4. comparison modal adapter;
5. download/reset UI.

### PR 8 — Strengthen integration tests
Add tests for the critical end-to-end contracts:
- file ingestion → queue → persistence;
- file ingestion → automatic conversion;
- conversion → workspace persistence;
- merge → workspace persistence;
- workspace load → editor;
- AI enhancement → history/version persistence.

## Architecture target

`script.js` should progressively become a bootstrap/composition root rather than a second UI controller.

Target flow:

`DOM → UI Controller → Application Controller → Engine/Store → State`

with persistence and state updates owned by the relevant controllers.

## Guardrails
- Do not rewrite `script.js` wholesale.
- Do not combine PRs 5–8.
- Do not change stable behavior without a regression test.
- Do not modify PR #3 or previously integrated commits.
- Keep `main` as the release/stable line.
