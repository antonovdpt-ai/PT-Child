FIZIRA_ALLOW_FRONTEND_SNAPSHOT=approved-backup-only bash -s <<'FIZIRA_SNAPSHOT_ONLY_ED6C103'
#!/usr/bin/env bash
# PREPARED ONLY. Requires separate explicit backup-only permission. Never deploys.
set -euo pipefail
if [[ "${FIZIRA_ALLOW_FRONTEND_SNAPSHOT:-}" != approved-backup-only ]]; then
  echo 'STOP: отдельное разрешение на backup ещё требуется; ничего не создано.' >&2
  exit 2
fi
python3 -B - <<'FIZIRA_BACKUP_ONLY'
import datetime,hashlib,json,os,shutil,urllib.request,uuid
from pathlib import Path
REVISION='ed6c103578cbfcabe19ab0077e8eeff1305d8b3d'
TOOLS={'ops/release/activate-frontend.sh': '2cfa6a66d02278389995c7558cea318dd3452726176366632f580e9c35cec0c3', 'ops/release/frontend-snapshot.py': '5f58858ffc00f0ba86a88ccd683340dbe5adfd0c1ce577e4833c61370479dcc6', 'ops/release/frontend-assets.txt': '7f69469cdbc0f9c57fa86dafe03c0e79e77f1fa1ee7fa23783882b89522c1c6e'}
ASSETS={'app.js': '1cd746c981a780911f7b16d4d980efd1c867a3512439a58816b38e65232f4a6f', 'cabinet.js': '68453cd0a63d147c828e7568f07264185a598b48ea283fe44911cd37156bfdb3', 'styles.css': 'd4f45909147b41b766aa7be7db7111b3ab117734223a5dc096d58fa44f7f5830', 'patient-flower.css': '83330ca85e2da38fd695ceb5156aa7cc9d5d3c78c8c3d446ffab9011712711f6', 'patient-flower.mjs': '0f04f22da7bda8434157c96bbcde8ccb6750bde822f364130406b9932d0b55e0', 'patient-overview.mjs': '757f2ce1a12f22298b5ae23b8240e2c1f1120cae6c0ff8c5c07254bb2d1fb347', 'media-fallback.css': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975', 'auth-domain.mjs': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f', 'schedule-domain.mjs': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625', 'schedule-editor.js': 'bec38eb7e44a0278d62755317e190f7f218b87185b81e39d7d8e02b3c176ca80', 'security-utils.mjs': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f', 'role-gate.mjs': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85', 'parent.html': '21359196e94df206cbbdee0bb95285d27f09d9bdc2de3211fcc4911472c79bfe', 'parent.js': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0', 'parent.css': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a', 'parent-domain.mjs': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322', 'parent-specialist.js': '60dc923905e9e6dadd32603e56c7da7515fe12202bcdb43ed0038684679a33c6', 'report-pdf-export.mjs': '913b140a0e57975e5df7fa4a9634910091a659c9e24b3c7569f38b2fb5b4e4a6', 'favicon.ico': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0', 'fizira-symbol.png': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726', 'index.html': '8d9e37c946056916a0dae2ba082ed60ad7c855611f3ab92556f8638039e19f2f'}
BEFORE={'app.js': '40f47bdd8bff5cb532bacab291f8866b8d6598af9030d0a9ddecce45f5016b43', 'cabinet.js': 'eb1ab8004d792d7178a6b916dca327a18330fd4540d15fb5f72796d2e28f7ff4', 'styles.css': 'd4f45909147b41b766aa7be7db7111b3ab117734223a5dc096d58fa44f7f5830', 'patient-flower.css': 'ABSENT', 'patient-flower.mjs': 'ABSENT', 'patient-overview.mjs': 'ABSENT', 'media-fallback.css': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975', 'auth-domain.mjs': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f', 'schedule-domain.mjs': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625', 'schedule-editor.js': '95066df029061e727e2b6e2092f6c17705e931abe6555320dcbdcbc3a89cd81b', 'security-utils.mjs': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f', 'role-gate.mjs': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85', 'parent.html': '0d1fa71b59cd0d360f30f08dde9ffc784aa0ac797f8a39ef27ce1ff813256b02', 'parent.js': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0', 'parent.css': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a', 'parent-domain.mjs': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322', 'parent-specialist.js': 'd09b2242176247c6c563de4453fe093c4cd90a8e6ad8c0d7b196bc5768232d21', 'report-pdf-export.mjs': '913b140a0e57975e5df7fa4a9634910091a659c9e24b3c7569f38b2fb5b4e4a6', 'favicon.ico': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0', 'fizira-symbol.png': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726', 'index.html': 'ee137d71d18672111627550cc83b4c93e0aac2a6b465f09877f35f69870fd6fa'}
target=Path('/root/supabase-project/volumes/proxy/app')
cache_root=Path('/root/.cache/fizira-frontend')
try:
 if os.geteuid()!=0:raise ValueError('ROOT_OPERATOR_REQUIRED_STOP')
 # Download and verify all tool/asset bytes in memory before creating server files.
 wanted={**TOOLS,**ASSETS};downloaded={}
 for name,expected in wanted.items():
  raw=urllib.request.urlopen('https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/'+REVISION+'/'+name,timeout=30).read(64*1024*1024+1)
  if hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('REVIEWED_DOWNLOAD_HASH_STOP')
  downloaded[name]=raw
 module={'__name__':'fizira_backup_helper'};exec(compile(downloaded['ops/release/frontend-snapshot.py'],'reviewed-backup-helper','exec'),module)
 module['safe'](target);module['safe'](cache_root)
 for name,expected in BEFORE.items():
  file=target/name;module['safe'](file)
  actual=module['sha'](file) if file.exists() else 'ABSENT'
  if actual!=expected:raise ValueError('PRODUCTION_FRONTEND_DRIFT_STOP')
 files,_=module['inventory'](target)
 need=3*sum(x['bytes'] for x in files.values())+sum(len(b) for b in downloaded.values())+32*1024*1024
 if shutil.disk_usage(target).free<need:raise ValueError('INSUFFICIENT_SNAPSHOT_SPACE_STOP')
 cache_root.mkdir(parents=True,exist_ok=True)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 work=cache_root/('preflight-'+REVISION[:12]+'-'+stamp+'-'+uuid.uuid4().hex[:12]);work.mkdir(mode=0o700)
 stage=work/'stage';stage.mkdir(mode=0o700)
 for name,raw in downloaded.items():
  dest=stage/name if name in ASSETS else work/name
  dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
 backup=work/'snapshot';names=module['assets'](work/'ops/release/frontend-assets.txt')
 proof=module['create'](target,stage,backup,names)
 module['verify'](backup,names,proof['manifestSha256'])
 # Rehearse exclusively on a private copy; the real target is NEVER activated.
 clone=work/'rehearsal-source';module['create'](backup/'files',stage,clone,names)
 rehearsal_live=clone/'files';rehearsal_backup=work/'rehearsal-operation'
 module['create'](rehearsal_live,stage,rehearsal_backup,names)
 module['mutate']('activate',rehearsal_live,stage,rehearsal_backup,names)
 module['mutate']('rollback',rehearsal_live,None,rehearsal_backup,names)
 if module['inventory'](rehearsal_live)[0]!=files:raise ValueError('PRIVATE_ROLLBACK_REHEARSAL_STOP')
 # Verify original live hashes again; source contents were never changed.
 if module['inventory'](target)[0]!=files:raise ValueError('PRODUCTION_CHANGED_DURING_BACKUP_STOP')
 result={'backup':'FULL_FRONTEND_SNAPSHOT_VERIFIED','releaseCommit':REVISION,'snapshotPath':str(backup),
  'manifestSha256':proof['manifestSha256'],'files':proof['files'],'bytes':proof['bytes'],
  'privateCopyRollback':'VERIFIED','liveFrontendChanged':False,'servicesRestarted':False,'publicationReady':False}
 (work/'backup-result.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
except Exception as exc:
 label=str(exc) if isinstance(exc,ValueError) and str(exc).replace('_','').isupper() else type(exc).__name__
 print(json.dumps({'backup':'STOP','reason':label,'publicationReady':False}));raise SystemExit(1)
FIZIRA_BACKUP_ONLY
FIZIRA_SNAPSHOT_ONLY_ED6C103
