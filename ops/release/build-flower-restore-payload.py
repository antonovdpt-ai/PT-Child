#!/usr/bin/env python3
"""Build pinned, bounded isolated-restore payload for one GitHub Actions run."""
import hashlib
import os
from pathlib import Path
import subprocess

BASE="51e18c88377a7b20d06eef24b0db9fcb6d45fd3a"
HEAD="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
RESTORE=Path("ops/release/flower-tar-isolated-restore.py")

def git(*args):
    result=subprocess.run(["git",*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        raise SystemExit("STOP: PINNED_GIT_SOURCE_NOT_AVAILABLE")
    return result.stdout

if (os.environ.get("GITHUB_ACTIONS")!="true" or
    os.environ.get("GITHUB_REPOSITORY")!="antonovdpt-ai/PT-Child" or
    os.environ.get("GITHUB_REF")!="refs/heads/release/flower-frontend-only-20261015"):
    raise SystemExit("STOP: INVALID_CI_CONTEXT")
run_id=os.environ.get("GITHUB_RUN_ID","")
if not run_id.isdecimal() or len(run_id)>30:
    raise SystemExit("STOP: INVALID_RUN_ID")
git("merge-base","--is-ancestor",HEAD,"HEAD")
names=git("show",HEAD+":ops/release/frontend-assets.txt").decode().splitlines()
if len(names)!=21 or names[-1]!="index.html" or len(set(names))!=21:
    raise SystemExit("STOP: INVALID_FRONTEND_ALLOWLIST")
base={};head={}
for name in names:
    present=subprocess.run(["git","cat-file","-e",BASE+":"+name],
                            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
    base[name]=hashlib.sha256(git("show",BASE+":"+name)).hexdigest() if present else None
    head[name]=hashlib.sha256(git("show",HEAD+":"+name)).hexdigest()
if sum(value is None for value in base.values())!=3 or sum(base[x]!=head[x] for x in names)!=9:
    raise SystemExit("STOP: UNEXPECTED_RELEASE_DIFF")
payload="PIN_BASE="+repr(base)+"\nPIN_HEAD="+repr(head)+"\nRUN_NUMBER="+repr(run_id)+"\n"+RESTORE.read_text()
compile(payload,str(RESTORE),"exec")
output=Path(os.environ["RUNNER_TEMP"])/"flower-isolated-restore.py"
output.write_text(payload)
output.chmod(0o600)
print("ISOLATED_RESTORE_PAYLOAD=VERIFIED")
print("BASE="+BASE)
print("RELEASE="+HEAD)
print("RESTORE_ALLOWS_ONLY_PRIVATE_DESTINATION=YES")
