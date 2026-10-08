# Parent report flow implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Execute inline; review the complete delta independently before saving. The user explicitly authorized autonomous implementation and prohibited deploy/merge.

**Goal:** A specialist creates, reviews, autosaves, previews and shares a branded PDF without requiring a parent account.

**Architecture:** Keep existing report tables, AI contract and owner-only export endpoint. A focused initial-report workspace owns draft/editor/history state; the shared file-export control owns the ready File, embedded preview and synchronous native sharing. Reproduce the old document hierarchy using the current pdf-lib renderer and exact approved high-resolution `landing/assets/fizira-logo-black.png` bytes.

**Tech Stack:** Existing ES modules, Supabase client, pdf-lib/fontkit, Node tests, happy-dom, Chromium/Playwright and Poppler. Vendor the pinned Apache-2.0 PDF.js 5.6.205 browser display/worker builds already available in the runtime for a locally rendered first-page preview; no CDN or external document requests.

**Spec:** User attachment `Вставленный Markdown(1).md`, supplied 2026-10-08. Its 25 sections are the binding brief.

## Global constraints

- Base: `codex/recovered-session-pdf-20261008`, `51e18c88377a7b20d06eef24b0db9fcb6d45fd3a` (remote independently confirmed).
- Do not deploy, merge, roll back, migrate data, change Auth, RLS or Storage policies, or create parent access during export.
- Use fictional data exclusively for tests; retain immutable published originals/snapshots.
- Keep initial/session report models, parent publication/invitation/revoke, goals, photos and patient card behavior.
- One final commit for task-related changes, including evidence; no release installer changes.

## Review focus

- Typing during a save and rapidly generating PDF must export the latest saved text, without duplicate inserts.
- Closing, changing report/patient or signing out must retire timers and late AI/save/PDF results.
- Save failure must retain text, expose retry, and never share stale PDF.
- Published/archived history must never use current clinical text or become editable.
- Native share cancellation must retain the correct File; unsupported share must offer download and keep the page state.

### Task 1: Initial report workspace and file export

**Files:** Create `parent-report-workspace.mjs`, modify `app.js`, `report-pdf-export.mjs`, `styles.css`, `index.html`; update report UI/history/browser tests and obsolete extracted-handler fixtures.

**Interfaces:** `mountParentReportWorkspace({root, sb, patient, specialist, profile, reports, prepareDraft, isCurrent, onSaved})`; shared `mountReportPdfExport` gains `beforePrepare`, `onState`, `onReady`, `onEdit`, and lifecycle disposal while retaining current session export options.

- [x] Write/run failing behavior tests for automatic AI, debounce/serialized save, failure/retry, implicit save, history, retired views, preview and no-confirm sharing.
- [x] Implement `EMPTY → GENERATING_DRAFT → EDITING/SAVING/READY_TO_GENERATE → GENERATING_PDF → PDF_READY`; ERROR retains editor and explicit retry.
- [x] Replace only initial report UI/handlers in `renderTab`; update cache entry/import versions. History renders separately, never reloads the patient form on autosave.
- [x] Run scoped UI/portal tests and inspect results.

### Task 2: Branded PDF presentation

**Files:** Modify `supabase/functions/_shared/parent-pdf.ts`; create `parent-pdf-brand.ts` from exact `landing/assets/fizira-logo-black.png`; extend `parent-pdf.test.mjs`.

**Interfaces:** Preserve `renderParentPublicationPdf(snapshot): Promise<Uint8Array>` and the snapshot contract. No external fetches or font subsetting in Edge Runtime.

- [x] Write/run failing tests for embedded logo, omitted empty sections, readable Cyrillic, wrapped long text, headings and pagination/footer.
- [x] Reproduce old header/sections/footer with existing teal branding, A4 layout, page-break and word-wrap handling; keep resource limits.
- [x] Render fictional short/long reports, extract text and inspect page PNGs.

### Task 3: Verification, independent review and save

- [x] Run `npm test`, relevant browser suites, syntax/TypeScript parse, `git diff --check` and existing SQL/access-control regressions. No project build/lint commands are defined.
- [x] Independently review UX/mobile/PDF/security/regressions; address meaningful findings with regression tests.
- [x] Write evidence report with old-template history, test counts, boundaries and real-iPhone checklist.
- [x] Commit task delta locally on `codex/parent-report-flow-20261008`, as authorized by the user's save phase. Remote push was rejected by automatic approval review and is held for explicit authorization; no connector workaround is used.
