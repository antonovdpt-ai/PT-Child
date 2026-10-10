#!/usr/bin/env bash
# READ-ONLY: prints selected safe runtime metadata/hashes, never router/config contents.
set -euo pipefail
python3 -B - <<'FIZIRA_READ_ONLY'
import hashlib,json,urllib.request
from pathlib import Path
REVISION='ed6c103578cbfcabe19ab0077e8eeff1305d8b3d'
EXPECTED='f5924ee4918048acefdc9be96c8ab325c56aeced52e35b4804d9ace8b12ff631'
ROUTER_REFERENCE={'repository': 'supabase/supabase', 'sourceCommit': 'ff80bb14991e68667c04f74248b954e8babe6fde', 'path': 'docker/volumes/functions/main/index.ts', 'sha256': 'ed402c31abf346198d71cc7bab3b7eead03b91d6b9d638b30fc5e5fada25802b', 'productionMatch': False, 'role': 'REFERENCE_ONLY_NOT_PRODUCTION_EVIDENCE'}
EXPECTED_FILES={'_shared/ai-helpers.ts': '7c9e08ada04c6341f4d5c64de4f9c964cfc2d8a32860bd99101906737a07e5e8', 'ptchild-ai/index.ts': '6181b7de17b9da29a8f7fe20dbb7a3e8c3e94408ca2cce2206f1e24e462308b6', 'create-parent-invitation/index.ts': 'f1d5c288d61638aa8b86f9cb21765518c32419823bae2bbddaa704d896b6bb64', 'resend-parent-invitation/index.ts': '2dc3a0aec24a0a1f70b6c2eb338f2136679a6fb8c64ea3748445c335c2bdd3fc', 'revoke-parent-access/index.ts': 'dbbe1d087d81ce3c9a4d1d17a7a519c18181d483a8b8730fb884b34199eedab9', 'generate-parent-report-pdf/index.ts': '6a350fc2940df98a222d77684ef5bf6b8486eec444f40775b49a24936ff56872', 'parent-report-file/index.ts': '0cda79db0873d2f8fe1d101bc9f203673307ddd22d2fe120a5bdddf5fdff5df8', '_shared/parent-portal.ts': 'ad75573bb150e94443f862a259e42ba4cf6b79276cf4bf921bfa8bd6242a8db4', '_shared/parent-publication.ts': '6f0d5aaf95dd5c85be672bc21baf7fcfa049657ec73e27490e4b5ab82f144bc0', '_shared/parent-pdf.ts': '810baf02e3492d6c467112e680d5c785f5a00c50fc8ae9deefeda71992aee20f', '_shared/font-data.ts': '98186e6ed21fbf0a6df1eb748c60acf3d390889ddf69f9d304c3b234cd2e8fd8', '_shared/fonts/NotoSans-Regular.ttf': 'f5f552c8c5edb61fe6efb824baf4d4de47b1a8689ab4925ff43f7bd6a4ebece5', '_shared/fonts/OFL.txt': '3c200cfde6940eb9e953af2ceb44b3a8011df285a11f16fdf447aecf8339ae67'}
try:
 raw=urllib.request.urlopen('https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/'+REVISION+'/ops/release/edge-runtime-audit.py',timeout=30).read(128*1024+1)
 if hashlib.sha256(raw).hexdigest()!=EXPECTED:raise ValueError('AUDITOR_HASH_STOP')
 module={'__name__':'fizira_readonly_runtime'};exec(compile(raw,'reviewed-runtime-auditor','exec'),module)
 functions=Path('/root/supabase-project/volumes/functions')
 result=module['collect'](functions,include_source=False)
 cfg=Path('/root/supabase-project/supabase/config.toml')
 absent=not cfg.exists() and not cfg.is_symlink() and not any(p.is_symlink() for p in cfg.parents)
 files=result['snapshot']['runtimeFiles']
 result.update(collectorCommit=REVISION,checkedCliConfigAbsent=absent,
  dependencySourceParity={name:files.get(name)==expected for name,expected in EXPECTED_FILES.items()},
  additionalRuntimeFiles={name:digest for name,digest in files.items() if name not in EXPECTED_FILES},
  snapshotSha256=hashlib.sha256(json.dumps(result['snapshot'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
 result['routerComparison']={'referenceCommit':ROUTER_REFERENCE['sourceCommit'],'referenceSha256':ROUTER_REFERENCE['sha256'],'matchesThisReference':result['snapshot']['router']['sha256']==ROUTER_REFERENCE['sha256'],'comparisonIsNotRuntimeGate':True}
 print(json.dumps(result,indent=2,ensure_ascii=False))
except Exception as exc:
 label=str(exc) if isinstance(exc,ValueError) and str(exc).replace('_','').isupper() else type(exc).__name__
 print(json.dumps({'runtimeAudit':'STOP','reason':label,'publicationReady':False}));raise SystemExit(1)
FIZIRA_READ_ONLY
