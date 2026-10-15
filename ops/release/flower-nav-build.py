#!/usr/bin/env python3
"""Build reviewed 0.187 -> 0.188 exact frontend pins, stage FOUR files only.

Never contacts Timeweb and never modifies production.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
BASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
NAMES=("app.js","patient-flower.css","patient-flower.mjs","index.html")

def stop(flag,reason):
    if not flag:raise ValueError(reason)

def git(*args):
    r=subprocess.run(["git",*args],capture_output=True)
    stop(r.returncode==0,"REVIEWED_SOURCE_UNAVAILABLE_STOP")
    return r.stdout

def sha(data):return hashlib.sha256(data).hexdigest()

def build(root):
    root=Path(root)
    stop(not root.exists(),"STAGE_ALREADY_EXISTS_STOP")
    root.mkdir(mode=0o700)
    stage=root/"stage";stage.mkdir(mode=0o700)
    stop(os.environ.get("GITHUB_REPOSITORY")=="antonovdpt-ai/PT-Child",
         "REPOSITORY_STOP")
    stop(os.environ.get("GITHUB_REF")=="refs/heads/fix/flower-navigation-20261015",
         "BRANCH_STOP")
    git("merge-base","--is-ancestor",BASE,"HEAD")
    names=git("show",BASE+":ops/release/frontend-assets.txt").decode().splitlines()
    stop(len(names)==21 and len(set(names))==21 and names[-1]=="index.html",
         "BASE_MANIFEST_STOP")
    base={};head={}
    for name in names:
        stop(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*",name),"NAME_STOP")
        old=git("show",BASE+":"+name)
        new=git("show","HEAD:"+name)
        base[name]=sha(old);head[name]=sha(new)
        if name in NAMES:
            (stage/name).write_bytes(new)
            (stage/name).chmod(0o644)
    stop({n for n in names if base[n]!=head[n]}==set(NAMES),
         "DELTA_NOT_FOUR_STOP")
    stop(head["index.html"]!=base["index.html"],"INDEX_NOT_REFRESHED_STOP")
    pins={"fromCommit":BASE,"targetVersion":"0.188-flower-nav",
          "assets":names,"base":base,"head":head,"delta":list(NAMES)}
    (root/"pins.json").write_text(json.dumps(pins,indent=2,sort_keys=True)+"\n")
    (root/"pins.json").chmod(0o600)
    for n in NAMES:stop(sha((stage/n).read_bytes())==head[n],"STAGE_HASH_STOP")
    print("NAV_PACKAGE=PASS")
    print("BASE_ASSETS=21")
    print("CHANGED_ASSETS=4")
    print("TARGET_VERSION=0.188-flower-nav")

if __name__=="__main__":
    import sys
    if len(sys.argv)!=2:raise SystemExit(2)
    try:build(sys.argv[1])
    except (ValueError,OSError) as exc:
        print("NAV_PACKAGE=STOP",str(exc));raise SystemExit(1)
