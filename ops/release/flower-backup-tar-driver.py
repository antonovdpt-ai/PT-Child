#!/usr/bin/env python3
"""Private full frontend tar snapshot, no sudo, stage, deploy or production mutation.

Injected by the CI source-pin generator: PIN_BASE, PIN_HEAD, RUN_NUMBER.
A tar stream preserves source uid/gid/mode/mtime as metadata. The archive
and its verified manifest remain on Timeweb, outside the web root.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile

ROOT=Path("/root/supabase-project/volumes/proxy/app")
CHUNK=1024*1024

def insist(condition, code):
    if not condition:
        raise ValueError(code)

def file_bytes(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        insist(stat.S_ISREG(before.st_mode) and before.st_size<=64*1024*1024,"UNSAFE_FILE_STOP")
        with os.fdopen(os.dup(fd),"rb") as source:
            data=source.read(64*1024*1024+1)
        insist(len(data)==before.st_size,"SOURCE_LENGTH_CHANGED_STOP")
        after=os.fstat(fd)
        insist((before.st_ino,before.st_size,before.st_mtime_ns)==
                (after.st_ino,after.st_size,after.st_mtime_ns),"SOURCE_CHANGED_STOP")
        return data,before
    finally:
        os.close(fd)

def take_inventory():
    insist(ROOT.is_dir() and not ROOT.is_symlink(),"ROOT_INVALID_STOP")
    folders={};files={};total=0
    candidates=[ROOT,*sorted(ROOT.rglob("*"))]
    insist(len(candidates)<=4096,"TOO_MANY_ENTRIES_STOP")
    for item in candidates:
        name="." if item==ROOT else item.relative_to(ROOT).as_posix()
        insist("\t" not in name and "\n" not in name and "\r" not in name and
               ".." not in name.split("/") and "\\" not in name,"BAD_ENTRY_NAME_STOP")
        info=item.lstat()
        meta={"mode":stat.S_IMODE(info.st_mode),"uid":info.st_uid,
              "gid":info.st_gid,"mtimeNs":info.st_mtime_ns}
        if stat.S_ISDIR(info.st_mode):
            folders[name]=meta
        elif stat.S_ISREG(info.st_mode):
            insist(info.st_size<=64*1024*1024,"TOO_BIG_FILE_STOP")
            data,check=file_bytes(item)
            insist((info.st_ino,info.st_size,info.st_mtime_ns)==
                    (check.st_ino,check.st_size,check.st_mtime_ns),
                    "SOURCE_RACE_STOP")
            total+=info.st_size
            insist(total<=1024*1024*1024,"TOTAL_TOO_LARGE_STOP")
            files[name]={**meta,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()}
        else:
            raise ValueError("UNSAFE_FILETYPE_STOP")
    return files,folders,total

def make_info(name,metadata,directory=False):
    header=tarfile.TarInfo(name)
    header.type=tarfile.DIRTYPE if directory else tarfile.REGTYPE
    header.mode=metadata["mode"]
    header.uid=metadata["uid"]
    header.gid=metadata["gid"]
    header.mtime=metadata["mtimeNs"]//1_000_000_000
    header.size=0 if directory else metadata["bytes"]
    return header

def verify_tar(path,files,folders):
    read_files=set();read_dirs=set()
    with tarfile.open(path,"r:gz") as archive:
        for member in archive:
            name=member.name.rstrip("/") or "."
            insist(not member.issym() and not member.islnk(),"LINK_ENTRY_STOP")
            if member.isdir():
                insist(name in folders and name not in read_dirs,"BAD_DIRECTORY_ENTRY_STOP")
                read_dirs.add(name)
                meta=folders[name]
            elif member.isfile():
                insist(name in files and name not in read_files,"BAD_FILE_ENTRY_STOP")
                read_files.add(name)
                meta=files[name]
                stream=archive.extractfile(member)
                insist(stream is not None,"TAR_STREAM_MISSING_STOP")
                digest=hashlib.sha256()
                size=0
                while True:
                    b=stream.read(CHUNK)
                    if not b: break
                    size+=len(b)
                    insist(size<=meta["bytes"],"TAR_MEMBER_EXCEEDS_SIZE_STOP")
                    digest.update(b)
                insist(size==meta["bytes"] and digest.hexdigest()==meta["sha256"],
                       "TAR_CONTENT_MISMATCH_STOP")
            else:
                raise ValueError("BAD_ARCHIVE_ENTRY_TYPE_STOP")
            insist(member.uid==meta["uid"] and member.gid==meta["gid"] and
                   member.mode==meta["mode"] and member.mtime==meta["mtimeNs"]//1_000_000_000,
                   "TAR_METADATA_MISMATCH_STOP")
    insist(read_files==set(files) and read_dirs==set(folders),"TAR_INCOMPLETE_STOP")

def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda:source.read(CHUNK),b""):
            h.update(chunk)
    return h.hexdigest()

def fsync(path):
    with path.open("rb") as f: os.fsync(f.fileno())

def snapshot():
    os.umask(0o077)
    insist(RUN_NUMBER.isdecimal() and 1<=len(RUN_NUMBER)<=30,"BAD_RUN_ID_STOP")
    names=list(PIN_HEAD)
    insist(len(names)==21 and names[-1]=="index.html"
           and set(PIN_BASE)==set(names),"SOURCE_PIN_LIST_STOP")
    insist(sum(value is None for value in PIN_BASE.values())==3,"NEW_ASSETS_STOP")

    files,folders,total=take_inventory()
    for name in names:
        digest=files.get(name,{}).get("sha256")
        insist(digest==PIN_BASE[name],"PRODUCTION_SOURCE_DRIFT_STOP")
    disk=os.statvfs(ROOT)
    available=disk.f_frsize*disk.f_bavail
    insist(available>=max(512*1024*1024,total*3+100*1024*1024),"LOW_BACKUP_DISK_STOP")

    private_parent=Path.home()/".cache"/"fizira-frontend-snapshots"
    insist(not ROOT.is_relative_to(private_parent) and
           not private_parent.is_relative_to(ROOT),"BACKUP_OVERLAP_STOP")
    insist(not private_parent.is_symlink(),"BACKUP_PARENT_LINK_STOP")
    if not private_parent.exists():
        private_parent.mkdir(parents=True,mode=0o700)
    insist(private_parent.is_dir() and
           stat.S_IMODE(private_parent.stat().st_mode)==0o700,
           "BACKUP_PARENT_PRIVACY_STOP")
    backup=private_parent/("flower-ui-"+RUN_NUMBER)
    insist(not backup.exists() and not backup.is_symlink(),"BACKUP_REUSE_STOP")
    backup.mkdir(mode=0o700)
    tar_path=backup/"frontend.tar.gz"
    with tarfile.open(tar_path,"w:gz",format=tarfile.PAX_FORMAT) as archive:
        for name,meta in sorted(folders.items()):
            archive.addfile(make_info(name,meta,directory=True))
        for name,meta in sorted(files.items()):
            data,now=file_bytes(ROOT/name)
            insist(hashlib.sha256(data).hexdigest()==meta["sha256"] and
                   stat.S_IMODE(now.st_mode)==meta["mode"] and
                   now.st_uid==meta["uid"] and now.st_gid==meta["gid"] and
                   now.st_mtime_ns==meta["mtimeNs"],
                   "SOURCE_CHANGED_WHILE_COPYING_STOP")
            archive.addfile(make_info(name,meta),io.BytesIO(data))
    fsync(tar_path)
    verify_tar(tar_path,files,folders)
    files_after,dirs_after,total_after=take_inventory()
    insist(files_after==files and dirs_after==folders and total_after==total,
           "LIVE_CHANGED_DURING_BACKUP_STOP")

    meta={"schemaVersion":2,"format":"private-tar-gzip",
          "source":str(ROOT),"files":files,"directoryMetadata":folders,
          "sourceRelease":"51e18c88377a7b20d06eef24b0db9fcb6d45fd3a",
          "intendedRelease":"ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"}
    (backup/"snapshot.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n")
    (backup/"before.tsv").write_text("".join(
        n+"\t"+files.get(n,{}).get("sha256","ABSENT")+"\n" for n in names))
    (backup/"release.tsv").write_text("".join(
        n+"\t"+PIN_HEAD[n]+"\n" for n in names))
    manifest=backup/"manifest.sha256"
    manifest.write_text("".join(sha(backup/n)+"  "+n+"\n" for n in
                    ("frontend.tar.gz","snapshot.json","before.tsv","release.tsv")))
    for n in ("frontend.tar.gz","snapshot.json","before.tsv","release.tsv","manifest.sha256"):
        fsync(backup/n)
    digest=sha(manifest)
    (backup/"complete").write_text(digest+"\n")
    fsync(backup/"complete")
    for folder in (backup,private_parent):
        fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    insist((backup/"complete").read_text()==sha(manifest)+"\n","BAD_COMPLETE_MARKER_STOP")
    verify_tar(tar_path,files,folders)
    for line in manifest.read_text().splitlines():
        value,n=line.split("  ",1)
        insist(value==sha(backup/n),"BAD_SNAPSHOT_MANIFEST_STOP")
    print("FRONTEND_BACKUP=PASS")
    print("SNAPSHOT_FORMAT=TAR_V2")
    print("BACKUP_PATH="+str(backup))
    print("BACKUP_FILES="+str(len(files)))
    print("BACKUP_DIRECTORIES="+str(len(folders)))
    print("BACKUP_TOTAL_SOURCE_BYTES="+str(total))
    print("MANIFEST_SHA256="+digest)
    print("PRODUCTION_SOURCE_UNCHANGED=YES")
    print("DATABASE_EDGE_STORAGE_UNTOUCHED=YES")
    print("RESTORE_NOT_TESTED=YES")

if __name__=="__main__":
    try:
        snapshot()
    except (OSError,ValueError,KeyError,TypeError,tarfile.TarError) as exc:
        reason=str(exc) if isinstance(exc,ValueError) and re.fullmatch(r"[A-Z_]+",str(exc)) else type(exc).__name__
        print("FRONTEND_BACKUP=STOP reason="+reason)
        raise SystemExit(1)
