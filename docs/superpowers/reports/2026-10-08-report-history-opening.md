# Report history opening without Parent Cabinet

## Confirmed causes

Read-only public checks found the production `index.html`, `app.js` and
`parent-specialist.js` byte-identical to commit
`f62c07b52469e588524c9d4e471a5e4f46879459`. The entry marker remains
`0.176-goal-sync`; `/report-pdf-export.mjs` returns HTTP 404. The recovery
commit `fb064d35731de6be4adadaa6a87f15397242a253` was saved to GitHub but
was not installed on production.

That recovery also retained a separate UI defect: history Open and preview
handlers routed published, archived and publishing reports to the Parent
Cabinet tab. Existing PDF tests did not cover clicking those history controls.

## Correction

- Open and Text/PDF show the report in the existing local text editor with
  independent file-export controls. They do not navigate to Parent Cabinet.
- Published and archived reports display only their frozen snapshot, read-only.
  If snapshot text is unavailable, the UI explains that the saved PDF can still
  be prepared; it does not substitute current source text.
- Publishing reports remain read-only and wait for publication to finish.
  Draft and publication-error reports retain explicit editing and saving.
- Opening, closing or starting another report retires asynchronous AI/save
  continuations. Late results cannot overwrite another report's text, identity
  or PDF control. A new report restores empty editable fields and enabled buttons.
- Cache entry markers advance together to `0.179-report-open`.

Regression tests exercise actual extracted application handlers. They reproduced
the incorrect navigation and the late-AI/save races before the corresponding
fixes. The mobile browser test clicks the actual history handlers and verifies
frozen text plus file-only sharing with active user gesture. Native sharing is
stubbed; actual iPhone/Safari share-sheet behavior still requires a phone check.

Final validation: `npm test` passed 318/318; PDF browser checks passed 4/4,
including mobile history opening. Independent review passed 45/45 scoped tests
and found no remaining critical/important blockers. JavaScript syntax and
`git diff --check` passed.

This correction changes frontend source and tests only. No production deployment,
migration, Auth/RLS/Storage policy change or merge to main was performed.
Installing independent export also requires the earlier reviewed PDF server
helper from the recovery commit; installing frontend alone is insufficient.
