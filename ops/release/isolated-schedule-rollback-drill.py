#!/usr/bin/env python3
"""Isolated dry-run of the real frontend snapshot/activate/rollback programs.

Reads only the protected archive and incoming reviewed 21-file stage.
Writes only to a new TemporaryDirectory in the snapshot parent's private path.
Does not use the production app path or run any production mutation.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile

CANDIDATE='cab03ade946bc0789aba45327bfe89bef3b92cd9'
BASE='15b9def8c6460af1d54980a3f0e78a660634a5c2'
TOOLS=[
 'ops/release/activate-frontend.sh',
 'ops/release/frontend-snapshot.py',
 'ops/release/frontend-assets.txt',
 'ops/release/verify-protected-frontend-restore.py',
]
ASSET_NAMES=[
 'app.js','cabinet.js','styles.css','patient-flower.css','patient-flower.mjs',
 'patient-overview.mjs','media-fallback.css','auth-domain.mjs',
 'schedule-domain.mjs','schedule-editor.js','security-utils.mjs','role-gate.mjs',
 'parent.html','parent.js','parent.css','parent-domain.mjs','parent-specialist.js',
 'report-pdf-export.mjs','favicon.ico','fizira-symbol.png','index.html',
]
STAGING_MANIFEST='schedule-release-asset-hashes.json'
ALLOWED=set(ASSET_NAMES + TOOLS + [STAGING_MANIFEST])

def require(cond,label):
    if not cond:
        raise ValueError(label)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def import_from(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    require(spec is not None and spec.loader is not None,'TOOL_IMPORT_STOP')
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def load_transmitted_stage(root):
    # One bounded, exact-members stage stream from the trusted GitHub CI run.
    stream=sys.stdin.buffer.read(32*1024*1024+1)
    require(0<len(stream)<=32*1024*1024,'STAGING_STREAM_BOUNDS_STOP')
    raw={}
    with tarfile.open(fileobj=io.BytesIO(stream),mode='r:') as archive:
        for member in archive:
            name=member.name
            require(name in ALLOWED and name not in raw and member.isfile() and
                    member.size<=12*1024*1024 and
                    not member.issym() and not member.islnk(),
                    'UNEXPECTED_STAGING_MEMBER_STOP')
            f=archive.extractfile(member)
            require(f is not None,'STAGING_READ_STOP')
            payload=f.read(member.size+1)
            require(len(payload)==member.size,'STAGING_SIZE_STOP')
            raw[name]=payload
    require(set(raw)==ALLOWED,'INCOMPLETE_STAGING_STOP')
    manifest=json.loads(raw[STAGING_MANIFEST].decode('utf-8'))
    require(manifest.get('head')==CANDIDATE and
            manifest.get('base')==BASE and
            set(manifest.get('files',{}))==set(ASSET_NAMES),
            'STAGING_MANIFEST_STOP')
    for name in ASSET_NAMES:
        require(re.fullmatch(r'[a-f0-9]{64}',str(manifest['files'][name])) and
                sha(raw[name])==manifest['files'][name], 'STAGING_HASH_STOP')
    require(raw['ops/release/frontend-assets.txt'].decode('utf-8').splitlines()==ASSET_NAMES,
            'ORDERED_ASSET_LIST_STOP')
    stage=root/'stage'
    stage.mkdir(mode=0o700)
    for name in sorted(ALLOWED):
        payload=raw[name]
        dest=stage.joinpath(*PurePosixPath(name).parts)
        dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with dest.open('xb') as f:
            f.write(payload)
        dest.chmod(0o600)
    return stage

def run(args, label, expect_success=True):
    task=subprocess.run(args,capture_output=True,text=True,timeout=120)
    if expect_success:
        require(task.returncode==0, label+'_FAILED_STOP')
    else:
        require(task.returncode !=0 and
                ('UNKNOWN_LIVE__STOP' in task.stdout or 'UNKNOWN_LIVE__STOP' in task.stderr),
                'TAMPER_WAS_NOT_REJECTED_STOP')
    return task

def main():
    os.umask(0o077)
    # Load and validate the original production snapshot. No live path is read.
    bootstrap=Path.home()/'.cache'/'fizira-frontend'/'snapshots'
    require(bootstrap.is_dir() and not bootstrap.is_symlink() and
            stat.S_IMODE(bootstrap.stat().st_mode)==0o700,
            'PRIVATE_SNAPSHOT_PARENT_STOP')
    with tempfile.TemporaryDirectory(prefix='rollback-drill-',dir=bootstrap) as temp:
        root=Path(temp)
        require(root.parent==bootstrap and stat.S_IMODE(root.stat().st_mode)==0o700,
                'ISOLATION_ROOT_STOP')
        stage=load_transmitted_stage(root)
        verifier=import_from('fizira_private_archive_verify',
            stage/'ops/release/verify-protected-frontend-restore.py')
        snapshot=verifier.safe_snapshot()
        data=verifier.load_expected(snapshot)
        archive=snapshot/'frontend.tar'
        require(verifier.sha_file(archive,32*1024*1024)==verifier.EXPECTED_TAR_SHA256,
                'ORIGINAL_ARCHIVE_HASH_STOP')
        verifier.validate_tar(archive,data['entries'])
        origin=root/'target'
        origin.mkdir(mode=0o700)
        recovered=verifier.restore_and_check(archive,data,origin)
        require(recovered==(121,5880716),'RESTORED_SOURCE_COUNT_STOP')
        snapshot_module=import_from('fizira_frontend_snapshot',
            stage/'ops/release/frontend-snapshot.py')
        before,dirs=snapshot_module.inventory(origin)
        before_dirs=snapshot_module.directory_metadata(origin,dirs)
        expected={n:sha((stage/n).read_bytes()) for n in ASSET_NAMES}
        tool=stage/'ops/release/activate-frontend.sh'
        backup=root/'snapshot'
        run(['bash',str(tool),'activate',str(origin),str(stage),str(backup)],
            'ISOLATED_ACTIVATION')
        snapshot_module.verify(backup,ASSET_NAMES)
        for name,expected_sha in expected.items():
            require(snapshot_module.sha(origin/name)==expected_sha,
                    'ACTIVATED_ASSET_HASH_STOP')
        after,afterdirs=snapshot_module.inventory(origin)
        require(afterdirs==dirs and set(after)==set(before),
                'ACTIVATION_EXTRA_FILES_STOP')
        changed=sum(before[n]['sha256']!=after[n]['sha256'] for n in before)
        require(changed>=1,'NO_SCHEDULE_DELTA_STOP')
        print('ISOLATED_ACTIVATION_VERIFIED')
        print('RELEASE_CHANGED_ASSETS='+str(changed))
        run(['bash',str(tool),'rollback',str(origin),str(stage),str(backup)],
            'ISOLATED_ROLLBACK')
        restored,restored_dirs=snapshot_module.inventory(origin)
        recovered_dir_meta=snapshot_module.directory_metadata(origin,restored_dirs)
        print('ROLLBACK_FILE_CONTENT_DIFF_COUNT='+str(sum(
            before[n]['sha256'] != restored[n]['sha256'] for n in before if n in restored)))
        print('ROLLBACK_FILE_METADATA_DIFF_COUNT='+str(sum(
            before[n] != restored[n] and before[n]['sha256'] == restored[n]['sha256']
            for n in before if n in restored)))
        print('ROLLBACK_DIRECTORY_METADATA_DIFF_COUNT='+str(sum(
            before_dirs[d] != recovered_dir_meta.get(d) for d in before_dirs)))
        print('ROLLBACK_DIR_NAMES_MATCH='+str(restored_dirs==dirs))
        # Atomic replacement changes the containing directory's mtime.
        # This timestamp is not content or file metadata. Require every byte
        # and file metadata field unchanged, and permit ONLY root-dir mtime.
        changed_dir_meta={d for d in before_dirs if before_dirs[d]!=recovered_dir_meta.get(d)}
        for directory in before_dirs:
            require({k:v for k,v in before_dirs[directory].items() if k!='mtimeNs'} ==
                    {k:v for k,v in recovered_dir_meta[directory].items() if k!='mtimeNs'},
                    'ROLLBACK_DIRECTORY_PERMISSIONS_STOP')
        require(changed_dir_meta.issubset({'.'}),
                'ROLLBACK_UNEXPECTED_DIRECTORY_TIMESTAMP_STOP')
        require(restored==before and restored_dirs==dirs,
                'ROLLBACK_INVENTORY_MISMATCH_STOP')
        print('ROOT_DIRECTORY_MTIME_ONLY_CHANGE_OK')
        print('ISOLATED_ROLLBACK_VERIFIED')
        print('ROLLBACK_FULL_TREE_HASH_AND_METADATA_OK')
        # Fail-closed test: intentionally corrupt ONLY the temporary target,
        # and prove the real rollback refuses to overwrite unexpected bytes.
        backup2=root/'snapshot-tamper'
        run(['bash',str(tool),'activate',str(origin),str(stage),str(backup2)],
            'SECOND_ISOLATED_ACTIVATION')
        poisoned=origin/'styles.css'
        poisoned.write_bytes(b'fictional-unknown-live-data-tamper-test')
        state,dirnames=snapshot_module.inventory(origin)
        run(['bash',str(tool),'rollback',str(origin),str(stage),str(backup2)],
            'UNKNOWN_LIVE_REJECTION',expect_success=False)
        post,postdirs=snapshot_module.inventory(origin)
        require(state==post and dirnames==postdirs,
                'UNEXPECTED_WRITE_ON_REJECTED_ROLLBACK_STOP')
        print('UNKNOWN_LIVE_ROLLBACK_REJECTED_OK')
        print('FAILED_ROLLBACK_LEFT_TARGET_UNCHANGED_OK')
        require(verifier.sha_file(archive,32*1024*1024)==verifier.EXPECTED_TAR_SHA256,
                'ORIGINAL_BACKUP_CHANGED_STOP')
        print('ORIGINAL_PRODUCTION_ARCHIVE_UNCHANGED_OK')
    require(not root.exists(),'DRILL_CLEANUP_STOP')
    print('TEMPORARY_DRILL_REMOVED_OK')
    print('LIVE_PRODUCTION_UNTOUCHED_OK')

if __name__=='__main__':
    try:
        main()
    except Exception as e:
        if isinstance(e,ValueError) and re.fullmatch(r'[A-Z_]+',str(e)):
            print(str(e))
        else:
            print('ISOLATED_ROLLBACK_DRILL_FAILED_STOP')
        sys.exit(1)
