#!/usr/bin/env python3
"""Insert PWA metadata into the LIVE index.html, preserving unrelated application code.

Usage: python3 patch-live-index.py /path/to/index.html
"""
from pathlib import Path
import re
import sys

HEAD_MARKER = "<!-- Fizira PWA overlay v1 -->"
BOOT_MARKER = 'id="fizira-pwa-bootstrap"'
HEAD = """  <!-- Fizira PWA overlay v1 -->
  <meta name="apple-mobile-web-app-title" content="Fizira">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
"""
BOOT = """  <script id="fizira-pwa-bootstrap">
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/service-worker.js').catch(function (error) {
          console.warn('Fizira offline screen unavailable', error);
        });
      });
    }
  </script>
"""
def patch_html(original: str) -> str:
    if original.count("</head>") != 1 or original.count("</body>") != 1:
        raise ValueError("Expected exactly one head/body closing tag")
    if HEAD_MARKER in original or BOOT_MARKER in original:
        raise ValueError("PWA overlay is already installed; stop instead of stacking")
    # Remove only conflicting old icon/manifest declarations; leave all JS and app version unchanged.
    html = re.sub(
        r'(?im)^[ \t]*<link\b(?=[^>]*\brel\s*=\s*["\'](?:manifest|apple-touch-icon)["\'])[^>]*>\s*\n?',
        "", original
    )
    html = re.sub(
        r'(?im)^[ \t]*<meta\b(?=[^>]*\bname\s*=\s*["\'](?:apple-mobile-web-app-title|apple-mobile-web-app-status-bar-style)["\'])[^>]*>\s*\n?',
        "", html
    )
    if not re.search(r'<meta\b[^>]*name\s*=\s*["\']apple-mobile-web-app-capable["\']', html, re.I):
        html = html.replace("</head>", '  <meta name="apple-mobile-web-app-capable" content="yes">\n</head>')
    html = html.replace("</head>", HEAD + "</head>")
    html = html.replace("</body>", BOOT + "</body>")
    return html

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: patch-live-index.py /path/to/index.html")
    target = Path(sys.argv[1])
    original = target.read_text(encoding="utf-8")
    revised = patch_html(original)
    target.write_text(revised, encoding="utf-8")
    print("FIZIRA_PWA_INDEX_OVERLAY_OK")
