# Local PDF preview dependency

Mozilla PDF.js 5.6.205, Apache License 2.0. Upstream: https://github.com/mozilla/pdf.js; display API: https://mozilla.github.io/pdf.js/examples/index.html.

The browser display and worker distributions are copied without modification from the pinned `pdfjs-dist` package already present in the authoring runtime. Copyright and license headers remain intact; the full license ships as `pdfjs-LICENSE.txt`.

| Asset | SHA-256 |
| --- | --- |
| `pdfjs-5.6.205.min.mjs` | `2221020ea508479dcc1221f36f2731656339230097c69ba1f78802832c0ad685` |
| `pdfjs-worker-5.6.205.min.mjs` | `51a2fd1ea47f1a9b0814e65e0c336c739c54957795ee774e8f93cb81e8028dd1` |
| `pdfjs-LICENSE.txt` | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |

The display module loads only after PDF generation. It renders the first page of the same bytes used for sharing/download; a page-count label and full-document link cover longer reports. The worker is served by Fizira. No CDN, document-upload service, external fonts or external assets are used. Evaluation and WebAssembly loading are disabled. Canvas resolution is capped at 600 CSS pixels and device ratio 2; workers/render tasks are disposed after rendering or on invalidation/navigation. Rendering failure preserves the valid File and exposes a readable fallback.
