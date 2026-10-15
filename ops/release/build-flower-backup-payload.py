#!/usr/bin/env python3
"""Build a pinned, snapshot-only Python stdin payload, with no network or prod access."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys

BASE="51e18c88377a7b20d06eef24b0db9fcb6d45fd3a"
HEAD="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
SOURCE=Path("ops/release/frontend-snapshot.py")
DRIVER=Path("ops/release/flower-backup-only-driver.py")

def run(*args):
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode: raise SystemExit("STOP: git source check failed")
    return p.stdout

if os.environ.get("GITHUB_ACTIONS")!="true":
    raise SystemExit("STOP: only CI")
if os.environ.get("GITHUB_REPOSITORY")!="antonovdpt-ai/PT-Child":
    raise SystemExit("STOP: wrong repository")
if os.environ.get("GITHUB_REF")!="refs/heads/release/flower-frontend-only-20261015":
    raise SystemExit("STOP: wrong branch")
run_id=os.environ.get("GITHUB_RUN_ID","")
if not run_id.isdecimal() or not 1<=len(run_id)<=30:
    raise SystemExit("STOP: run ID")
run("git","merge-base","--is-ancestor",HEAD,"HEAD")
if hashlib.sha256(SOURCE.read_bytes()).hexdigest()!=hashlib.sha256(
        run("git","show",HEAD+":"+str(SOURCE))).hexdigest():
    raise SystemExit("STOP: snapshot helper drift")
names=run("git","show",HEAD+":ops/release/frontend-assets.txt").decode().splitlines()
if names!=Path("ops/release/frontend-assets.txt").read_text().splitlines() or len(names)!=21:
    raise SystemExit("STOP: manifest drift")
expected_base={}; expected_head={}
for name in names:
    exists=subprocess.run(["git","cat-file","-e",BASE+":"+name],capture_output=True).returncode==0
    expected_base[name]=hashlib.sha256(run("git","show",BASE+":"+name)).hexdigest() if exists else None
    expected_head[name]=hashlib.sha256(run("git","show",HEAD+":"+name)).hexdigest()
if sum(x is None for x in expected_base.values())!=3:
    raise SystemExit("STOP: not three new assets")
if sum(expected_base[x]!=expected_head[x] for x in names)!=9:
    raise SystemExit("STOP: not nine changed assets")
s=SOURCE.read_text()
marker='\nif __name__ == \'__main__\':'
if s.count(marker)!=1:
    raise SystemExit("STOP: unexpected module structure")
s=s.split(marker)[0]
pins="\nPIN_BASE="+repr(expected_base)+"\nPIN_HEAD="+repr(expected_head)+"\nRUN_NUMBER="+repr(run_id)+"\n"
p=Path(os.environ["RUNNER_TEMP"])/"flower-backup-stdin.py"
p.write_text(s+pins+"\n"+DRIVER.read_text())
p.chmod(0o600)
compile(p.read_bytes(),str(p),"exec")
print("SNAPSHOT_PAYLOAD_VERIFIED=YES")
print("PINNED_BASE="+BASE)
print("PINNED_RELEASE="+HEAD)
print("ASSETS=21 DELTA=9")
