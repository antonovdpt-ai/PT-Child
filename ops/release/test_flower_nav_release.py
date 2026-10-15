"""Offline four-file Flower release rehearsal with exact Git bytes and full-tree snapshot."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

OPS=Path(__file__).resolve().parent
BASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
DELTA=("app.js","patient-flower.css","patient-flower.mjs","index.html")
def module(filename,name):
    spec=importlib.util.spec_from_file_location(name,OPS/filename)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj)
    return obj
service=module("flower-nav-remote.py","flower_nav")
build=module("flower-nav-build.py","flower_nav_build")
def git(*args):return subprocess.check_output(["git",*args],cwd=OPS.parent.parent)
def sha(b):return hashlib.sha256(b).hexdigest()

class TestFlowerNavRelease(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="flower-nav-offline-")
        self.addCleanup(self.temp.cleanup)
        self.dir=Path(self.temp.name);self.home=self.dir/"home";self.home.mkdir()
        self.live=self.dir/"fake-live";self.live.mkdir()
        self.jid="12345678901"
        self.private=self.home/".cache"/"fizira-flower-nav"/self.jid
        self.private.mkdir(parents=True,mode=0o700)
        (self.private/"stage").mkdir(mode=0o700)
        self.backup_root=self.home/".cache"/"fizira-frontend-snapshots"
        self.backup_root.mkdir(mode=0o700)
        shutil.copyfile(OPS/"frontend-snapshot.py",self.private/"frontend-snapshot.py")
        names=git("show",BASE+":ops/release/frontend-assets.txt").decode().splitlines()
        self.names=names
        self.base={};self.head={}
        for name in names:
            old=git("show",BASE+":"+name);new=git("show","HEAD:"+name)
            self.base[name]=sha(old);self.head[name]=sha(new)
            (self.live/name).write_bytes(old);(self.live/name).chmod(0o644)
            if name in DELTA:
                (self.private/"stage"/name).write_bytes(new)
                (self.private/"stage"/name).chmod(0o644)
        (self.live/"nonrelease-keep.txt").write_text("extra existing frontend file")
        self.assertEqual({name for name in names if self.base[name]!=self.head[name]},set(DELTA))
        pins={"fromCommit":BASE,"targetVersion":"0.188-flower-nav",
              "assets":names,"base":self.base,"head":self.head,"delta":list(DELTA)}
        (self.private/"pins.json").write_text(json.dumps(pins))
        self.homepatch=patch.object(Path,"home",return_value=self.home);self.homepatch.start()
        self.addCleanup(self.homepatch.stop)
        self.productionpatch=patch.object(service,"PRODUCTION",self.live);self.productionpatch.start()
        self.addCleanup(self.productionpatch.stop)
        self.backup=self.backup_root/("flower-nav-"+self.jid)

    def action(self,mode,manifest=None):
        args=[mode,"--job-id",self.jid]
        if manifest:args+=["--manifest-sha256",manifest]
        out=io.StringIO()
        with patch.object(sys,"argv",["flower-nav-remote.py",*args]):
            with contextlib.redirect_stdout(out):
                service.main()
        return json.loads(out.getvalue().strip())

    def check_files(self,expected):
        for name in self.names:
            self.assertEqual(sha((self.live/name).read_bytes()),expected[name],name)
        self.assertEqual((self.live/"nonrelease-keep.txt").read_text(),
                         "extra existing frontend file")

    def test_full_new_snapshot_four_file_activation_and_rollback(self):
        self.assertEqual(self.action("preflight")["NAV_PREFLIGHT"],"PASS")
        result=self.action("backup");self.assertEqual(result["NAV_BACKUP"],"PASS")
        self.assertEqual(result["files"],4)
        self.assertEqual(result["scope"],"EXACT_FOUR_REPLACED_FILES")
        self.assertEqual(result["diskAssetsVerified"],21)
        manifest=result["manifestSha256"]
        with patch.dict(os.environ,{"FIZIRA_NAV_RELEASE_APPROVAL":"0.188-flower-nav::activate"}):
            changed=self.action("activate",manifest)
        self.assertEqual(changed["changedFiles"],4)
        self.check_files(self.head)
        with patch.dict(os.environ,{"FIZIRA_NAV_RELEASE_APPROVAL":"0.188-flower-nav::rollback"}):
            result=self.action("rollback",manifest)
        self.assertEqual(result["changedFiles"],4)
        self.check_files(self.base)

    def test_unreadable_unrelated_frontend_file_is_never_copied_or_modified(self):
        unrelated=self.live/"private-nonrelease-file"
        unrelated.write_text("synthetic never-deployed unrelated bytes")
        unrelated.chmod(0o000)
        try:
            result=self.action("backup")
            self.assertEqual(result["files"],4)
            self.assertEqual(result["NAV_BACKUP"],"PASS")
            self.assertEqual(unrelated.stat().st_mode & 0o777,0)
            self.assertEqual(len(list((self.backup/"files").iterdir())),4)
        finally:
            unrelated.chmod(0o600)
        self.assertEqual(unrelated.read_text(),"synthetic never-deployed unrelated bytes")

    def test_fail_closed_stage_tamper_before_snapshot(self):
        (self.private/"stage"/"app.js").write_text("wrong source bytes")
        with self.assertRaisesRegex(ValueError,"STAGED_HASH_STOP"):
            self.action("preflight")
        self.assertFalse(self.backup.exists());self.check_files(self.base)

    def test_fail_closed_unknown_live_state_before_snapshot(self):
        (self.live/"app.js").write_text("unexpected concurrent source")
        with self.assertRaisesRegex(ValueError,"LIVE_HASH_STOP"):
            self.action("backup")
        self.assertFalse(self.backup.exists())

    def test_partial_activation_can_be_recovered_from_fresh_snapshot(self):
        result=self.action("backup");manifest=result["manifestSha256"]
        for name in DELTA[:2]:
            (self.live/name).write_bytes((self.private/"stage"/name).read_bytes())
        with patch.dict(os.environ,{"FIZIRA_NAV_RELEASE_APPROVAL":"0.188-flower-nav::rollback"}):
            result=self.action("rollback",manifest)
        self.assertEqual(result["changedFiles"],2)
        self.check_files(self.base)

    def test_wrong_operator_pin_refuses_rollback_without_writes(self):
        result=self.action("backup")
        (self.live/"app.js").write_bytes((self.private/"stage"/"app.js").read_bytes())
        with patch.dict(os.environ,{"FIZIRA_NAV_RELEASE_APPROVAL":"0.188-flower-nav::rollback"}):
            with self.assertRaisesRegex(ValueError,"OPERATOR_MANIFEST_HASH_STOP"):
                self.action("rollback","0"*64)
        self.assertEqual(sha((self.live/"app.js").read_bytes()),self.head["app.js"])

    def test_rollback_refuses_any_unknown_live_state(self):
        manifest=self.action("backup")["manifestSha256"]
        (self.live/"app.js").write_text("unreviewed new version")
        with patch.dict(os.environ,{"FIZIRA_NAV_RELEASE_APPROVAL":"0.188-flower-nav::rollback"}):
            with self.assertRaisesRegex(ValueError,"UNKNOWN_ROLLBACK_STATE_STOP"):
                self.action("rollback",manifest)

if __name__=="__main__":unittest.main()
