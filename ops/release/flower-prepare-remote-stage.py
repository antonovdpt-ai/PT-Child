#!/usr/bin/env python3
"""Validate an immutable Flower TAR package and extract into a private staging folder.

NEVER runs transaction.activate/rollback. No writes in the served web root.
Operates as the SSH user without sudo. The expected outer SHA must come from
the verified CI-side package builder, not from inside the archive.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile

RELEASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
BASE="51e18c88377a7b20d06eef24b0db9fcb6d45fd3a"
NEW={"patient-flower.css","patient-flower.mjs","patient-overview.mjs"}
DELTA={"app.js","cabinet.js","schedule-editor.js","parent-specialist.js",
       "parent.html","index.html",*NEW}
MAX_BYTES=128*1024*1024

def check(ok,code):
    if not ok:raise ValueError(code)

def sha(data):return hashlib.sha256(data).hexdigest()

def stage_package(package,expected_digest,destination):
    os.umask(0o077)
    package=Path(package).absolute()
    dest=Path(destination).absolute()
    home=Path.home()
    private_root=home/".cache"/"fizira-frontend-deploy"
    # Stage roots intentionally must live outside any served app paths.
    check(dest.parent==private_root and dest.name.startswith("flower-") and
          re.fullmatch(r"flower-[0-9]{1,30}",dest.name) is not None,
          "BAD_DESTINATION_STOP")
    for p in [home,home/".cache",private_root,package.parent]:
        check(p.is_dir() and not p.is_symlink(),"PATH_SYMLINK_STOP")
    check(package.parent==private_root, "UNEXPECTED_PACKAGE_LOCATION_STOP")
    check(package.name==dest.name+".tar.gz", "UNEXPECTED_PACKAGE_NAME_STOP")
    check(not package.is_symlink() and package.is_file()
          and package.stat().st_size<=MAX_BYTES,
          "BAD_PACKAGE_FILE_STOP")
    check(re.fullmatch("[a-f0-9]{64}",expected_digest) is not None,
          "EXPECTED_DIGEST_INVALID_STOP")
    h=hashlib.sha256()
    with package.open("rb") as stream:
        for buf in iter(lambda:stream.read(1024*1024),b""):h.update(buf)
    check(h.hexdigest()==expected_digest,"PACKAGE_HASH_STOP")

    items={};count=0;total=0
    with tarfile.open(package,mode="r:gz") as t:
        for m in t:
            count+=1
            check(count<=13 and m.isfile() and not m.issym()
                  and not m.islnk() and not m.name.startswith("/")
                  and "\\" not in m.name and
                  all(x not in (".","..","") for x in m.name.split("/")),
                  "UNSAFE_PACKAGE_MEMBER_STOP")
            check(m.name not in items,"DUPLICATE_PACKAGE_MEMBER_STOP")
            check(m.size<=16*1024*1024,"PACKAGE_MEMBER_TOO_BIG_STOP")
            total+=m.size
            check(total<=MAX_BYTES,"PACKAGE_TOO_LARGE_STOP")
            inp=t.extractfile(m)
            check(inp is not None,"PACKAGE_MEMBER_READ_STOP")
            data=inp.read(m.size+1)
            check(len(data)==m.size,"PACKAGE_MEMBER_LENGTH_STOP")
            items[m.name]=data
    expected_set={"MANIFEST.sha256","pins.json","transaction.py"}|{"stage/"+x for x in DELTA}
    check(set(items)==expected_set,"PACKAGE_UNEXPECTED_MEMBER_STOP")
    manifest=items["MANIFEST.sha256"].decode("ascii")
    expected_names=["pins.json","transaction.py"]+["stage/"+x for x in
                    ("patient-flower.css","patient-flower.mjs","patient-overview.mjs",
                     "cabinet.js","schedule-editor.js","parent-specialist.js",
                     "parent.html","app.js","index.html")]
    check(manifest=="".join(sha(items[n])+"  "+n+"\n" for n in expected_names),
          "PACKAGE_MANIFEST_STOP")
    pins=json.loads(items["pins.json"])
    check(set(pins)=={"assets","base","head"}
          and isinstance(pins["assets"],list) and len(pins["assets"])==21
          and len(set(pins["assets"]))==21 and pins["assets"][-1]=="index.html",
          "SOURCE_PINS_STOP")
    base,head=pins["base"],pins["head"]
    check(set(pins["assets"])==set(base)==set(head)
          and {x for x in pins["assets"] if base[x]!=head[x]}==DELTA
          and {x for x in pins["assets"] if base[x] is None}==NEW,
          "PINNED_DELTA_STOP")
    check(all(re.fullmatch("[a-f0-9]{64}",value) for value in head.values()),
          "HEAD_HASH_FORMAT_STOP")
    for n in DELTA:
        check(sha(items["stage/"+n])==head[n],"PINNED_STAGE_HASH_STOP")
    check(b"PRODUCTION_APPROVAL_REQUIRED_STOP" in items["transaction.py"]
          and RELEASE.encode() in items["transaction.py"]
          and BASE.encode() in items["transaction.py"],"TRANSACTION_SOURCE_STOP")
    # Caller can optionally pin exact SHA-256 of the helper against Git.
    # An unpinned transaction script must NEVER be trusted as production code.
    check(not dest.exists() and not dest.is_symlink(),
          "STAGE_EXISTS_STOP")
    dest.mkdir(mode=0o700)
    check(stat.S_IMODE(dest.stat().st_mode)==0o700,"STAGE_PRIVATE_STOP")
    (dest/"stage").mkdir(mode=0o700)
    for n in ["MANIFEST.sha256","pins.json","transaction.py"]:
        p=dest/n
        fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"wb") as stream:stream.write(items[n])
    for n in DELTA:
        fd=os.open(dest/"stage"/n,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"wb") as stream:stream.write(items["stage/"+n])
    for n in DELTA:
        check(sha((dest/"stage"/n).read_bytes())==head[n],"POST_EXTRACT_HASH_STOP")
    print("FLOWER_STAGE=PASS")
    print("STAGED_FILES=9")
    print("STAGE_PUBLIC_WRITES=NO")
    print("SOURCE_BASE="+BASE)
    print("SOURCE_RELEASE="+RELEASE)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--package",required=True)
    p.add_argument("--expected-sha256",required=True)
    p.add_argument("--destination",required=True)
    a=p.parse_args()
    try:
        stage_package(a.package,a.expected_sha256,a.destination)
    except (ValueError,KeyError,TypeError,OSError,tarfile.TarError):
        print("FLOWER_STAGE=STOP")
        raise SystemExit(1)

if __name__=="__main__":main()
