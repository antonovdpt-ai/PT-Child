#!/usr/bin/env python3
"""Operator-approved PR36 frontend-only activation from an already staged release.

Must be launched manually as root in the Timeweb console. Everything verified
against immutable Git blob SHA-1s before any live write. Never reads patient
records or changes Auth, SQL, Docker, Edge, or other products.
"""
import hashlib
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

BASE='15b9def8c6460af1d54980a3f0e78a660634a5c2'
HEAD='d19fe0ce21fe18c1f3003ebe33af65b8870178fb'
LIVE=Path('/root/supabase-project/volumes/proxy/app')
EDGE=Path('/root/supabase-project/volumes/functions')
CFG=Path('/root/supabase-project/supabase/config.toml')
STAGING_ID='pr36-39152537485-1'
# Filename, exact previously audited production git-blob SHA-1, exact PR36 blob SHA-1.
ASSET_TEXT="""app.js 2250649b39cef060b7cf84b190cc864f094419d7 993f96f4d17348ac1debfcac68d2c5968417e2c2
cabinet.js e1b46f50d03bae5c497b4268f6230cce83231d8a 00d08efab6c39b1b87586f17b452b33a88675317
styles.css b8db952feea673dcc840430d6d4d688f44bc9ac2 88f2dc6b88b88e215080bf612edbc12c09139d59
patient-flower.css 28371d13895e1e5f2c1f6e751859ed6fab3a899d 28371d13895e1e5f2c1f6e751859ed6fab3a899d
patient-flower.mjs 5fd023baa415541890be27c583a9ada8cfb41ea0 5fd023baa415541890be27c583a9ada8cfb41ea0
patient-overview.mjs 4bc7155f7e4374a9dcdcb8313fffc78ec7a58f3d 4bc7155f7e4374a9dcdcb8313fffc78ec7a58f3d
media-fallback.css a79ce64510b028ae488c7cedbc351d04d9002773 a79ce64510b028ae488c7cedbc351d04d9002773
auth-domain.mjs af328fa8ae479fe5bef67532b39d4a948e467d4a af328fa8ae479fe5bef67532b39d4a948e467d4a
schedule-domain.mjs de8fc9e4c6161cbdcfa440ecf91650060ff18cd7 6e1c5f4aa6a2f24ef642375a36e780180e54cb28
schedule-editor.js 9d8b3a4fea285f315b59a5e02c9df807aeb60a0c 1ed808874274f99604ec1be395b30d969d99d6ca
security-utils.mjs a79559deb980a340916e1605f4515461dab5b181 a79559deb980a340916e1605f4515461dab5b181
role-gate.mjs eab0c3e5afc4ebdf064561304bdb7b6b505887f4 eab0c3e5afc4ebdf064561304bdb7b6b505887f4
parent.html aa8e2c4952fa704cdecc1e7a00b44624ee993624 aa8e2c4952fa704cdecc1e7a00b44624ee993624
parent.js 6c6f7af4ce1581fba24b15a6846edd0c66c83b2d 6c6f7af4ce1581fba24b15a6846edd0c66c83b2d
parent.css a44f6e1d3c22cd9a3becb18304a08932e485feda a44f6e1d3c22cd9a3becb18304a08932e485feda
parent-domain.mjs a7a3111cd05b98ef8a872c7c74ee5e80b98b1988 a7a3111cd05b98ef8a872c7c74ee5e80b98b1988
parent-specialist.js 35b44bfd6ab45314a8afa2df8993ed0a89b6a0b8 35b44bfd6ab45314a8afa2df8993ed0a89b6a0b8
report-pdf-export.mjs d7f07a9daa8d5d2e8388447c7b9163b3cbe203cf d7f07a9daa8d5d2e8388447c7b9163b3cbe203cf
favicon.ico cbf0ddaab764c10eef2a58831741f82dfcb4229b cbf0ddaab764c10eef2a58831741f82dfcb4229b
fizira-symbol.png 4efc94d53c3dbcc61c19419dd831c450e0e56703 4efc94d53c3dbcc61c19419dd831c450e0e56703
index.html 81b3b62fa34b28b1c80e6052f6dd4affce741170 1642db3b97293126b65067dd031063ff98901547"""
# The existing, already isolated-tested official snapshot/rollback implementation.
TOOL_BLOBS={
    'activate-frontend.sh':'83e8ef3e440e9961832f6cd8656baf52f205a821',
    'frontend-snapshot.py':'c6cf10b7efa2b7fbccbaaf636bcc36105bccd6de',
    'frontend-assets.txt':'f8f34b2d6bce17624541c3f5f38a9ce28522dc6f',
}
EDGE_BLOBS="""functions/_shared/ai-helpers.ts 9e860e432468f641bfcfd0fccee118c58465a034
functions/ptchild-ai/index.ts c0c4392fdca8cfd96b4aef17be39d73d8083d7f4
functions/create-parent-invitation/index.ts 65c18dfbec6adcef01a5f37270cb0fb6c53f9e21
functions/resend-parent-invitation/index.ts aadb58d49fdae21488ccff0d67b47abcd24310bd
functions/revoke-parent-access/index.ts 3eb834d4ad43cd55e432baf30a948f6b87d79988
functions/generate-parent-report-pdf/index.ts b7584f61e77dc2ce772d21b7712ecd33bc6389e1
functions/parent-report-file/index.ts c1778885787b7c351d76d417a45c0cc9c13b10cc
functions/_shared/parent-portal.ts 8a8a3bf592ae4ed9832330bac82def23f7ec6497
functions/_shared/parent-publication.ts a69bf9b1a85984ecef45ebe540a14c08497e8f27
functions/_shared/parent-pdf.ts 477e0908959687625d9c6e60a0a3eb5ae77195f6
functions/_shared/font-data.ts 4f1feb32206fa007940d615ad423e18f43cd7a99
functions/_shared/fonts/NotoSans-Regular.ttf 5de3fa7da539d71d507557eda1396af86be15a9f
functions/_shared/fonts/OFL.txt 166f361a58babaa17d036ed4e468dacc98f4f6ef"""

def require(condition,label):
    if not condition:
        raise RuntimeError(label)

def read_file(path):
    p=Path(path)
    require(p.is_absolute(),'ABSOLUTE_PATH_STOP')
    for part in (p,*p.parents):
        require(not part.is_symlink(),'SYMLINK_STOP')
    old=os.lstat(p)
    require(stat.S_ISREG(old.st_mode) and old.st_size<=64*1024*1024,'SOURCE_FILE_INVALID_STOP')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        chunks=[]
        size=0
        while True:
            data=os.read(fd,65536)
            if not data: break
            size+=len(data)
            require(size<=64*1024*1024,'FILE_READ_LIMIT_STOP')
            chunks.append(data)
        after=os.fstat(fd)
        require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==
                (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),
                'FILE_MODIFIED_DURING_READ_STOP')
        return b''.join(chunks),before
    finally:
        os.close(fd)

def blob(data):
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()

def check_file(path, expected):
    data,st=read_file(path)
    require(blob(data)==expected,'UNREVIEWED_SOURCE_BYTES_STOP')
    return data,st

ASSETS={x.split()[0]:(x.split()[1],x.split()[2]) for x in ASSET_TEXT.splitlines()}
EDGES={x.split()[0]:x.split()[1] for x in EDGE_BLOBS.splitlines()}

def verify_live(expected_index):
    for filename,hashes in ASSETS.items():
        check_file(LIVE/filename,hashes[expected_index])
    print('LIVE_'+('ORIGINAL' if expected_index==0 else 'PR36')+'_21_HASHES_OK',flush=True)

def verify_edge():
    for name,expected in EDGES.items():
        check_file(EDGE/name.removeprefix('functions/'),expected)
    require(not CFG.exists() and not CFG.is_symlink(),'UNREVIEWED_EDGE_CLI_CONFIG_STOP')
    print('EDGE_13_UNCHANGED_OK',flush=True)

def run(argv):
    return subprocess.run(argv,check=True,timeout=180)

def verify_public():
    for filename,hashes in ASSETS.items():
        url='https://app.fizira.com/'+filename+'?release='+HEAD+'&operator=pr36'
        passed=False
        for attempt in range(3):
            try:
                req=urllib.request.Request(url,headers={
                    'Cache-Control':'no-cache','Accept-Encoding':'identity',
                    'User-Agent':'Fizira-reviewed-release-verification/1.0'})
                with urllib.request.urlopen(req,timeout=20) as response:
                    require(response.status==200,'PUBLIC_HTTP_STATUS_STOP')
                    body=response.read(64*1024*1024+1)
                require(len(body)<=64*1024*1024,'PUBLIC_RESPONSE_SIZE_STOP')
                if blob(body)==hashes[1]:
                    passed=True
                    break
            except Exception:
                pass
            time.sleep(2)
        require(passed,'PUBLIC_ASSET_DIVERGENCE_STOP')
    print('PUBLIC_HTTPS_21_FILES_MATCH_PR36_OK',flush=True)

def main():
    require(os.geteuid()==0,'ROOT_REQUIRED_STOP')
    require(len(ASSETS)==21 and len(EDGES)==13,'MANIFEST_INVALID_STOP')
    passwd=pwd.getpwnam('ftransfer')
    source=Path(passwd.pw_dir)/'.cache'/'fizira-frontend'/'releases'/STAGING_ID
    srcstage=source/'stage'
    srctools=source/'tools'/'ops'/'release'
    require(source.is_dir() and srcstage.is_dir() and srctools.is_dir(),
            'STAGED_RELEASE_MISSING_STOP')
    # Validates the original state, all unchanged server-side files, and every
    # staged byte independently of the SSH user's writable hash manifest.
    verify_live(0)
    verify_edge()
    planned={}
    originals={}
    for filename,hashes in ASSETS.items():
        planned[filename]=check_file(srcstage/filename,hashes[1])[0]
        originals[filename]=os.lstat(LIVE/filename)
    tools={name:check_file(srctools/name,sha)[0] for name,sha in TOOL_BLOBS.items()}
    require(tools['frontend-assets.txt'].decode('ascii').splitlines()==list(ASSETS),
            'UNEXPECTED_ASSET_ORDER_STOP')
    print('REVIEWED_STAGING_CONTENT_AND_STOCK_TOOLS_OK',flush=True)
    os.umask(0o077)
    parent=Path('/root/fizira-release-backups')
    parent.mkdir(mode=0o700,exist_ok=True)
    require(not parent.is_symlink() and
            stat.S_IMODE(os.lstat(parent).st_mode)==0o700 and
            os.lstat(parent).st_uid==0,'UNSAFE_ROOT_BACKUP_DIRECTORY_STOP')
    folder=Path(tempfile.mkdtemp(prefix='pr36-d19fe0c-',dir=parent))
    stage=folder/'stage'
    tdir=folder/'tools'/'ops'/'release'
    stage.mkdir(mode=0o700)
    tdir.mkdir(parents=True,mode=0o700)
    for filename,data in planned.items():
        dst=stage/filename
        with dst.open('xb') as stream: stream.write(data)
        original=originals[filename]
        os.chown(dst,original.st_uid,original.st_gid)
        os.chmod(dst,stat.S_IMODE(original.st_mode))
        os.utime(dst,ns=(original.st_atime_ns,original.st_mtime_ns))
    for filename,data in tools.items():
        dst=tdir/filename
        with dst.open('xb') as stream: stream.write(data)
        os.chmod(dst,0o600)
    require(all(blob(read_file(stage/f)[0])==h[1] for f,h in ASSETS.items()),
            'ROOT_PRIVATE_STAGE_CHANGED_STOP')
    print('ROOT_OWNED_PRIVATE_STAGE_VERIFIED_OK',flush=True)
    # Do not trust any old preflight result once ready for the live operation.
    verify_live(0)
    verify_edge()
    backup=folder/'backup'
    activate=tdir/'activate-frontend.sh'
    snapshot=tdir/'frontend-snapshot.py'
    started=False
    try:
        started=True
        run(['bash',str(activate),'activate',str(LIVE),str(stage),str(backup)])
        run(['python3','-B',str(snapshot),'verify','--backup',str(backup),
             '--assets',str(tdir/'frontend-assets.txt')])
        verify_live(1)
        verify_edge()
        verify_public()
    except Exception:
        print('PR36_RELEASE_VERIFY_STOP',flush=True)
        if started and (backup/'complete').is_file():
            try:
                run(['bash',str(activate),'rollback',str(LIVE),str(stage),str(backup)])
                verify_live(0)
                print('ROOT_GUARDED_ROLLBACK_VERIFIED_OK',flush=True)
            except Exception:
                print('ROLLBACK_REQUIRES_OPERATOR_ATTENTION_STOP',flush=True)
        else:
            print('SNAPSHOT_INCOMPLETE_NO_ACTIVATION_EXPECTED',flush=True)
        print('RELEASE_FOLDER='+str(folder),flush=True)
        raise
    print('PR36_PRODUCTION_RELEASE_OK',flush=True)
    print('RELEASE_COMMIT='+HEAD,flush=True)
    print('ROOT_PROTECTED_RUN_BACKUP='+str(backup),flush=True)

if __name__=='__main__':
    try:
        main()
    except Exception as err:
        code=str(err)
        if re.fullmatch('[A-Z_]+',code or ''):
            print(code,flush=True)
        else:
            print('MANUAL_RELEASE_NEEDS_REVIEW_STOP',flush=True)
        sys.exit(1)
