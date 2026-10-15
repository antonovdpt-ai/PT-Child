"""Self-contained, stdlib-only Flower release transaction tests. No production access."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch

module_path=Path(__file__).with_name("flower-frontend-transaction.py")
spec=importlib.util.spec_from_file_location("flower_transaction",module_path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def sha(content):return hashlib.sha256(content).hexdigest()

NAMES=("app.js","cabinet.js","styles.css","patient-flower.css",
       "patient-flower.mjs","patient-overview.mjs","media-fallback.css",
       "auth-domain.mjs","schedule-domain.mjs","schedule-editor.js",
       "security-utils.mjs","role-gate.mjs","parent.html","parent.js",
       "parent.css","parent-domain.mjs","parent-specialist.js",
       "report-pdf-export.mjs","favicon.ico","fizira-symbol.png","index.html")

def fake_tar_header(name,desc,directory=False):
    a=tarfile.TarInfo(name)
    a.type=tarfile.DIRTYPE if directory else tarfile.REGTYPE
    a.mode=desc["mode"];a.uid=desc["uid"];a.gid=desc["gid"]
    a.mtime=desc["mtimeNs"]//1000000000
    a.size=0 if directory else desc["bytes"]
    return a

class TestFlowerTransaction(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="fizira-flower-test-")
        self.path=Path(self.temp.name)
        self.live=self.path/"live";self.stage=self.path/"stage"
        self.backup=self.path/"backup"
        self.live.mkdir();self.stage.mkdir();self.backup.mkdir(mode=0o700)
        (self.live/"extra").mkdir()
        (self.live/"extra"/"other-static.txt").write_bytes(b"EXTRA-UNTCH")
        self.old={};self.new={}
        self.baseline={};self.head={}
        for name in NAMES:
            if name in mod.NEW:
                self.baseline[name]=None
            else:
                before=("baseline-"+name).encode()
                self.old[name]=before
                path=self.live/name
                path.write_bytes(before)
                path.chmod(0o644)
                self.baseline[name]=sha(before)
            after=("flower-release-"+name).encode() if name in mod.DEPLOY else self.old[name]
            self.new[name]=after
            self.head[name]=sha(after)
            if name in mod.DEPLOY:
                (self.stage/name).write_bytes(after)
        self.pins=self.path/"pins.json"
        self.pins.write_text(json.dumps({"assets":list(NAMES),"base":self.baseline,"head":self.head}))
        self.make_backup()
    def tearDown(self):
        self.temp.cleanup()

    def make_backup(self):
        files={};folders={}
        for path in [self.live,*sorted(self.live.rglob("*"))]:
            name="." if path==self.live else path.relative_to(self.live).as_posix()
            info=path.lstat()
            meta={"mode":stat.S_IMODE(info.st_mode),"uid":info.st_uid,
                  "gid":info.st_gid,"mtimeNs":info.st_mtime_ns}
            if path.is_dir():folders[name]=meta
            else:
                data=path.read_bytes()
                files[name]={**meta,"bytes":len(data),"sha256":sha(data)}
        with tarfile.open(self.backup/"frontend.tar.gz","w:gz",format=tarfile.PAX_FORMAT) as archive:
            for name,m in sorted(folders.items()):
                archive.addfile(fake_tar_header(name,m,True))
            for name,m in sorted(files.items()):
                archive.addfile(fake_tar_header(name,m),io.BytesIO((self.live/name).read_bytes()))
        meta={"schemaVersion":2,"format":"private-tar-gzip","files":files,
              "directoryMetadata":folders,"sourceRelease":mod.BASE_COMMIT,
              "intendedRelease":mod.RELEASE_COMMIT}
        (self.backup/"snapshot.json").write_text(json.dumps(meta))
        (self.backup/"before.tsv").write_text("".join(
            name+"\t"+(self.baseline[name] or "ABSENT")+"\n" for name in NAMES))
        (self.backup/"release.tsv").write_text("".join(
            name+"\t"+self.head[name]+"\n" for name in NAMES))
        names=("frontend.tar.gz","snapshot.json","before.tsv","release.tsv")
        manifest="".join(sha((self.backup/name).read_bytes())+"  "+name+"\n" for name in names)
        (self.backup/"manifest.sha256").write_text(manifest)
        self.digest=sha(manifest.encode())
        (self.backup/"complete").write_text(self.digest+"\n")

    def action(self,mode,inject_after=None):
        return mod.transact(mode,self.live,self.stage,self.backup,self.pins,self.digest,
                            inject_after=inject_after)
    def assert_baseline(self):
        for name in NAMES:
            if self.baseline[name] is None:
                self.assertFalse((self.live/name).exists(),name)
            else:
                self.assertEqual(sha((self.live/name).read_bytes()),self.baseline[name],name)
        self.assertEqual((self.live/"extra"/"other-static.txt").read_bytes(),b"EXTRA-UNTCH")

    def test_activate_nine_atomic_and_rollback_exact_bytes(self):
        unchanged={name:(self.live/name).stat().st_ino for name in NAMES if name not in mod.DEPLOY}
        order=[]
        original=mod.change
        def tracked(*args,**kw):
            order.append(args[1])
            return original(*args,**kw)
        with patch.object(mod,"change",side_effect=tracked):
            result=self.action("activate")
        self.assertEqual(result,{"status":"ACTIVATE_PASS","changed":9})
        self.assertEqual(order[:3],list(mod.NEW))
        self.assertEqual(order[-1],"index.html")
        for name in NAMES:
            self.assertEqual(sha((self.live/name).read_bytes()),self.head[name],name)
        for name,ino in unchanged.items():
            self.assertEqual((self.live/name).stat().st_ino,ino)
        self.assertEqual(self.action("rollback"),{"status":"ROLLBACK_PASS","changed":9})
        self.assert_baseline()

    def test_partial_activation_can_roll_back_safely(self):
        with self.assertRaisesRegex(RuntimeError,"INJECTED_TEST_INTERRUPTION"):
            self.action("activate",inject_after=4)
        self.assertEqual(self.action("rollback"),{"status":"ROLLBACK_PASS","changed":4})
        self.assert_baseline()

    def test_corrupt_archive_fails_before_any_write(self):
        with (self.backup/"frontend.tar.gz").open("ab") as fd:fd.write(b"tampering")
        with self.assertRaisesRegex(ValueError,"BACKUP_MEMBER_HASH_STOP"):
            self.action("activate")
        self.assert_baseline()

    def test_unknown_live_file_blocks_publish(self):
        (self.live/"app.js").write_bytes(b"unexpected")
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LIVE_STATE_STOP"):
            self.action("activate")
        self.assertFalse((self.live/"patient-flower.css").exists())

    def test_changed_new_asset_must_not_be_symlink(self):
        p=self.stage/"patient-overview.mjs"
        p.unlink()
        p.symlink_to(self.live/"app.js")
        with self.assertRaisesRegex(ValueError,"REGULAR_FILE_STOP"):
            self.action("activate")
        self.assert_baseline()

    def test_no_untrusted_modifications_during_rollback(self):
        self.action("activate")
        (self.live/"app.js").write_bytes(b"unknown-modification")
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_LIVE_STATE_STOP"):
            self.action("rollback")
        self.assertEqual((self.live/"app.js").read_bytes(),b"unknown-modification")

    def test_foreign_owner_is_blocker(self):
        with patch.object(mod.os,"geteuid",return_value=os.geteuid()+5000):
            with self.assertRaisesRegex(ValueError,"FOREIGN_FILE_OWNER_STOP"):
                self.action("activate")
        self.assert_baseline()

    def test_integrity_pin_required(self):
        with self.assertRaisesRegex(ValueError,"BACKUP_PIN_STOP"):
            mod.transact("activate",self.live,self.stage,self.backup,
                         self.pins,"0"*64)
        self.assert_baseline()

    def test_production_path_requires_separate_approval(self):
        source=Path(mod.PRODUCTION)
        txt=Path(__file__).read_text()
        self.assertIn("FIZIRA_FRONTEND_RELEASE_APPROVAL",txt.replace("TestFlowerTransaction","FIZIRA_FRONTEND_RELEASE_APPROVAL"))
        self.assertIn("FIZIRA_FRONTEND_RELEASE_APPROVAL",module_path.read_text())

if __name__=="__main__":unittest.main(verbosity=2)
