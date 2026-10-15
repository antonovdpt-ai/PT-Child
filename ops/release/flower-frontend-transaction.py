#!/usr/bin/env python3
"""Flower UI nine-asset transaction. No backend changes. No production runner.

Modes: preflight / activate / rollback. On actual Timeweb frontend root,
activate/rollback are blocked unless separate release-specific approval is supplied.
The companion tests run only on disposable directories with fictional content.

Inputs --pins: generated from exact immutable Git commits, never from a live tree.
--backup: existing verified complete TAR_V2 backup, NOT legacy snapshot v1.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tarfile

PRODUCTION="/root/supabase-project/volumes/proxy/app"
BASE_COMMIT="51e18c88377a7b20d06eef24b0db9fcb6d45fd3a"
RELEASE_COMMIT="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
BACKUP_MANIFEST="e18171381a5452860741fbe6578586aa6ceea0d33c7cac54ac3c5f56f5925346"
NEW=("patient-flower.css","patient-flower.mjs","patient-overview.mjs")
CHANGED=("cabinet.js","schedule-editor.js","parent-specialist.js","parent.html","app.js","index.html")
DEPLOY=NEW+CHANGED  # new modules first, index.html last
MAX_BYTES=1024*1024*1024

def need(ok, why):
    if not ok: raise ValueError(why)

def checksum(data):
    return hashlib.sha256(data).hexdigest()

def checked_directory(path):
    p=Path(os.path.abspath(path))
    need(not any(a.is_symlink() for a in (p,*p.parents)),"DIRECTORY_SYMLINK_STOP")
    need(p.is_dir(),"DIRECTORY_MISSING_STOP")
    return p

def read_regular(path,max_size=64*1024*1024):
    info=path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_size<=max_size,"REGULAR_FILE_STOP")
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size<=max_size,"FILE_TYPE_STOP")
        with os.fdopen(os.dup(fd),"rb") as inp: content=inp.read(max_size+1)
        after=os.fstat(fd)
        need(len(content)==before.st_size and
             (before.st_ino,before.st_size,before.st_mtime_ns)==
             (after.st_ino,after.st_size,after.st_mtime_ns),"FILE_RACE_STOP")
        return content,before
    finally: os.close(fd)

def require_file_state(root,name,expected):
    path=root/name
    if expected is None:
        need(not path.exists() and not path.is_symlink(),"NEW_FILE_EXISTS_STOP")
        return None
    data,info=read_regular(path)
    need(checksum(data)==expected,"UNEXPECTED_LIVE_HASH_STOP")
    return info

def parse_pins(path):
    data=json.loads(read_regular(path,max_size=100_000)[0])
    base,head=data["base"],data["head"]
    names=data["assets"]
    need(isinstance(names,list) and len(names)==21 and len(set(names))==21
         and names[-1]=="index.html" and set(names)==set(base)==set(head),
         "PINNED_LIST_STOP")
    need(set(DEPLOY)=={n for n in names if base[n]!=head[n]}, "DELTA_NOT_NINE_STOP")
    need({n for n in names if base[n] is None}==set(NEW),"NEW_ASSET_SET_STOP")
    for digest in list(head.values())+[x for x in base.values() if x is not None]:
        need(isinstance(digest,str) and re.fullmatch("[a-f0-9]{64}",digest),"PIN_SHA_STOP")
    return names,base,head

def validate_backup(folder,names,base,head,expected_manifest):
    b=checked_directory(folder)
    need(stat.S_IMODE(b.stat().st_mode)==0o700,"BACKUP_PRIVACY_STOP")
    m=b/"manifest.sha256"
    manifest,_=read_regular(m,4096)
    need(checksum(manifest)==expected_manifest, "BACKUP_PIN_STOP")
    need(read_regular(b/"complete",1024)[0]==(expected_manifest+"\n").encode(),
         "INCOMPLETE_BACKUP_STOP")
    members=("frontend.tar.gz","snapshot.json","before.tsv","release.tsv")
    lines=manifest.decode().splitlines()
    need(len(lines)==4,"BACKUP_MANIFEST_LINES_STOP")
    for line,name in zip(lines,members):
        need(line==checksum(read_regular(b/name,max_size=MAX_BYTES)[0])+"  "+name,
             "BACKUP_MEMBER_HASH_STOP")
    meta=json.loads(read_regular(b/"snapshot.json",MAX_BYTES)[0])
    need(meta["schemaVersion"]==2 and meta["format"]=="private-tar-gzip",
         "BACKUP_SCHEMA_STOP")
    need(meta["sourceRelease"]==BASE_COMMIT and
         meta["intendedRelease"]==RELEASE_COMMIT,"BACKUP_SOURCE_STOP")
    files=meta["files"];folders=meta["directoryMetadata"]
    need(len(files)<=4096 and len(folders)<=4096 and "." in folders,
         "BACKUP_STRUCTURE_STOP")
    def lines_expected(values):
        return "".join(n+"\t"+(values[n] or "ABSENT")+"\n" for n in names).encode()
    need(read_regular(b/"before.tsv",64_000)[0]==lines_expected(base),
         "BACKUP_BEFORE_STOP")
    need(read_regular(b/"release.tsv",64_000)[0]==lines_expected(head),
         "BACKUP_RELEASE_STOP")
    need(all(files.get(n,{}).get("sha256")==base[n] for n in names if base[n]),
         "BACKUP_LIVE_BASE_STOP")
    need(all(n not in files for n in NEW),"BACKUP_NEW_NOT_ABSENT_STOP")
    expected_names=set(files)|set(folders)
    need(len(expected_names)==len(files)+len(folders),"BACKUP_OVERLAP_STOP")
    total=0;seen=set();original={}
    with tarfile.open(b/"frontend.tar.gz",mode="r:gz") as tar:
        for member in tar:
            name=member.name.rstrip("/") or "."
            parts=name.split("/")
            need(name=="." or (not name.startswith("/") and
                 "\\" not in name and all(q not in ("",".","..") for q in parts)),
                 "TAR_PATH_STOP")
            need(name in expected_names and name not in seen,"TAR_UNKNOWN_OR_DUP_STOP")
            seen.add(name)
            desc=files.get(name) if member.isfile() else folders.get(name) if member.isdir() else None
            need(desc is not None, "TAR_SPECIAL_TYPE_STOP")
            need(member.uid==desc["uid"] and member.gid==desc["gid"] and
                 member.mode==desc["mode"] and
                 member.mtime==desc["mtimeNs"]//1_000_000_000,
                 "TAR_META_STOP")
            if member.isfile():
                need(member.size==desc["bytes"]<=64*1024*1024,"TAR_MEMBER_SIZE_STOP")
                total+=member.size
                need(total<=MAX_BYTES,"TAR_SIZE_LIMIT_STOP")
                stream=tar.extractfile(member)
                need(stream is not None,"TAR_STREAM_STOP")
                blob=stream.read(member.size+1)
                need(len(blob)==member.size and checksum(blob)==desc["sha256"],
                     "TAR_CONTENT_STOP")
                if name in CHANGED: original[name]=blob
    need(seen==expected_names,"TAR_INCOMPLETE_STOP")
    need(set(original)==set(CHANGED),"BACKUP_CHANGED_BYTES_STOP")
    return files,original

def preflight(live,stage,names,base,head,files,mode):
    need(stage!=live and stage not in live.parents and live not in stage.parents,
         "STAGE_ROOT_OVERLAP_STOP")
    states={}
    for name in names:
        before,after=base[name],head[name]
        path=live/name
        if not path.exists() and not path.is_symlink():
            value=None
        else:
            value=checksum(read_regular(path)[0])
        allowed=(before,) if mode in ("activate","preflight") else (before,after)
        need(value in allowed,"UNEXPECTED_LIVE_STATE_STOP")
        states[name]=value
        if mode in ("activate","preflight"):
            # Empty new paths are not part of the backup.
            if name in NEW: need(value is None,"NEW_ASSET_ALREADY_PRESENT_STOP")
    for name in DEPLOY:
        if mode in ("activate","preflight"):
            need(checksum(read_regular(stage/name)[0])==head[name],"STAGED_HASH_STOP")
        if base[name] is not None:
            original=files[name]
            need(original["uid"]==os.geteuid(),"FOREIGN_FILE_OWNER_STOP")
            need(original["gid"] in set(os.getgroups())|{os.getegid()},"FOREIGN_FILE_GROUP_STOP")
            path=live/name
            if path.exists():
                info=path.lstat()
                need(info.st_uid==original["uid"] and info.st_gid==original["gid"] and
                     stat.S_IMODE(info.st_mode)==original["mode"],
                     "LIVE_METADATA_DRIFT_STOP")
    need(os.access(live,os.W_OK|os.X_OK),"LIVE_DIR_NOT_WRITABLE_STOP")
    return states

def change(live,name,wanted,content,metadata,expected_state):
    rootfd=os.open(live,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    tmp=None
    try:
        def current():
            try:
                fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=rootfd)
            except FileNotFoundError: return None
            try:
                st=os.fstat(fd)
                need(stat.S_ISREG(st.st_mode),"LIVE_NONREGULAR_STOP")
                with os.fdopen(os.dup(fd),"rb") as r: return checksum(r.read(64*1024*1024+1))
            finally: os.close(fd)
        need(current()==expected_state,"LIVE_CHANGED_DURING_APPLY_STOP")
        if wanted==expected_state: return False
        if wanted is None:
            os.unlink(name,dir_fd=rootfd)
        else:
            need(content is not None and checksum(content)==wanted,"SOURCE_BYTES_STOP")
            tmp=".fizira-flower-"+secrets.token_hex(16)
            fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=rootfd)
            try:
                with os.fdopen(os.dup(fd),"wb") as out:
                    out.write(content);out.flush()
                if metadata:
                    os.fchmod(fd,metadata["mode"])
                    if os.fstat(fd).st_gid!=metadata["gid"]:
                        os.fchown(fd,-1,metadata["gid"])
                    os.utime(fd,ns=(metadata["mtimeNs"],metadata["mtimeNs"]))
                else: os.fchmod(fd,0o644)
                os.fsync(fd)
            finally: os.close(fd)
            need(current()==expected_state,"RACE_BEFORE_REPLACE_STOP")
            os.replace(tmp,name,src_dir_fd=rootfd,dst_dir_fd=rootfd)
            tmp=None
        os.fsync(rootfd)
        need(current()==wanted,"POST_WRITE_HASH_STOP")
        return True
    finally:
        if tmp is not None:
            try: os.unlink(tmp,dir_fd=rootfd)
            except FileNotFoundError: pass
        os.close(rootfd)

def transact(mode,live,stage,backup,pins,manifest,inject_after=None):
    names,base,head=parse_pins(pins)
    live=checked_directory(live)
    stage=checked_directory(stage) if mode in ("activate","preflight") else Path(stage)
    backup_dir=checked_directory(backup)
    need(backup_dir!=live and backup_dir not in live.parents and
         live not in backup_dir.parents and backup_dir!=stage and
         backup_dir not in stage.parents and stage not in backup_dir.parents,
         "BACKUP_OR_STAGE_OVERLAP_STOP")
    if str(live)==PRODUCTION:
        if mode!="preflight":
            need(os.environ.get("FIZIRA_FRONTEND_RELEASE_APPROVAL")==
                 RELEASE_COMMIT+"::"+mode,"PRODUCTION_APPROVAL_REQUIRED_STOP")
        need(manifest==BACKUP_MANIFEST,"UNAPPROVED_BACKUP_PIN_STOP")
    files,original=validate_backup(backup,names,base,head,manifest)
    preflight(live,stage,names,base,head,files,mode)
    if mode=="preflight": return {"status":"PREFLIGHT_PASS","changed":0}
    source=head if mode=="activate" else base
    order=DEPLOY if mode=="activate" else ("index.html",*tuple(n for n in CHANGED if n!="index.html"),*NEW)
    changed=0
    for name in order:
        old=base[name];new=head[name]
        at=live/name
        value=checksum(read_regular(at)[0]) if at.exists() else None
        need(value in (old,) if mode=="activate" else value in (old,new),
             "UNKNOWN_LIVE_BEFORE_STEP_STOP")
        wanted=source[name]
        if value==wanted: continue
        if mode=="activate":
            content=read_regular(stage/name)[0]
            meta=files.get(name) if name not in NEW else None
        else:
            content=original.get(name)
            meta=files.get(name) if wanted is not None else None
        if change(live,name,wanted,content,meta,value):changed+=1
        if inject_after==changed: raise RuntimeError("INJECTED_TEST_INTERRUPTION")
    for name in names: require_file_state(live,name,source[name])
    return {"status":mode.upper()+"_PASS","changed":changed}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=("preflight","activate","rollback"))
    parser.add_argument("--live",required=True)
    parser.add_argument("--stage",default=".")
    parser.add_argument("--backup",required=True)
    parser.add_argument("--pins",required=True)
    parser.add_argument("--backup-manifest-sha256",required=True)
    args=parser.parse_args()
    try:
        print(json.dumps(transact(args.mode,args.live,args.stage,args.backup,
             args.pins,args.backup_manifest_sha256),sort_keys=True))
    except (ValueError,OSError,KeyError,TypeError,tarfile.TarError) as e:
        print("TRANSACTION=STOP "+str(e))
        raise SystemExit(1)

if __name__=="__main__":
    main()
