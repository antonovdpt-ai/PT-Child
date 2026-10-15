#!/usr/bin/env python3
"""Regression: Timeweb's traverse-only ancestor must not block atomic UI publish."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/"ops/release"/file)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
nav=load("flower_nav_runtime","flower-nav-remote.py")
snap=load("flower_snapshot_runtime","frontend-snapshot.py")
BASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
HEAD="842d262a75cbcfc62b6e4857cef2e0ce6a5d3f81"
def blob(commit,name):
    return subprocess.check_output(["git","show",commit+":"+name],cwd=ROOT)
def sha(data):return hashlib.sha256(data).hexdigest()

class TestAnchoredTimeweb(unittest.TestCase):
    def test_real_four_file_release_and_rollback_with_unreadable_ancestor(self):
        names=blob(BASE,"ops/release/frontend-assets.txt").decode().splitlines()
        self.assertEqual(len(names),21)
        with tempfile.TemporaryDirectory(prefix="flower-nav-anchored-") as t:
            outer=Path(t)
            restricted=outer/"restricted";restricted.mkdir()
            live=restricted/"app";live.mkdir()
            orig=outer/"original-four";orig.mkdir()
            stage=outer/"stage";stage.mkdir()
            backup=outer/"backup"
            base={};head={}
            for name in names:
                b=blob(BASE,name);h=blob(HEAD,name)
                base[name]=sha(b);head[name]=sha(h)
                (live/name).write_bytes(b);(live/name).chmod(0o644)
                if name in nav.DELTA:
                    (orig/name).write_bytes(b);(orig/name).chmod(0o644)
                    (stage/name).write_bytes(h);(stage/name).chmod(0o644)
            (live/"do-not-touch.txt").write_text("SAFE")
            self.assertEqual({n for n in names if base[n]!=head[n]},set(nav.DELTA))
            snap.create(orig,stage,backup,list(nav.DELTA))
            old=nav.PRODUCTION
            nav.PRODUCTION=live
            try:
                restricted.chmod(0o711)
                # A direct child file remains accessible through a traverse-only parent.
                self.assertEqual(sha((live/"app.js").read_bytes()),base["app.js"])
                result=nav.anchored_transaction("activate",snap,outer,backup,base,head,names)
                self.assertEqual(result,{"frontend":"ACTIVATE_VERIFIED","changedFiles":4})
                self.assertTrue(all(sha((live/n).read_bytes())==head[n] for n in names))
                result=nav.anchored_transaction("rollback",snap,outer,backup,base,head,names)
                self.assertEqual(result,{"frontend":"ROLLBACK_VERIFIED","changedFiles":4})
                self.assertTrue(all(sha((live/n).read_bytes())==base[n] for n in names))
                self.assertEqual((live/"do-not-touch.txt").read_text(),"SAFE")
                print("TIMEWEB_TRAVERSE_ONLY_PARENT=PASS")
                print("FOUR_ACTIVATE_AND_ROLLBACK=PASS")
            finally:
                restricted.chmod(0o755)
                nav.PRODUCTION=old

if __name__=="__main__":unittest.main()
