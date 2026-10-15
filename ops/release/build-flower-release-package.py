#!/usr/bin/env python3
"""Prepare ONLY the nine immutable Flower UI release assets for later review.

No remote access, secrets, deployment or production writes. Runner-local
archive contains: stage/<nine files>, pins.json, transaction.py, MANIFEST.sha256.
The full 21-entry release manifest and all SHA values are Git-source-pinned.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

BASE="51e18c88377a7b20d06eef24b0db9fcb6d45fd3a"
RELEASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
CHANGED=("cabinet.js","schedule-editor.js","parent-specialist.js","parent.html","app.js","index.html")
NEW=("patient-flower.css","patient-flower.mjs","patient-overview.mjs")
DELTA=NEW+CHANGED
TX=Path("ops/release/flower-frontend-transaction.py")
BACKUP_SHA="e18171381a5452860741fbe6578586aa6ceea0d33c7cac54ac3c5f56f5925346"

def git(*args):
    r=subprocess.run(["git",*args],capture_output=True)
    if r.returncode: raise ValueError("SOURCE_PIN_UNAVAILABLE_STOP")
    return r.stdout

def sha(b):return hashlib.sha256(b).hexdigest()

def run():
    if (os.environ.get("GITHUB_ACTIONS")!="true" or
        os.environ.get("GITHUB_REPOSITORY")!="antonovdpt-ai/PT-Child" or
        os.environ.get("GITHUB_REF")!="refs/heads/release/flower-frontend-only-20261015"):
        raise ValueError("UNEXPECTED_PACKAGE_CONTEXT_STOP")
    run_id=os.environ.get("GITHUB_RUN_ID","")
    if not re.fullmatch("[0-9]{1,30}",run_id):
        raise ValueError("RUN_IDENTIFIER_STOP")
    git("merge-base","--is-ancestor",RELEASE,"HEAD")
    names=git("show",RELEASE+":ops/release/frontend-assets.txt").decode().splitlines()
    if len(names)!=21 or len(set(names))!=21 or names[-1]!="index.html":
        raise ValueError("FRONTEND_MANIFEST_STOP")
    base={};head={};blobs={}
    for name in names:
        if not re.fullmatch("[a-zA-Z0-9][a-zA-Z0-9._-]*",name):
            raise ValueError("PATH_NOT_ALLOWLISTED_STOP")
        exists=subprocess.run(["git","cat-file","-e",BASE+":"+name],capture_output=True).returncode==0
        base[name]=sha(git("show",BASE+":"+name)) if exists else None
        content=git("show",RELEASE+":"+name)
        head[name]=sha(content)
        if name in DELTA:
            blobs[name]=content
    if set(DELTA)!={n for n in names if base[n]!=head[n]}:
        raise ValueError("DELTA_NOT_NINE_STOP")
    if set(NEW)!={n for n in names if base[n] is None}:
        raise ValueError("NEW_FILE_SET_STOP")
    output=Path(os.environ["RUNNER_TEMP"])/("flower-package-"+run_id)
    if output.exists():raise ValueError("PACKAGE_ALREADY_EXISTS_STOP")
    output.mkdir(mode=0o700)
    (output/"stage").mkdir(mode=0o700)
    for name in DELTA:
        path=output/"stage"/name
        path.write_bytes(blobs[name])
        path.chmod(0o644)
        if sha(path.read_bytes())!=head[name]:
            raise ValueError("PACKAGE_STAGED_HASH_STOP")
    pins=output/"pins.json"
    pins.write_text(json.dumps({"assets":names,"base":base,"head":head},
                                sort_keys=True,indent=2)+"\n")
    pins.chmod(0o600)
    runner=output/"transaction.py"
    shutil.copyfile(TX,runner)
    runner.chmod(0o600)
    allowed=["pins.json","transaction.py"]+["stage/"+n for n in DELTA]
    manifest=output/"MANIFEST.sha256"
    manifest.write_text("".join(sha((output/n).read_bytes())+"  "+n+"\n" for n in allowed))
    manifest.chmod(0o600)
    payload=output.parent/("flower-release-"+run_id+".tar.gz")
    with tarfile.open(payload,"w:gz",format=tarfile.PAX_FORMAT) as tar:
        for name in ["MANIFEST.sha256",*allowed]:
            path=output/name
            stat=path.lstat()
            if not path.is_file() or path.is_symlink():
                raise ValueError("PACKAGE_NONREGULAR_STOP")
            tar.add(path,arcname=name,recursive=False)
    # Reopen the finished archive and validate all actual bytes and names.
    with tarfile.open(payload,"r:gz") as archive:
        entries={m.name:m for m in archive.getmembers()}
        if set(entries)!=set(["MANIFEST.sha256",*allowed]):
            raise ValueError("PACKAGE_ARCHIVE_SET_STOP")
        for name in entries:
            member=entries[name]
            if not member.isfile() or member.issym() or member.islnk():
                raise ValueError("PACKAGE_ENTRY_TYPE_STOP")
            content=archive.extractfile(member).read()
            if sha(content)!=sha((output/name).read_bytes()):
                raise ValueError("PACKAGE_ARCHIVE_BYTES_STOP")
    (output.parent/("flower-release-"+run_id+".tar.gz.sha256")).write_text(
        sha(payload.read_bytes())+"  "+payload.name+"\n")
    print("FLOWER_PACKAGE=PASS")
    print("PINNED_BASE="+BASE)
    print("PINNED_RELEASE="+RELEASE)
    print("BACKUP_MANIFEST_SHA256="+BACKUP_SHA)
    print("PACKAGED_CHANGED_ASSETS=9")
    print("FRONTEND_MANIFEST=21")
    print("ARCHIVE_SHA256="+sha(payload.read_bytes()))
    print("PACKAGE_SOURCE=GIT_VERIFIED")
    print("REMOTE_CONNECTIONS=NONE")
    print("PRODUCTION_WRITES=NONE")

if __name__=="__main__":
    run()
