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

def copy_production_file_without_parent_directory_reads(name,destination,expected):
    """Read a known public asset safely without requiring O_RDONLY on every ancestor.

    Timeweb allows traversal and direct O_NOFOLLOW reads but does not grant
    directory READ access for every ancestor. Never weaken permissions or sudo.
    """
    source=PRODUCTION/name
    need(name in DELTA and not source.is_symlink(),"COPY_SOURCE_SCOPE_STOP")
    fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    output=None
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size<=64*1024*1024,
             "COPY_REGULAR_SOURCE_STOP")
        need(before.st_uid==os.geteuid(),"COPY_OWNER_STOP")
        destination=Path(destination)
        need(not destination.exists() and not destination.is_symlink(),
             "COPY_DEST_ALREADY_EXISTS_STOP")
        output=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        sha=hashlib.sha256();size=0
        while True:
            chunk=os.read(fd,65536)
            if not chunk:break
            sha.update(chunk);size+=len(chunk)
            need(size<=64*1024*1024,"COPY_SIZE_STOP")
            pending=memoryview(chunk)
            while pending:
                pending=pending[os.write(output,pending):]
        after=os.fstat(fd)
        need(sha.hexdigest()==expected and size==before.st_size and
             (before.st_ino,before.st_size,before.st_mtime_ns)==
             (after.st_ino,after.st_size,after.st_mtime_ns),
             "COPY_SOURCE_CHANGED_STOP")
        os.fchmod(output,stat.S_IMODE(before.st_mode))
        if os.fstat(output).st_gid!=before.st_gid:
            os.fchown(output,-1,before.st_gid)
        os.utime(output,ns=(before.st_atime_ns,before.st_mtime_ns))
        os.fsync(output)
    finally:
        if output is not None:os.close(output)
        os.close(fd)
    copied,meta=digest(destination)
    need(copied==expected and meta.st_uid==before.st_uid and
         meta.st_gid==before.st_gid and
         stat.S_IMODE(meta.st_mode)==stat.S_IMODE(before.st_mode) and
         meta.st_mtime_ns==before.st_mtime_ns,
         "COPY_DESTINATION_VERIFY_STOP")

def anchored_replace(name,wanted,source,expected,metadata):
    """Use reviewed 0.187 root-descriptor pattern, never traverse unreadable /root."""
    need(name in DELTA,"MUTATION_ALLOWLIST_STOP")
    rootfd=os.open(PRODUCTION,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    temp=None
    try:
        def current():
            fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=rootfd)
            try:
                first=os.fstat(fd)
                need(stat.S_ISREG(first.st_mode) and first.st_size<=64*1024*1024,
                     "LIVE_NONREGULAR_STOP")
                h=hashlib.sha256()
                for chunk in iter(lambda:os.read(fd,65536),b""):h.update(chunk)
                last=os.fstat(fd)
                need((first.st_ino,first.st_size,first.st_mtime_ns)==
                     (last.st_ino,last.st_size,last.st_mtime_ns),"LIVE_RACE_STOP")
                return h.hexdigest()
            finally:os.close(fd)
        need(current()==expected,"LIVE_CHANGED_BEFORE_REPLACE_STOP")
        if wanted==expected:return False
        content,source_info=None,None
        if source is not None:
            actual,source_info=digest(source)
            need(actual==wanted,"SOURCE_HASH_STOP")
            with open(source,"rb") as f:
                content=f.read(64*1024*1024+1)
            need(len(content)<=64*1024*1024 and hashlib.sha256(content).hexdigest()==wanted,
                 "SOURCE_CHANGED_STOP")
        need(content is not None,"MISSING_RESTORE_BYTES_STOP")
        temp=".fizira-nav-"+os.urandom(16).hex()
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=rootfd)
        try:
            with os.fdopen(os.dup(fd),"wb") as out:
                out.write(content);out.flush()
            os.fchmod(fd,metadata["mode"])
            if os.fstat(fd).st_gid!=metadata["gid"]:
                os.fchown(fd,-1,metadata["gid"])
            os.utime(fd,ns=(metadata["mtimeNs"],metadata["mtimeNs"]))
            os.fsync(fd)
        finally:os.close(fd)
        need(current()==expected,"LIVE_CHANGED_DURING_STAGE_STOP")
        os.replace(temp,name,src_dir_fd=rootfd,dst_dir_fd=rootfd)
        temp=None
        os.fsync(rootfd)
        need(current()==wanted,"POST_REPLACE_HASH_STOP")
        return True
    finally:
        if temp is not None:
            try:os.unlink(temp,dir_fd=rootfd)
            except FileNotFoundError:pass
        os.close(rootfd)

def anchored_transaction(mode,snapshot,private,backup,base,head,names):
    """Guard full known state before any mutation; only four root-anchored writes."""
    need(mode in ("activate","rollback"),"BAD_MUTATION_MODE_STOP")
    snapshot.verify(backup,list(DELTA))
    manifest=json.loads((backup/"snapshot.json").read_text())
    backup_files=manifest["files"]
    for name in names:
        actual,_=digest(PRODUCTION/name)
        allowed=({base[name]} if mode=="activate" else
                 {base[name],head[name]} if name in DELTA else {base[name]})
        need(actual in allowed,"UNKNOWN_LIVE_STATE_STOP:"+name)
    sequence=DELTA if mode=="activate" else ("index.html","patient-flower.mjs","patient-flower.css","app.js")
    changed=0
    for name in sequence:
        wanted=head[name] if mode=="activate" else base[name]
        current,_=digest(PRODUCTION/name)
        if current==wanted:continue
        source=(private/"stage"/name if mode=="activate" else backup/"files"/name)
        info=backup_files[name]
        need(info["sha256"]==base[name],"BACKUP_SOURCE_HASH_STOP")
        if anchored_replace(name,wanted,source,current,info):changed+=1
    live_verify(names,head if mode=="activate" else base)
    return {"frontend":mode.upper()+"_VERIFIED","changedFiles":changed}

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
            result=anchored_transaction("activate",snapshot,private,backup,base,head,names)
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
            result=anchored_transaction("rollback",snapshot,private,backup,base,head,names)
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
            copy_production_file_without_parent_directory_reads(
                name,originals/name,base[name])
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
