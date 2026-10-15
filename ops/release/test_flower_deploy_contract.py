"""Validate locked production workflow and exact nine-file package staging offline."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import os

ROOT=Path(__file__).resolve().parents[2]
OPS=ROOT/"ops/release"
WORKFLOW=ROOT/".github/workflows/flower-production-one-shot-LOCKED.yml"
COMMIT="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"

def imported(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

stage=imported(OPS/"flower-prepare-remote-stage.py","flower_stage")
def digest(raw): return hashlib.sha256(raw).hexdigest()

def shell_steps(text):
    lines=text.splitlines();result=[]
    for i,line in enumerate(lines):
        if line.lstrip()=="run: |":
            indent=len(line)-len(line.lstrip())
            body=[]
            for entry in lines[i+1:]:
                spaces=len(entry)-len(entry.lstrip())
                if entry and spaces<=indent:break
                body.append(entry[indent+2:] if entry else "")
            if body:result.append("\n".join(body)+"\n")
    return result

class TestDeploymentContract(unittest.TestCase):
    def test_explicit_hard_lock_without_push(self):
        text=WORKFLOW.read_text()
        self.assertIn("on:\n  workflow_dispatch:",text)
        self.assertNotIn("\n  push:",text)
        self.assertIn("    if: ${{ false }}",text)
        self.assertIn("fizira-frontend-production",text)
        self.assertIn("persist-credentials: false",text)

    def test_pin_and_only_nine_file_publication(self):
        text=WORKFLOW.read_text()
        self.assertIn(COMMIT,text)
        self.assertIn("Recheck 21 server bytes",text)
        self.assertIn("nine reviewed",text)
        self.assertIn("index.html last",text)
        self.assertIn("state base",text)
        self.assertIn("state head",text)
        self.assertNotIn("supabase/migrations",text)
        self.assertNotIn("docker ",text)

    def test_rollback_fails_closed(self):
        text=WORKFLOW.read_text()
        self.assertIn("steps.activate.outcome == 'failure'",text)
        self.assertIn("steps.verify.outcome == 'failure'",text)
        self.assertIn("::rollback",text)
        self.assertIn("::activate",text)
        self.assertNotIn("sudo ",text)

    def test_shell_steps_parse(self):
        steps=shell_steps(WORKFLOW.read_text())
        self.assertGreaterEqual(len(steps),8)
        for index,script in enumerate(steps):
            result=subprocess.run(["bash","-n"],input=script.encode(),capture_output=True)
            self.assertEqual(result.returncode,0,f"run block {index}: {result.stderr.decode()}")

    def test_actual_package_and_validated_private_stage(self):
        run_id=os.environ["GITHUB_RUN_ID"]
        archive=Path(os.environ["RUNNER_TEMP"])/("flower-release-"+run_id+".tar.gz")
        transaction=(OPS/"flower-frontend-transaction.py").read_bytes()
        with tempfile.TemporaryDirectory(prefix="flower-stage-contract-") as directory:
            home=Path(directory)/"home"
            private=home/".cache"/"fizira-frontend-deploy"
            private.mkdir(parents=True,mode=0o700)
            pkg=private/("flower-"+run_id+".tar.gz")
            shutil.copyfile(archive,pkg)
            destination=private/("flower-"+run_id)
            with patch.object(Path,"home",return_value=home):
                stage.stage_package(pkg,digest(pkg.read_bytes()),destination,digest(transaction))
            self.assertTrue(destination.is_dir())
            txn=imported(OPS/"flower-frontend-transaction.py","flower_txn")
            names,base,head=txn.parse_pins(destination/"pins.json")
            self.assertEqual(len(names),21)
            for name in stage.DELTA:
                self.assertEqual(digest((destination/"stage"/name).read_bytes()),head[name])
            self.assertFalse((home/"app.js").exists())

    def test_tampered_bundle_sha_blocks_private_stage(self):
        run_id=os.environ["GITHUB_RUN_ID"]
        archive=Path(os.environ["RUNNER_TEMP"])/("flower-release-"+run_id+".tar.gz")
        with tempfile.TemporaryDirectory(prefix="flower-stage-negative-") as directory:
            home=Path(directory)/"home"
            private=home/".cache"/"fizira-frontend-deploy"
            private.mkdir(parents=True,mode=0o700)
            pkg=private/("flower-"+run_id+".tar.gz")
            shutil.copyfile(archive,pkg)
            destination=private/("flower-"+run_id)
            with patch.object(Path,"home",return_value=home):
                with self.assertRaisesRegex(ValueError,"PACKAGE_HASH_STOP"):
                    stage.stage_package(pkg,"0"*64,destination,
                                        digest((OPS/"flower-frontend-transaction.py").read_bytes()))
            self.assertFalse(destination.exists())

if __name__=="__main__":unittest.main(verbosity=2)
