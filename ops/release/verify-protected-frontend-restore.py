#!/usr/bin/env python3
"""Restore drill in a throwaway private directory; never restore in production.

Reads a pinned, completed frontend tar+manifest. Validates tar members before
writing; only creates a unique 0700 directory below the snapshot directory.
Always cleans up drill output and keeps the original snapshot untouched.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tarfile
import tempfile

SNAPSHOT_NAME = 'schedule-minutes-cab03ade-run39058500668-try1'
EXPECTED_TAR_SHA256 = '331f5c026143fd7437cce7c4c024de62bd5114197712b643839b8e6fa74f4a03'
EXPECTED_BASE = '15b9def8c6460af1d54980a3f0e78a660634a5c2'
EXPECTED_CANDIDATE = 'cab03ade946bc0789aba45327bfe89bef3b92cd9'
EXPECTED_ITEMS = 121
EXPECTED_BYTES = 5880716

def require(condition, code):
    if not condition:
        raise ValueError(code)

def sha_file(path, max_size):
    st = os.lstat(path)
    require(stat.S_ISREG(st.st_mode) and st.st_size <= max_size, 'UNSAFE_SOURCE_FILE_STOP')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), 'UNSAFE_SOURCE_FILE_STOP')
        h = hashlib.sha256()
        while True:
            buf = os.read(fd, 65536)
            if not buf:
                break
            h.update(buf)
        after = os.fstat(fd)
        require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns) ==
                (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),
                'BACKUP_CHANGED_DURING_READ_STOP')
        return h.hexdigest()
    finally:
        os.close(fd)

def safe_snapshot():
    home = Path.home()
    snapshot = home / '.cache' / 'fizira-frontend' / 'snapshots' / SNAPSHOT_NAME
    for d in [home,home/'.cache',home/'.cache/fizira-frontend',
              snapshot.parent,snapshot]:
        st = os.lstat(d)
        require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode),
                'UNSAFE_SNAPSHOT_DIRECTORY_STOP')
    require(stat.S_IMODE(os.lstat(snapshot).st_mode) == 0o700 and
            os.lstat(snapshot).st_uid == os.geteuid(),
            'SNAPSHOT_PERMISSIONS_STOP')
    return snapshot

def member_name(name):
    name = name.rstrip('/')
    parts = PurePosixPath(name).parts
    require(bool(parts) and not name.startswith('/') and '\\' not in name and
            not any(c in name for c in '\x00\n\r\t') and
            all(p not in ('.','..','') for p in parts) and
            '/'.join(parts) == name and len(name) <= 1024,
            'ARCHIVE_PATH_STOP')
    return name,parts

def load_expected(snapshot):
    manifest = snapshot/'manifest.json'
    complete = snapshot/'complete'
    require(sha_file(complete, 1024) == sha_file(complete,1024), 'MARKER_CHANGED_STOP')
    with open(complete,'r',encoding='ascii') as f:
        marker = f.read()
    require(re.fullmatch(r'[a-f0-9]{64}\n',marker or '') is not None,
            'INVALID_COMPLETION_MARKER_STOP')
    require(sha_file(manifest, 1024*1024) == marker.strip(),
            'INCOMPLETE_BACKUP_STOP')
    with open(manifest,'r',encoding='utf-8') as f:
        data=json.load(f)
    require(data.get('schemaVersion')==1 and
            data.get('candidate')==EXPECTED_CANDIDATE and
            data.get('sourceBaseline')==EXPECTED_BASE and
            data.get('tarSha256')==EXPECTED_TAR_SHA256 and
            data.get('sourceBytes')==EXPECTED_BYTES,
            'UNREVIEWED_BACKUP_STOP')
    entries = data.get('entries')
    require(type(entries) is list and len(entries)==EXPECTED_ITEMS,
            'MANIFEST_ENTRIES_STOP')
    seen=set()
    dirs=set()
    total=0
    for e in entries:
        require(type(e) is dict, 'MANIFEST_TYPE_STOP')
        name,parts=member_name(e.get('name',''))
        require(name not in seen and e.get('type') in ('file','dir') and
                type(e.get('mode')) is int and 0 <= e['mode'] <= 0o7777 and
                type(e.get('uid')) is int and type(e.get('gid')) is int,
                'MANIFEST_ENTRY_STOP')
        seen.add(name)
        if e['type']=='dir':
            dirs.add(name)
        else:
            require(type(e.get('bytes')) is int and 0 <= e['bytes']<=64*1024*1024 and
                    re.fullmatch('[a-f0-9]{64}',e.get('sha256','')) is not None,
                    'MANIFEST_HASH_STOP')
            total += e['bytes']
        for pos in range(1,len(parts)):
            require('/'.join(parts[:pos]) in dirs or
                    any(d.get('name') == '/'.join(parts[:pos]) and d.get('type')=='dir'
                        for d in entries), 'MISSING_PARENT_DIRECTORY_STOP')
    require(total==EXPECTED_BYTES, 'MANIFEST_SIZE_STOP')
    return data

def validate_tar(tar_path, entries):
    with tarfile.open(tar_path,'r:') as tar:
        members=tar.getmembers()
        require(len(members)==len(entries), 'ARCHIVE_MEMBER_COUNT_STOP')
        for member, item in zip(members,entries):
            name,_=member_name(member.name)
            require(name==item['name'] and
                    ((member.isdir() and item['type']=='dir') or
                     (member.isfile() and item['type']=='file')) and
                    member.mode==item['mode'] and
                    member.uid==item['uid'] and member.gid==item['gid'],
                    'ARCHIVE_METADATA_STOP')
            if member.isfile():
                require(member.size==item['bytes'], 'ARCHIVE_SIZE_STOP')

def restore_and_check(tar_path, expected, sandbox):
    entries=expected['entries']
    recorded=[]
    with tarfile.open(tar_path,'r:') as archive:
        for member, item in zip(archive.getmembers(),entries):
            name,parts=member_name(member.name)
            path=sandbox.joinpath(*parts)
            if item['type']=='dir':
                os.mkdir(path,0o700)
            else:
                require(path.parent.is_dir() and not path.parent.is_symlink(),
                        'RESTORE_PARENT_STOP')
                source=archive.extractfile(member)
                require(source is not None,'RESTORE_SOURCE_STOP')
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                try:
                    h=hashlib.sha256()
                    size=0
                    while True:
                        chunk=source.read(65536)
                        if not chunk: break
                        size+=len(chunk)
                        require(size<=item['bytes'], 'RESTORE_OVERFLOW_STOP')
                        h.update(chunk)
                        data=memoryview(chunk)
                        while data:
                            data=data[os.write(fd,data):]
                    require(size==item['bytes'] and h.hexdigest()==item['sha256'],
                            'RESTORE_CONTENT_STOP')
                    os.fchmod(fd,item['mode'])
                finally:
                    os.close(fd)
            recorded.append(name)
    for item in reversed(entries):
        if item['type']=='dir':
            os.chmod(sandbox/item['name'],item['mode'],follow_symlinks=False)
    actual=[]
    total=0
    for here, dirs, files in os.walk(sandbox,followlinks=False):
        for name in dirs+files:
            path=Path(here)/name
            relative=path.relative_to(sandbox).as_posix()
            st=os.lstat(path)
            require(not stat.S_ISLNK(st.st_mode), 'RESTORED_SYMLINK_STOP')
            actual.append(relative)
            require(relative in recorded, 'UNEXPECTED_RESTORED_FILE_STOP')
    require(set(actual)==set(recorded) and len(actual)==len(recorded),
            'RESTORED_TREE_MISMATCH_STOP')
    for item in entries:
        path=sandbox/item['name']
        st=os.lstat(path)
        require(stat.S_IMODE(st.st_mode)==item['mode'], 'RESTORED_MODE_STOP')
        if item['type']=='file':
            require(stat.S_ISREG(st.st_mode) and
                    st.st_size==item['bytes'] and
                    sha_file(path,64*1024*1024)==item['sha256'],
                    'RESTORED_HASH_STOP')
            total+=st.st_size
        else:
            require(stat.S_ISDIR(st.st_mode),'RESTORED_DIRECTORY_STOP')
    require(total==EXPECTED_BYTES,'RESTORED_BYTES_STOP')
    return len(entries),total

def main():
    snapshot=safe_snapshot()
    expected=load_expected(snapshot)
    tar=snapshot/'frontend.tar'
    require(sha_file(tar,32*1024*1024)==EXPECTED_TAR_SHA256,
            'ARCHIVE_CHECKSUM_STOP')
    validate_tar(tar,expected['entries'])
    baseline_marker=sha_file(snapshot/'complete',1024)
    # The private restoration directory is a separate sibling of the immutable
    # snapshot. TemporaryDirectory owns and removes ONLY this new drill directory.
    with tempfile.TemporaryDirectory(prefix='restore-drill-',dir=snapshot.parent) as temp:
        sandbox=Path(temp)
        require(sandbox.parent==snapshot.parent and
                sandbox.name.startswith('restore-drill-') and
                stat.S_IMODE(os.lstat(sandbox).st_mode)==0o700,
                'DRILL_ISOLATION_STOP')
        count,total=restore_and_check(tar,expected,sandbox)
        print('RESTORE_ISOLATED_OK')
        print('RESTORE_ENTRIES='+str(count))
        print('RESTORE_BYTES='+str(total))
        print('RESTORED_HASHES_OK')
        print('RESTORED_MODES_OK')
        # The archive is checked again while the drill directory still exists.
        require(sha_file(tar,32*1024*1024)==EXPECTED_TAR_SHA256,
                'BACKUP_ALTERED_STOP')
    require(sha_file(snapshot/'complete',1024)==baseline_marker and
            sha_file(tar,32*1024*1024)==EXPECTED_TAR_SHA256,
            'BACKUP_POST_DRILL_CHANGED_STOP')
    print('DRILL_DIRECTORY_REMOVED_OK')
    print('ORIGINAL_BACKUP_UNCHANGED_OK')
    print('LIVE_APPLICATION_UNTOUCHED_OK')

if __name__=='__main__':
    try: main()
    except Exception as exc:
        reason=str(exc)
        print(reason if re.fullmatch('[A-Z_]+',reason) else 'RESTORE_DRILL_FAILED_STOP')
        sys.exit(1)
