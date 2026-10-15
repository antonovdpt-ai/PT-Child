#!/usr/bin/env python3
"""0.188 four-file Flower-only production transaction, with scoped fresh v1 snapshot.

Imports the existing reviewed fd/no-follow frontend-snapshot.py unmodified.
Fail-closed; no database, backend, service or patient-record operations.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat

BASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
DELTA=("app.js","patient-flower.css","patient-flower.mjs","index.html")
PRODUCTION=Path("/root/supabase-project/volumes/proxy/app")
APPROVAL="0.188-flower-nav::"
RUN_RE=re.compile(r"[0-9]{1,30}\Z")
HASH_RE=re.compile(r"[a-f0-9]{64}\Z")

def need(value,reason):
    if not value:raise ValueError(reason)

def digest(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size<=64*1024*1024,"NONREGULAR_FILE_STOP")
        sha=hashlib.sha256()
        while True:
            buf=os.read(fd,65536)
            if not buf:break
            sha.update(buf)
        after=os.fstat(fd)
        need((before.st_ino,before.st_size,before.st_mtime_ns)==
             (after.st_ino,after.st_size,after.st_mtime_ns),
             "CHANGED_DURING_HASH_STOP")
        return sha.hexdigest(),before
    finally:os.close(fd)

def paths(job_id):
    need(RUN_RE.fullmatch(job_id),"RUN_ID_STOP")
    private=Path.home()/".cache"/"fizira-flower-nav"/job_id
    backups=Path.home()/".cache"/"fizira-frontend-snapshots"
    backup=backups/("flower-nav-"+job_id)
    for path in (private,private/"stage",backups,PRODUCTION):
        need(path.is_dir() and not path.is_symlink(),"PRIVATE_OR_LIVE_DIRECTORY_STOP")
    need(backup.parent==backups and private.parent==Path.home()/".cache"/"fizira-flower-nav",
         "PATH_SCOPE_STOP")
    return private,backup

def script_module(private):
    path=private/"frontend-snapshot.py"
    need(path.is_file() and not path.is_symlink(),"SNAPSHOT_MODULE_STOP")
    spec=importlib.util.spec_from_file_location("reviewed_frontend_snapshot",path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def pins_verify(private):
    p=private/"pins.json"
    need(not p.is_symlink() and p.is_file() and p.stat().st_size<100_000,"PINS_FILE_STOP")
    pins=json.loads(p.read_text())
    need(set(pins)=={"fromCommit","targetVersion","assets","base","head","delta"} and
         pins["fromCommit"]==BASE and pins["targetVersion"]=="0.188-flower-nav" and
         pins["delta"]==list(DELTA),"PINS_VERSION_STOP")
    names=pins["assets"]
    need(isinstance(names,list) and len(names)==21 and len(set(names))==21 and
         names[-1]=="index.html" and
         all(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*",x) for x in names),
         "PINS_LIST_STOP")
    base=pins["base"];head=pins["head"]
    need(set(names)==set(base)==set(head) and
         all(isinstance(x,str) and HASH_RE.fullmatch(x) for x in
             list(base.values())+list(head.values())) and
         {x for x in names if base[x]!=head[x]}==set(DELTA),
         "PINS_DELTA_STOP")
    for name in DELTA:
        staged=private/"stage"/name
        need(digest(staged)[0]==head[name],"STAGED_HASH_STOP")
    return names,base,head

def live_verify(names,expected):
    info={}
    for name in names:
        path=PRODUCTION/name
        need(not path.is_symlink(),"LIVE_SYMLINK_STOP")
        got,meta=digest(path)
        need(got==expected[name],"LIVE_HASH_STOP:"+name)
        info[name]=meta
    return info

def permission_check(metadata):
    user=os.geteuid();groups=set(os.getgroups())|{os.getegid()}
    for name in DELTA:
        info=metadata[name]
        need(info.st_uid==user and info.st_gid in groups,"FILE_NOT_OWNED_STOP:"+name)
    need(os.access(PRODUCTION,os.W_OK|os.X_OK),"LIVE_DIRECTORY_NOT_WRITABLE_STOP")

def validate_backup(snapshot,backup,names,manifest):
    need(isinstance(manifest,str) and HASH_RE.fullmatch(manifest),
         "EXPECTED_BACKUP_MANIFEST_REQUIRED_STOP")
    return snapshot.verify(backup,list(DELTA),manifest)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=("preflight","backup","activate","rollback"))
    parser.add_argument("--job-id",required=True)
    parser.add_argument("--manifest-sha256")
    args=parser.parse_args()
    private,backup=paths(args.job_id)
    snapshot=script_module(private)
    names,base,head=pins_verify(private)
    if args.action in ("activate","rollback"):
        need(os.environ.get("FIZIRA_NAV_RELEASE_APPROVAL")==APPROVAL+args.action,
             "PRODUCTION_APPROVAL_STOP")
        verified=validate_backup(snapshot,backup,names,args.manifest_sha256)
        before=snapshot.rows(backup/"before.tsv",list(DELTA),absent=True)
        after=snapshot.rows(backup/"release.tsv",list(DELTA))
        need(all(before[n]==base[n] and after[n]==head[n] for n in DELTA),
             "BACKUP_FOUR_STATE_STOP")
        # A publication resumed after interruption is not automatically retried.
        if args.action=="activate":
            meta=live_verify(names,base)
            permission_check(meta)
            result=snapshot.mutate("activate",PRODUCTION,private/"stage",backup,list(DELTA))
            live_verify(names,head)
            print(json.dumps({"NAV_ACTIVATE":"PASS","changedFiles":result["changedFiles"],
                              "postDiskAssets":21},sort_keys=True))
        else:
            # Preserve all 17 unchanged files; changed files must be in known
            # old/new states. Refuse unrelated operator changes or corruption.
            for name in names:
                value,_=digest(PRODUCTION/name)
                expected={base[name],head[name]} if name in DELTA else {base[name]}
                need(value in expected,"UNKNOWN_ROLLBACK_STATE_STOP:"+name)
            result=snapshot.mutate("rollback",PRODUCTION,private/"stage",backup,list(DELTA))
            live_verify(names,base)
            print(json.dumps({"NAV_ROLLBACK":"PASS","changedFiles":result["changedFiles"],
                              "postDiskAssets":21},sort_keys=True))
    elif args.action=="preflight":
        meta=live_verify(names,base)
        permission_check(meta)
        need(not backup.exists() and not backup.is_symlink(),"BACKUP_REUSE_STOP")
        print(json.dumps({"NAV_PREFLIGHT":"PASS","diskAssets":len(names),
                          "deltaFiles":len(DELTA)},sort_keys=True))
    else:
        meta=live_verify(names,base)
        permission_check(meta)
        need(not backup.exists() and not backup.is_symlink(),"BACKUP_REUSE_STOP")
        # The live web tree also includes other-user files which the SSH
        # identity must never chmod/chown/read with elevated permissions.
        # Back up the EXACT four files that may be replaced, preserving their
        # source ownership, mode, mtime and SHA. Other 17 pinned assets are
        # verified but are never modified by either transaction.
        originals=private/"original-four"
        need(not originals.exists() and not originals.is_symlink(),
             "ORIGINALS_REUSE_STOP")
        originals.mkdir(mode=0o700)
        for name in DELTA:
            snapshot.copy_checked(PRODUCTION/name,originals/name,base[name])
            need(snapshot.sha(originals/name)==base[name],
                 "COPIED_ORIGINAL_MISMATCH_STOP")
        live_verify(names,base)
        result=snapshot.create(originals,private/"stage",backup,list(DELTA))
        checked=validate_backup(snapshot,backup,names,result["manifestSha256"])
        need(result["files"]==4 and checked["manifestSha256"]==result["manifestSha256"],
             "SNAPSHOT_AFTER_CREATE_STOP")
        live_verify(names,base)
        print(json.dumps({"NAV_BACKUP":"PASS","manifestSha256":result["manifestSha256"],
                          "scope":"EXACT_FOUR_REPLACED_FILES",
                          "diskAssetsVerified":21,
                          "files":result["files"],"bytes":result["bytes"]},sort_keys=True))

if __name__=="__main__":
    try:main()
    except (ValueError,TypeError,KeyError,OSError,RuntimeError) as exc:
        label=str(exc)
        if not re.fullmatch("[A-Z0-9_:-]+",label):
            label=type(exc).__name__
        print(json.dumps({"NAV_TRANSACTION":"STOP","reason":label}))
        raise SystemExit(1)
