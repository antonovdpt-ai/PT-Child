# Safe PWA overlay for mismatched live production

Production currently differs from main on six files (index.html, app.js, cabinet.js, styles.css, schedule-domain.mjs, schedule-editor.js). **Do not run the ordinary full frontend deploy**: it may overwrite live code.

The PWA overlay works only on public static assets and transforms the *live* index in place using a strict SHA-256 lease. It must never overwrite app.js, cabinet.js, styles.css or schedule modules.

The installer requires a preflight checksum, backup, temporary staging, and rollback on any deployment failure. It is designed for the existing Timeweb SSH-based deployment. A successful automated job must also verify the public manifest, icon, service worker and index marker.

After the PWA overlay is running, reconcile live code with main before using full frontend releases again. The PWA PR alone is not sufficient to reconcile those six files.
