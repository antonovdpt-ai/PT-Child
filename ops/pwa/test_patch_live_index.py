import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import importlib.util
spec = importlib.util.spec_from_file_location(
    "patch_live_index", pathlib.Path(__file__).with_name("patch-live-index.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OverlayTests(unittest.TestCase):
    def test_preserves_live_scripts_and_head_tags(self):
        original = """<!doctype html><html><head>
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="fizira-symbol.png">
<link rel="stylesheet" href="styles.css?v=LIVE">
</head><body>
<script type="module" src="app.js?v=LIVE"></script>
<script>window.criticalScheduleData = 'unchanged';</script>
</body></html>"""
        revised = module.patch_html(original)
        self.assertIn("app.js?v=LIVE", revised)
        self.assertIn("styles.css?v=LIVE", revised)
        self.assertIn("window.criticalScheduleData = 'unchanged'", revised)
        self.assertIn('href="/manifest.webmanifest"', revised)
        self.assertIn('href="/icons/icon-180.png"', revised)
        self.assertNotIn('href="fizira-symbol.png"', revised)
        self.assertIn("register('/service-worker.js')", revised)
        self.assertEqual(revised.count('id="fizira-pwa-bootstrap"'), 1)

    def test_rejects_duplicate_overlay(self):
        revised = module.patch_html("<html><head></head><body></body></html>")
        with self.assertRaises(ValueError):
            module.patch_html(revised)

    def test_rejects_truncated_html(self):
        with self.assertRaises(ValueError):
            module.patch_html("<html><head></head><body></html>")


if __name__ == "__main__":
    unittest.main()
