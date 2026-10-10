python3 -B - <<'FIZIRA_RUNTIME_SOURCE_READONLY'
import hashlib,json,re,subprocess,urllib.parse,urllib.request
from pathlib import Path
REVISION='ed6c103578cbfcabe19ab0077e8eeff1305d8b3d'
AUDITOR_SHA='f5924ee4918048acefdc9be96c8ab325c56aeced52e35b4804d9ace8b12ff631'
SNAPSHOT_SHA='fc8fce1695a2df54abc9ffd77bcabe73ad77f0efa15c28dfed3ad7cda230f118'
BACKUP_SHA='a330839ec768e48cdcd4ce71a5369ac29dfc6df013f27a4ce7c744655c5aa763'
FILES=('main/index.ts','deno.jsonc','delete-account/index.ts','hello/index.ts')
def require(ok,label):
 if not ok:raise ValueError(label)
def snapshot_sha(value):
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
try:
 raw=urllib.request.urlopen('https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/'+REVISION+'/ops/release/edge-runtime-audit.py',timeout=30).read(128*1024+1)
 require(hashlib.sha256(raw).hexdigest()==AUDITOR_SHA,'AUDITOR_HASH_STOP')
 module={'__name__':'fizira_readonly_source_review'}
 exec(compile(raw,'reviewed-readonly-auditor','exec'),module)
 functions=Path('/root/supabase-project/volumes/functions')
 original_run=module['subprocess'].run;private=[]
 def capture_run(args,*a,**kw):
  result=original_run(args,*a,**kw)
  if args==['docker','inspect','supabase-edge-functions'] and result.returncode==0:
   private.extend(json.loads(result.stdout))
  return result
 module['subprocess'].run=capture_run
 try:result=module['collect'](functions,include_source=False)
 finally:module['subprocess'].run=original_run
 require(snapshot_sha(result['snapshot'])==SNAPSHOT_SHA,'CONFIRMED_RUNTIME_DRIFT_STOP')
 require(len(private)==1,'PRIVATE_INSPECT_SHAPE_STOP')
 env=dict(item.split('=',1) for item in (private[0].get('Config') or {}).get('Env',[]) if '=' in item)
 secrets=[v for k,v in env.items() if v and re.search('KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL',k)]
 sources={}
 for name in FILES:
  data=module['regular'](functions/name,96*1024)
  require(hashlib.sha256(data).hexdigest()==result['snapshot']['runtimeFiles'].get(name),'SOURCE_FILE_DRIFT_STOP')
  text=data.decode('utf-8')
  for secret in secrets:
   variants=(secret,json.dumps(secret,ensure_ascii=True)[1:-1],json.dumps(secret,ensure_ascii=False)[1:-1],urllib.parse.quote(secret,safe=''))
   require(not any(v and v in text for v in variants),'SOURCE_SECRET_VALUE_WITHHELD_STOP')
  require(not re.search(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_(?:secret|publishable)_[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----',text),'SOURCE_CREDENTIAL_LITERAL_WITHHELD_STOP')
  require(not re.search(r'''(?i)\b(?:[a-z_]*(?:secret|password|token|api_?key|anon_?key|service_?role_?key)|authorization)["']?\s*[:=]\s*["'][^"']+["']''',text),'SOURCE_CREDENTIAL_ASSIGNMENT_WITHHELD_STOP')
  require(not re.search(r'''\bcreateClient\s*\([^,]+,\s*["'][^"']+["']''',text),'SOURCE_CLIENT_KEY_LITERAL_WITHHELD_STOP')
  require(not re.search(r'''["'][A-Za-z0-9_+/=-]{40,}["']''',text),'SOURCE_OPAQUE_LITERAL_WITHHELD_STOP')
  for url in re.findall(r'''[A-Za-z][A-Za-z0-9+.-]*://[^\s"'`<>]+''',text):
   parsed=urllib.parse.urlsplit(url)
   require(not parsed.username and not parsed.password and not re.search('(?i)(?:key|secret|token|password|credential)=',parsed.query),'SOURCE_URL_CREDENTIAL_WITHHELD_STOP')
  sources[name]={'sha256':hashlib.sha256(data).hexdigest(),'source':text}
 cfg=Path('/root/supabase-project/supabase/config.toml')
 require(not cfg.exists() and not cfg.is_symlink() and not any(p.is_symlink() for p in cfg.parents),'CONFIG_ABSENCE_DRIFT_STOP')
 # Read only the identifier of the already verified snapshot; do not create or replay it.
 backup_paths=[];cache=Path('/root/.cache/fizira-frontend')
 require(not any(p.is_symlink() for p in (cache,*cache.parents)),'BACKUP_PATH_SYMLINK_STOP')
 candidates=list(cache.glob('preflight-ed6c103578cb-*/snapshot/manifest.sha256'))
 require(len(candidates)<=100,'BACKUP_LOOKUP_UNBOUNDED_STOP')
 for manifest in candidates:
  data=module['regular'](manifest,4096)
  if hashlib.sha256(data).hexdigest()==BACKUP_SHA:
   require(module['regular'](manifest.parent/'complete',128).decode()==BACKUP_SHA+'\n','BACKUP_MARKER_DRIFT_STOP')
   backup_paths.append(str(manifest.parent))
 require(len(backup_paths)<=1,'BACKUP_IDENTIFIER_AMBIGUOUS_STOP')
 require(snapshot_sha(module['collect'](functions,include_source=False)['snapshot'])==SNAPSHOT_SHA,'RUNTIME_CHANGED_DURING_READ_STOP')
 result.update(snapshotSha256=SNAPSHOT_SHA,reviewSources=sources,
  backupIdentity={'manifestSha256':BACKUP_SHA,'snapshotPath':backup_paths[0] if backup_paths else None,'lookupOnly':True},
  runtimeReview='UNVERIFIED_PENDING_SOURCE_REVIEW',productionWrites=0,servicesRestarted=False,publicationReady=False)
 print(json.dumps(result,ensure_ascii=False,indent=2))
except Exception as exc:
 label=str(exc) if isinstance(exc,ValueError) and re.fullmatch('[A-Z_]+',str(exc)) else type(exc).__name__
 print(json.dumps({'runtimeReview':'STOP','reason':label,'productionWrites':0,'publicationReady':False}));raise SystemExit(1)
FIZIRA_RUNTIME_SOURCE_READONLY
