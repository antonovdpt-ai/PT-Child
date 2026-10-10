#!/usr/bin/env bash
python3 -B - <<'FIZIRA_BACKUP_READ_ONLY_PY'
ASSETS = [{'file': 'app.js', 'base': '40f47bdd8bff5cb532bacab291f8866b8d6598af9030d0a9ddecce45f5016b43', 'candidate': '1cd746c981a780911f7b16d4d980efd1c867a3512439a58816b38e65232f4a6f'}, {'file': 'auth-domain.mjs', 'base': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f', 'candidate': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f'}, {'file': 'cabinet.js', 'base': 'eb1ab8004d792d7178a6b916dca327a18330fd4540d15fb5f72796d2e28f7ff4', 'candidate': '68453cd0a63d147c828e7568f07264185a598b48ea283fe44911cd37156bfdb3'}, {'file': 'favicon.ico', 'base': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0', 'candidate': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0'}, {'file': 'fizira-symbol.png', 'base': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726', 'candidate': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726'}, {'file': 'index.html', 'base': 'ee137d71d18672111627550cc83b4c93e0aac2a6b465f09877f35f69870fd6fa', 'candidate': '8d9e37c946056916a0dae2ba082ed60ad7c855611f3ab92556f8638039e19f2f'}, {'file': 'media-fallback.css', 'base': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975', 'candidate': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975'}, {'file': 'parent-domain.mjs', 'base': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322', 'candidate': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322'}, {'file': 'parent-specialist.js', 'base': 'd09b2242176247c6c563de4453fe093c4cd90a8e6ad8c0d7b196bc5768232d21', 'candidate': '60dc923905e9e6dadd32603e56c7da7515fe12202bcdb43ed0038684679a33c6'}, {'file': 'parent.css', 'base': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a', 'candidate': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a'}, {'file': 'parent.html', 'base': '0d1fa71b59cd0d360f30f08dde9ffc784aa0ac797f8a39ef27ce1ff813256b02', 'candidate': '21359196e94df206cbbdee0bb95285d27f09d9bdc2de3211fcc4911472c79bfe'}, {'file': 'parent.js', 'base': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0', 'candidate': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0'}, {'file': 'patient-flower.css', 'base': None, 'candidate': '83330ca85e2da38fd695ceb5156aa7cc9d5d3c78c8c3d446ffab9011712711f6'}, {'file': 'patient-flower.mjs', 'base': None, 'candidate': '0f04f22da7bda8434157c96bbcde8ccb6750bde822f364130406b9932d0b55e0'}, {'file': 'patient-overview.mjs', 'base': None, 'candidate': '757f2ce1a12f22298b5ae23b8240e2c1f1120cae6c0ff8c5c07254bb2d1fb347'}, {'file': 'report-pdf-export.mjs', 'base': '913b140a0e57975e5df7fa4a9634910091a659c9e24b3c7569f38b2fb5b4e4a6', 'candidate': '913b140a0e57975e5df7fa4a9634910091a659c9e24b3c7569f38b2fb5b4e4a6'}, {'file': 'role-gate.mjs', 'base': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85', 'candidate': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85'}, {'file': 'schedule-domain.mjs', 'base': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625', 'candidate': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625'}, {'file': 'schedule-editor.js', 'base': '95066df029061e727e2b6e2092f6c17705e931abe6555320dcbdcbc3a89cd81b', 'candidate': 'bec38eb7e44a0278d62755317e190f7f218b87185b81e39d7d8e02b3c176ca80'}, {'file': 'security-utils.mjs', 'base': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f', 'candidate': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f'}, {'file': 'styles.css', 'base': 'd4f45909147b41b766aa7be7db7111b3ab117734223a5dc096d58fa44f7f5830', 'candidate': 'd4f45909147b41b766aa7be7db7111b3ab117734223a5dc096d58fa44f7f5830'}]
import datetime, hashlib, json, os, re, shutil, tarfile
from pathlib import Path

root=Path(os.environ.get('FIZIRA_BACKUP_AUDIT_FIXTURE_ROOT','/')).resolve()
def local(name): return root/name.lstrip('/')
def safe(path): return all(not p.is_symlink() for p in (path,*path.parents))
def sha(path):
    if not safe(path): return 'SYMLINK_STOP'
    if not path.exists(): return 'ABSENT'
    if not path.is_file(): return 'NOT_REGULAR_STOP'
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
allowed={e['file']:e for e in ASSETS}
app=local('/root/supabase-project/volumes/proxy/app')
def manifest(path):
    if not safe(path) or not path.is_file() or path.stat().st_size>65536: raise ValueError('invalid manifest')
    result={}
    for line in path.read_text().splitlines():
        name,digest=line.split('\t')
        if name not in allowed or name in result or not (digest=='ABSENT' or re.fullmatch('[a-f0-9]{64}',digest)): raise ValueError('unknown manifest row')
        result[name]=digest
    return result
def inspect(path):
    result={'path':str(path.relative_to(root)),'state':'METADATA_ONLY_NOT_VERIFIED'}
    if not safe(path): return {**result,'state':'SYMLINK_STOP'}
    if path.is_file():
        # A legacy archive is not a guarded rollback invocation. Do not extract it.
        result.update(bytes=path.stat().st_size,sha256=sha(path),usableByProtectedRollback=False)
        if path.name.endswith(('.tar.gz','.tgz','.tar')) and path.stat().st_size<=64*1024*1024:
            seen={};stops=[]
            try:
                with tarfile.open(path,'r:*') as archive:
                    for count,item in enumerate(archive,1):
                        if count>256: raise ValueError('archive too large')
                        if item.isdir(): continue
                        parts=Path(item.name).parts; name=parts[-1] if parts else ''
                        if '..' in parts or item.name.startswith('/') or not item.isfile() or name not in allowed or name in seen or item.size>2*1024*1024: raise ValueError('unsupported archive')
                        with archive.extractfile(item) as f: seen[name]=hashlib.sha256(f.read()).hexdigest()
                stops=[n for n,h in seen.items() if h!=allowed[n]['base']]
                result.update(state='LEGACY_ARCHIVE_HASHES_CHECKED',assets=len(seen),differentFromCurrentBase=stops,
                              containsAllExistingFrontend=all(e['base'] is None or seen.get(e['file'])==e['base'] for e in ASSETS))
            except (OSError,ValueError,tarfile.TarError): result['state']='LEGACY_ARCHIVE_UNVERIFIED_STOP'
        return result
    if not path.is_dir(): return result
    backup=path/'backup' if (path/'backup').is_dir() else path
    files=[backup/'complete',backup/'before.tsv',backup/'release.tsv']
    if not all(p.is_file() and safe(p) for p in files): return result
    try:
        old,new=manifest(files[1]),manifest(files[2])
        if not old or set(old)!=set(new) or any(h=='ABSENT' for h in new.values()): raise ValueError('incomplete manifest')
        corrupt=[n for n,h in old.items() if h!='ABSENT' and sha(backup/'files'/n)!=h]
        live_stops=[n for n,h in old.items() if sha(app/n) not in (h,new[n])]
        full=set(old)==set(allowed)
        result.update(state='BACKUP_HASHES_MATCH' if not corrupt else 'CORRUPT_BACKUP_STOP',assets=len(old),
                      coversAllReleaseAssets=full,corruptAssets=corrupt,liveRollbackStops=live_stops,
                      guardedRollbackConditionsHold=full and not corrupt and not live_stops,
                      restoresReviewedCurrentBase=full and all(h==(allowed[n]['base'] or 'ABSENT') for n,h in old.items()))
    except (OSError,ValueError,UnicodeError): result['state']='UNVERIFIED_MANIFEST_STOP'
    return result
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'publicationReady':False,
        'scope':'READ_ONLY_FRONTEND_BACKUPS_NO_RESTORE_OR_FILE_WRITES','backups':[]}
for name in ['/root/.cache/fizira-frontend','/root/.cache/fizira-parent-ux','/root/.cache/fizira-report-export','/root/fizira-code-backups']:
    path=local(name)
    if not safe(path): report['backups'].append({'path':name,'state':'SYMLINK_STOP'});continue
    if not path.exists(): report['backups'].append({'path':name,'state':'ABSENT'});continue
    try:
        if path.is_dir():
            entries=sorted(path.iterdir(),key=lambda p:p.lstat().st_mtime,reverse=True)[:5]
            report['backups'].extend(inspect(p) for p in entries)
        else: report['backups'].append(inspect(path))
    except OSError: report['backups'].append({'path':name,'state':'UNREADABLE_STOP'})
cache=local('/root/.cache');probe=cache if cache.is_dir() else local('/root')
if safe(app) and app.is_dir() and safe(probe):
    report['snapshotPreconditions']={'appDirectoryPresent':True,'cacheParentPresent':probe.is_dir(),
        'freeBytes':shutil.disk_usage(probe).free,'existingFrontendBytes':sum((app/e['file']).stat().st_size for e in ASSETS if (app/e['file']).is_file() and safe(app/e['file'])),
        'appWritableForCurrentOperator':os.access(app,os.W_OK),'cacheWritableForCurrentOperator':os.access(probe,os.W_OK),
        'freshSnapshotCreated':False,'note':'Capacity/permissions are observations, not a created or restored server backup.'}
print(json.dumps(report,ensure_ascii=False,indent=2))

FIZIRA_BACKUP_READ_ONLY_PY
