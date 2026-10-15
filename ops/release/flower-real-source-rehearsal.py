#!/usr/bin/env python3
"""Dry-run nine-asset publish/rollback using actual immutable Git blob bytes.

Only makes temporary local files on the GitHub runner. No SSH, no production
tokens, no app users, no supabase, no DNS, and no staging server.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location("flower_txn",HERE/"flower-frontend-transaction.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

BASE=module.BASE_COMMIT
HEAD=module.RELEASE_COMMIT

def git(*args):
    result=subprocess.run(["git",*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError("GIT_SOURCE_UNAVAILABLE_STOP")
    return result.stdout

def digest(data):return hashlib.sha256(data).hexdigest()

def header(name,meta,directory=False):
    t=tarfile.TarInfo(name)
    t.type=tarfile.DIRTYPE if directory else tarfile.REGTYPE
    t.mode=meta["mode"];t.uid=meta["uid"];t.gid=meta["gid"]
    t.mtime=meta["mtimeNs"]//1000000000
    t.size=0 if directory else meta["bytes"]
    return t

def compare(live,assets,expected):
    for name in assets:
        p=live/name
        if expected[name] is None:
            assert not p.exists() and not p.is_symlink(),name
        else:
            assert digest(p.read_bytes())==expected[name],name

def main():
    assert os.environ.get("GITHUB_ACTIONS")=="true"
    names=git("show",HEAD+":ops/release/frontend-assets.txt").decode().splitlines()
    assert len(names)==21 and len(set(names))==21 and names[-1]=="index.html"
    base={};head={};blobbase={};blobhead={}
    for name in names:
        result=subprocess.run(["git","cat-file","-e",BASE+":"+name],
                              stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        blobbase[name]=git("show",BASE+":"+name) if result.returncode==0 else None
        blobhead[name]=git("show",HEAD+":"+name)
        base[name]=digest(blobbase[name]) if blobbase[name] is not None else None
        head[name]=digest(blobhead[name])
    assert {n for n in names if base[n]!=head[n]}==set(module.DEPLOY)
    assert {n for n in names if base[n] is None}==set(module.NEW)

    with tempfile.TemporaryDirectory(prefix="flower-real-blob-") as temporary:
        root=Path(temporary)
        live=root/"live";stage=root/"stage";backup=root/"backup"
        live.mkdir();stage.mkdir();backup.mkdir(mode=0o700)
        for name in names:
            if blobbase[name] is not None:
                (live/name).write_bytes(blobbase[name])
                (live/name).chmod(0o644)
            if name in module.DEPLOY:
                (stage/name).write_bytes(blobhead[name])
        (live/"legacy-extra").mkdir()
        (live/"legacy-extra"/"keep.txt").write_text("not part of published allowlist")
        before_inodes={n:(live/n).stat().st_ino for n in names if n not in module.DEPLOY}
        pins=root/"pins.json"
        pins.write_text(json.dumps({"assets":names,"base":base,"head":head}))
        files={};dirs={}
        for path in [live,*sorted(live.rglob("*"))]:
            name="." if path==live else path.relative_to(live).as_posix()
            info=path.lstat()
            desc={"mode":stat.S_IMODE(info.st_mode),"uid":info.st_uid,
                  "gid":info.st_gid,"mtimeNs":info.st_mtime_ns}
            if path.is_dir():dirs[name]=desc
            else:
                data=path.read_bytes()
                files[name]={**desc,"bytes":len(data),"sha256":digest(data)}
        with tarfile.open(backup/"frontend.tar.gz","w:gz",format=tarfile.PAX_FORMAT) as tar:
            for name,meta in sorted(dirs.items()):
                tar.addfile(header(name,meta,True))
            for name,meta in sorted(files.items()):
                tar.addfile(header(name,meta),io.BytesIO((live/name).read_bytes()))
        archive_meta={"schemaVersion":2,"format":"private-tar-gzip",
                      "files":files,"directoryMetadata":dirs,"sourceRelease":BASE,
                      "intendedRelease":HEAD}
        (backup/"snapshot.json").write_text(json.dumps(archive_meta))
        (backup/"before.tsv").write_text("".join(
            n+"\t"+(base[n] or "ABSENT")+"\n" for n in names))
        (backup/"release.tsv").write_text("".join(
            n+"\t"+head[n]+"\n" for n in names))
        members=("frontend.tar.gz","snapshot.json","before.tsv","release.tsv")
        lines="".join(digest((backup/n).read_bytes())+"  "+n+"\n" for n in members)
        (backup/"manifest.sha256").write_text(lines)
        manifest_sha=digest(lines.encode())
        (backup/"complete").write_text(manifest_sha+"\n")
        def transact(mode,interrupt=None):
            return module.transact(mode,live,stage,backup,pins,manifest_sha,
                                   inject_after=interrupt)
        assert transact("preflight")=={"status":"PREFLIGHT_PASS","changed":0}
        compare(live,names,base)
        assert transact("activate")=={"status":"ACTIVATE_PASS","changed":9}
        compare(live,names,head)
        assert (live/"legacy-extra"/"keep.txt").read_text()=="not part of published allowlist"
        for n,ino in before_inodes.items():
            assert (live/n).stat().st_ino==ino,"unchanged asset inode replaced"
        assert transact("rollback")=={"status":"ROLLBACK_PASS","changed":9}
        compare(live,names,base)
        try:
            transact("activate",interrupt=4)
            raise AssertionError("interrupted activation was not simulated")
        except RuntimeError as e:
            assert "INJECTED_TEST_INTERRUPTION" in str(e)
        assert transact("rollback")=={"status":"ROLLBACK_PASS","changed":4}
        compare(live,names,base)
        assert transact("activate")=={"status":"ACTIVATE_PASS","changed":9}
        try:
            transact("rollback",interrupt=3)
            raise AssertionError("interrupted rollback was not simulated")
        except RuntimeError as e:
            assert "INJECTED_TEST_INTERRUPTION" in str(e)
        assert transact("rollback")=={"status":"ROLLBACK_PASS","changed":6}
        compare(live,names,base)
        print("FLOWER_REAL_GIT_BLOBS=VERIFIED")
        print("FRONTEND_MANIFEST_ITEMS=21")
        print("DELTA_FILES=9")
        print("REAL_BYTES_ACTIVATE=PASS")
        print("REAL_BYTES_ROLLBACK=PASS")
        print("INTERRUPTED_ACTIVATION_RECOVERY=PASS")
        print("INTERRUPTED_ROLLBACK_RECOVERY=PASS")
        print("UNCHANGED_ASSETS_INODES=PASS")
        print("PRODUCTION_CONNECTIONS=NONE")

if __name__=="__main__":
    main()
