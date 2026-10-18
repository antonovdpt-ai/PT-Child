#!/usr/bin/env python3
"""Read-only production audit for the exact PR #36 specialist frontend release.
No subprocesses, production writes, database reads or Docker operations.
Only fixed frontend and Edge source bytes and old protected archive metadata.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

SOURCE_BASE = '15b9def8c6460af1d54980a3f0e78a660634a5c2'
PR36 = 'd19fe0ce21fe18c1f3003ebe33af65b8870178fb'
BACKUP_HASH = '331f5c026143fd7437cce7c4c024de62bd5114197712b643839b8e6fa74f4a03'
BACKUP_NAME = 'schedule-minutes-cab03ade-run39058500668-try1'
FRONTEND = Path('/root/supabase-project/volumes/proxy/app')
EDGE = Path('/root/supabase-project/volumes/functions')
CLI_CONFIG = Path('/root/supabase-project/supabase/config.toml')

def demand(condition,label):
    if not condition: raise ValueError(label)

def sha(path,max_size):
    path=Path(path)
    demand(path.is_absolute(),'PATH_ABSOLUTE_STOP')
    for part in (path,*path.parents):
        demand(not part.is_symlink(),'SYMLINK_STOP')
    st=os.lstat(path)
    demand(stat.S_ISREG(st.st_mode) and st.st_size<=max_size,'FILE_TYPE_SIZE_STOP')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        demand(stat.S_ISREG(before.st_mode),'UNSAFE_FILE_STOP')
        h=hashlib.sha256()
        size=0
        while True:
            block=os.read(fd,65536)
            if not block: break
            size+=len(block)
            demand(size<=max_size,'READ_LIMIT_STOP')
            h.update(block)
        after=os.fstat(fd)
        demand((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==
               (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),
               'FILE_RACE_STOP')
        return h.hexdigest()
    finally: os.close(fd)

def check():
    encoded=os.environ.get('FIZIRA_EXPECTED_BASE_HASHES_B64','')
    demand(0<len(encoded)<12000,'HASH_PAYLOAD_STOP')
    expected=json.loads(base64.b64decode(encoded,validate=True))
    demand(type(expected)==dict and expected.get('base')==SOURCE_BASE and
           expected.get('head')==PR36,'REVIEWED_SHA_STOP')
    f=expected.get('frontend')
    e=expected.get('edge')
    demand(type(f)==dict and len(f)==21 and type(e)==dict and len(e)==13,'ASSET_COUNT_STOP')
    for typ,entries in [('frontend',f),('edge',e)]:
        for name,hashvalue in entries.items():
            demand(type(name)==str and type(hashvalue)==str and
                   re.fullmatch('[a-f0-9]{64}',hashvalue) is not None and
                   all(part not in ('','.','..') for part in name.split('/')) and
                   re.fullmatch('[A-Za-z0-9._/-]+',name) is not None,
                   'INVALID_ASSET_NAME_STOP')
            if typ=='frontend':
                demand('/' not in name,'INVALID_FRONTEND_NAME_STOP')
                actual=FRONTEND/name
            else:
                demand(name.startswith('functions/'),'INVALID_EDGE_NAME_STOP')
                actual=EDGE/name.removeprefix('functions/')
            demand(sha(actual,64*1024*1024)==hashvalue,
                   'UNEXPECTED_PRODUCTION_DRIFT_STOP')
    print('PRODUCTION_SOURCE_MATCHES_BASE_OK')
    print('FRONTEND_HASHES_MATCHED=21')
    print('EDGE_HASHES_MATCHED=13')
    demand(not CLI_CONFIG.exists() and not CLI_CONFIG.is_symlink(),
           'CLI_CONFIG_UNEXPECTED_STOP')
    print('CLI_CONFIG_ABSENT_AS_PREVIOUSLY_REVIEWED_OK')
    path=(Path.home()/'.cache'/'fizira-frontend'/'snapshots'/BACKUP_NAME)
    demand(path.is_dir() and not path.is_symlink() and
           stat.S_IMODE(os.lstat(path).st_mode)==0o700 and
           os.lstat(path).st_uid==os.geteuid(),
           'BACKUP_NOT_PRIVATE_STOP')
    manifest=path/'manifest.json'
    complete=path/'complete'
    archive=path/'frontend.tar'
    with open(manifest,'rb') as stream:
        data=json.load(stream)
    demand(data.get('schemaVersion')==1 and
           data.get('sourceBaseline')==SOURCE_BASE and
           data.get('tarSha256')==BACKUP_HASH and
           data.get('sourceBytes')==5880716 and
           len(data.get('entries',[]))==121,
           'BACKUP_MANIFEST_STOP')
    demand(sha(manifest,1024*1024)==complete.read_text(encoding='ascii').strip(),
           'BACKUP_INCOMPLETE_STOP')
    demand(sha(archive,32*1024*1024)==BACKUP_HASH,'BACKUP_HASH_STOP')
    print('EXISTING_PROTECTED_BACKUP_VALID_OK')
    print('PREACTIVATION_READONLY_GATE_OK')

if __name__=='__main__':
    try: check()
    except Exception as e:
        msg=str(e)
        print(msg if isinstance(e,ValueError) and re.fullmatch('[A-Z_]+',msg) else 'SOURCE_AUDIT_UNAVAILABLE_STOP')
        sys.exit(1)
