#!/usr/bin/env python3
"""Copy the *current*, exact-hash-reviewed frontend into an owner-only tar archive.
Never writes to the frontend source or database; no restore or deploy operation.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile

SOURCE = Path('/root/supabase-project/volumes/proxy/app')
PREFIX = 'schedule-minutes-cab03ade'

def need(condition, label):
    if not condition:
        raise RuntimeError(label)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def scan(root):
    need(root.is_absolute() and root.is_dir() and not root.is_symlink(), 'SOURCE_DIRECTORY_STOP')
    result, files, total = [], {}, 0
    for here, dirs, names in os.walk(root, followlinks=False):
        dirs.sort()
        names.sort()
        for name in dirs + names:
            path = Path(here) / name
            rel = path.relative_to(root).as_posix()
            need(rel and not any(c in rel for c in '\n\r\t') and
                 all(p not in ('.', '..') for p in rel.split('/')), 'UNSAFE_NAME_STOP')
            st = os.lstat(path)
            need(stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode), 'UNSAFE_FILE_TYPE_STOP')
            item = {'name':rel,'type':'dir' if stat.S_ISDIR(st.st_mode) else 'file',
                    'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid,
                    'mtimeNs':st.st_mtime_ns}
            if item['type'] == 'file':
                need(st.st_size <= 64 * 1024 * 1024, 'FILE_SIZE_STOP')
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    before = os.fstat(fd)
                    h = hashlib.sha256()
                    while True:
                        block = os.read(fd, 65536)
                        if not block: break
                        h.update(block)
                    after = os.fstat(fd)
                    need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns) ==
                         (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) and
                         (before.st_dev,before.st_ino) == (st.st_dev,st.st_ino),
                         'SOURCE_RACE_STOP')
                    item['sha256'] = h.hexdigest()
                    item['bytes'] = st.st_size
                    total += st.st_size
                finally:
                    os.close(fd)
                files[rel] = item
            result.append(item)
            need(len(result) <= 4096 and total <= 1024**3, 'TREE_BOUNDS_STOP')
    return result, files, total

def approved(files, expected):
    need(type(expected) is dict and len(expected) == 21, 'EXPECTED_ASSETS_STOP')
    for name, sha in expected.items():
        need(re.fullmatch(r'[a-zA-Z0-9._-]+', name) and
             re.fullmatch(r'[a-f0-9]{64}', sha), 'INVALID_EXPECTED_ASSET_STOP')
        need(name in files and files[name]['sha256'] == sha, 'PRODUCTION_DRIFT_STOP')

def write_archive(root, entries, path):
    with tarfile.open(path, 'w', format=tarfile.PAX_FORMAT) as archive:
        for item in entries:
            info = tarfile.TarInfo(item['name'] + ('/' if item['type']=='dir' else ''))
            info.uid, info.gid, info.mode = item['uid'], item['gid'], item['mode']
            info.mtime = item['mtimeNs'] / 1e9
            if item['type'] == 'dir':
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
            else:
                fd = os.open(root / item['name'], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    before = os.fstat(fd)
                    need(stat.S_ISREG(before.st_mode) and before.st_size == item['bytes'] and
                         before.st_mtime_ns == item['mtimeNs'], 'CHANGED_WHILE_ARCHIVING_STOP')
                    info.size = item['bytes']
                    info.type = tarfile.REGTYPE
                    with os.fdopen(fd, 'rb', closefd=False) as stream:
                        archive.addfile(info, stream)
                    after = os.fstat(fd)
                    need((after.st_ino,after.st_size,after.st_mtime_ns) ==
                         (before.st_ino,before.st_size,before.st_mtime_ns),
                         'CHANGED_WHILE_ARCHIVING_STOP')
                finally:
                    os.close(fd)
    with path.open('rb') as f: os.fsync(f.fileno())

def verify_archive(path, expected):
    actual=[]
    with tarfile.open(path, 'r') as archive:
        for member in archive:
            need(member.isdir() or member.isfile(), 'UNSAFE_TAR_MEMBER_STOP')
            row={'name':member.name.rstrip('/'),
                 'type':'dir' if member.isdir() else 'file',
                 'mode':member.mode,'uid':member.uid,'gid':member.gid}
            if member.isfile():
                f = archive.extractfile(member)
                need(f is not None, 'ARCHIVE_READ_STOP')
                h=hashlib.sha256()
                size=0
                while True:
                    buf=f.read(65536)
                    if not buf: break
                    size+=len(buf)
                    h.update(buf)
                row['sha256']=h.hexdigest()
                row['bytes']=size
            actual.append(row)
    need(actual == [{k:v for k,v in entry.items() if k!='mtimeNs'}
                    for entry in expected], 'ARCHIVE_MISMATCH_STOP')

def sync(path):
    with path.open('rb') as f: os.fsync(f.fileno())

def main():
    need(len(sys.argv)==3 and re.fullmatch(r'\d{1,20}',sys.argv[1]) and
         re.fullmatch(r'\d{1,5}',sys.argv[2]), 'RUN_ID_STOP')
    value=os.environ.get('FIZIRA_EXPECTED_HASHES_B64','')
    need(0<len(value)<10000,'EXPECTED_HASHES_MISSING_STOP')
    expected=json.loads(base64.b64decode(value, validate=True))
    os.umask(0o077)
    before, files, nbytes=scan(SOURCE)
    approved(files, expected)
    target=Path.home()/'.cache'/'fizira-frontend'/'snapshots'
    free=os.statvfs(target.parent).f_bavail * os.statvfs(target.parent).f_frsize
    need(free>=2*nbytes+128*1024*1024, 'DISK_SPACE_STOP')
    target.mkdir(parents=True,mode=0o700,exist_ok=True)
    need(target.is_dir() and not target.is_symlink() and
         stat.S_IMODE(os.lstat(target).st_mode)==0o700, 'PRIVATE_DIRECTORY_STOP')
    folder=target/(PREFIX+'-run'+sys.argv[1]+'-try'+sys.argv[2])
    folder.mkdir(mode=0o700,exist_ok=False)
    need(stat.S_IMODE(os.lstat(folder).st_mode)==0o700, 'BACKUP_PERMISSIONS_STOP')
    tar=folder/'frontend.tar'
    write_archive(SOURCE,before,tar)
    after, newfiles, afterbytes=scan(SOURCE)
    need(after==before and afterbytes==nbytes, 'SOURCE_CHANGED_DURING_COPY_STOP')
    approved(newfiles,expected)
    verify_archive(tar,before)
    data={'schemaVersion':1,
          'candidate':'cab03ade946bc0789aba45327bfe89bef3b92cd9',
          'sourceBaseline':'15b9def8c6460af1d54980a3f0e78a660634a5c2',
          'tarSha256':digest(tar.read_bytes()),'sourceBytes':nbytes,'entries':before}
    manifest=folder/'manifest.json'
    manifest.write_text(json.dumps(data,sort_keys=True,ensure_ascii=False)+'\n',encoding='utf-8')
    sync(manifest)
    complete=folder/'complete'
    complete.write_text(digest(manifest.read_bytes())+'\n',encoding='ascii')
    sync(complete)
    need(complete.read_text().strip()==digest(manifest.read_bytes()),
         'INCOMPLETE_MARKER_STOP')
    verify_archive(tar,before)
    with os.scandir(folder) as listing:
        need(all(stat.S_IMODE(x.stat(follow_symlinks=False).st_mode)&0o077==0
                 for x in listing), 'PRIVATE_FILES_STOP')
    fd=os.open(folder, os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
    print('SOURCE_UNCHANGED_OK')
    print('BACKUP_CREATED_OK')
    print('BACKUP_VERIFIED_OK')
    print('BACKUP_MODE_0700_OK')
    print('BACKUP_RELATIVE_PATH='+str(folder.relative_to(Path.home())))
    print('BACKUP_SHA256='+data['tarSha256'])
    print('BACKUP_ENTRIES='+str(len(before)))
    print('BACKUP_BYTES='+str(nbytes))

if __name__=='__main__':
    try: main()
    except Exception as exc:
        reason=str(exc)
        print(reason if re.fullmatch(r'[A-Z_]+',reason) else 'BACKUP_FAILED_STOP')
        sys.exit(1)
