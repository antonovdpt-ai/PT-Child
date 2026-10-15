#!/usr/bin/env python3
"""Four-file Flower UI hotfix transaction; no backend, auth or database mutation.

Stage bundle and release manifest are prepared from two exact Git commits.
Only the fixed production web-root is writable, and only in explicit modes.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

LIVE=Path("/root/supabase-project/volumes/proxy/app")
FOUR=("app.js","patient-flower.mjs","patient-flower.css","index.html")
BASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
APPROVAL="0.188-flower-nav-20261015"

def require(v,label):
    if not v:raise ValueError(label)

def sha(b):return hashlib.sha256(b).hexdigest()

def checked_dir(p):
    p=Path(os.path.abspath(p))
    require(p.is_dir() and not any(x.is_symlink() for x in (p,*p.parents)), "DIRECTORY_STOP")
    return p

def read(path):
    p=Path(path)
    require(p.is_file() and not p.is_symlink() and p.stat().st_size<=64*1024*1024,"FILE_STOP")
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        first=os.fstat(fd)
        require(stat.S_ISREG(first.st_mode) and first.st_size<=64*1024*1024,"NOT_REGULAR_STOP")
        data=b""
        while True:
            piece=os.read(fd,65536)
            if not piece:break
            data+=piece
            require(len(data)<=64*1024*1024,"TOO_BIG_STOP")
        after=os.fstat(fd)
        require((first.st_ino,first.st_size,first.st_mtime_ns)==
                (after.st_ino,after.st_size,after.st_mtime_ns),"CHANGING_FILE_STOP")
        return data
    finally:os.close(fd)

def pins_load(stagedir):
    pins=json.loads(read(stagedir/"pins.json"))
    names=pins["assets"]
    require(len(names)==21 and len(set(names))==21 and names[-1]=="index.html"
            and set(names)==set(pins["base"])==set(pins["head"]),"PINS_SET_STOP")
    require(pins["baseCommit"]==BASE and re.fullmatch("[a-f0-9]{40}",pins["headCommit"]),"COMMIT_STOP")
    require(tuple(pins["changed"])==FOUR and
            {n for n in names if pins["base"][n]!=pins["head"][n]}==set(FOUR),"DELTA_STOP")
    require(all(isinstance(pins[k][n],str) and re.fullmatch("[a-f0-9]{64}",pins[k][n])
                for k in ("base","head") for n in names),"HASH_FORMAT_STOP")
    for name in FOUR:
        require(sha(read(stagedir/"stage"/name))==pins["head"][name],"STAGE_SHA_STOP")
    return pins

def validate_disk(live,pins,which):
    for name in pins["assets"]:
        require(sha(read(live/name))==pins[which][name],"DISK_SHA_STOP:"+name)
    print("DISK_"+which.upper()+"_21=PASS",flush=True)

def handler(mode,stagedir,backup,expected_script_sha):
    require(mode in ("preflight","backup","activate","rollback","verify"),"BAD_MODE_STOP")
    live=checked_dir(LIVE)
    stage=checked_dir(stagedir)
    backup=Path(os.path.abspath(backup))
    require(backup.parent==Path.home()/".cache"/"fizira-frontend-snapshots" and
            re.fullmatch("flower-nav-[0-9]{1,25}",backup.name),"BACKUP_PATH_STOP")
    require(not any(x.is_symlink() for x in backup.parents),"BACKUP_SYMLINK_STOP")
    require(stage.parent==Path.home()/".cache"/"fizira-frontend-deploy" and
            re.fullmatch("flower-nav-[0-9]{1,25}",stage.name),"STAGE_PATH_STOP")
    require(not any(x==live or x in live.parents or live in x.parents for x in (stage,backup)),"OVERLAP_STOP")
    require(sha(read(stage/"flower-nav-update.py"))==expected_script_sha,"HELPER_SHA_STOP")
    # Require known helper bytes from pinned staging metadata, never an arbitrary script.
    pins=pins_load(stage)
    require(pins["helperSha256"]==expected_script_sha,"PINNED_HELPER_STOP")
    require(sha(read(stage/"frontend-snapshot.py"))==pins["snapshotSha256"],"SNAPSHOT_SCRIPT_SHA_STOP")
    spec=importlib.util.spec_from_file_location("frontend_snapshot",stage/"frontend-snapshot.py")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if mode in ("backup","activate","rollback"):
        require(os.environ.get("FIZIRA_FLOWER_NAV_APPROVAL")==APPROVAL+"::"+mode,
                "EXPLICIT_APPROVAL_STOP")
    names=list(FOUR)
    if mode=="preflight":
        require(not backup.exists(),"BACKUP_ALREADY_EXISTS_STOP")
        validate_disk(live,pins,"base")
        print("FLOWER_NAV_PREFLIGHT=PASS")
        return
    if mode=="backup":
        require(not backup.exists(),"BACKUP_ALREADY_EXISTS_STOP")
        validate_disk(live,pins,"base")
        if not backup.parent.exists(): backup.parent.mkdir(mode=0o700)
        result=module.create(live,stage/"stage",backup,names)
        require(result["snapshot"]=="FRONTEND_SNAPSHOT_VERIFIED","BACKUP_STOP")
        print("FLOWER_NAV_BACKUP=PASS",result["manifestSha256"],flush=True)
        return
    require(backup.is_dir() and not backup.is_symlink(),"BACKUP_MISSING_STOP")
    info=module.verify(backup,names)
    require(info["snapshot"]=="FRONTEND_SNAPSHOT_VERIFIED","BACKUP_UNVERIFIED_STOP")
    before=module.rows(backup/"before.tsv",names,absent=True)
    after=module.rows(backup/"release.tsv",names)
    require(all(before[n]==pins["base"][n] and after[n]==pins["head"][n] for n in names),
            "BACKUP_PINS_STOP")
    if mode=="activate":
        validate_disk(live,pins,"base")
        result=module.mutate("activate",live,stage/"stage",backup,names)
        require(result["frontend"]=="ACTIVATE_VERIFIED" and result["changedFiles"]==4,
                "ACTIVATE_COUNT_STOP")
        validate_disk(live,pins,"head")
        print("FLOWER_NAV_ACTIVATE=PASS")
    elif mode=="verify":
        validate_disk(live,pins,"head")
        print("FLOWER_NAV_VERIFY=PASS")
    elif mode=="rollback":
        # Original snapshot script checks every allowed old/new state, then restores
        # only the four changed assets; unknown states are refused.
        result=module.mutate("rollback",live,stage/"stage",backup,names)
        require(result["frontend"]=="ROLLBACK_VERIFIED","ROLLBACK_FAILED_STOP")
        validate_disk(live,pins,"base")
        print("FLOWER_NAV_ROLLBACK=PASS")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=("preflight","backup","activate","rollback","verify"))
    parser.add_argument("--stage",required=True)
    parser.add_argument("--backup",required=True)
    parser.add_argument("--helper-sha256",required=True)
    args=parser.parse_args()
    try:handler(args.mode,args.stage,args.backup,args.helper_sha256)
    except Exception as exc:
        print("FLOWER_NAV=STOP:"+str(exc),flush=True)
        return 1
    return 0

if __name__=="__main__":sys.exit(main())
