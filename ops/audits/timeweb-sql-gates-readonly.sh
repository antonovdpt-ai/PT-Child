#!/usr/bin/env bash
# Streams reviewed assertions into read-only psql; no server file creation.
python3 -B - <<'FIZIRA_SQL_READ_ONLY_PY'
import hashlib,re,subprocess,urllib.request
REVISION='50758af34e4e78d48ac1dc92d11f9be3debbc4a3'
EXPECTED = {'verify_parent_portal.sql': '2236273abd1b4575ed2e5afe4646c10fd91020302d7080ed6941aa7c5b289940', 'verify_migration.sql': 'a5a4be25896de6d32e7234a9d3785d4801e17e3dcc17c862da8582aaed5ecce5', 'verify_parent_portal_definitions.sql': 'c97d8761d9103e8e5a7d85e261bdb90d5b26cb334fdb0f6872280bb6751a7a65', 'verify_goal_parent_sync.sql': '224d45b0f2c0bc778842573c9880d08986110dcf86ef681ab587e8a38430b810', 'verify_goal_parent_sync_definitions.sql': 'c3804db832787a6b257dcf374d2db91378750b707f1ece22673dfb7b0cefb489'}

def read_source(name):
    if name not in EXPECTED: raise ValueError('unknown SQL include')
    url='https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/'+REVISION+'/supabase/verification/'+name
    with urllib.request.urlopen(url,timeout=20) as response: data=response.read(1024*1024)
    if hashlib.sha256(data).hexdigest()!=EXPECTED[name]: raise ValueError('SQL SOURCE HASH STOP')
    return data.decode('utf-8')

def build_sql(name,read=read_source,seen=()):
    if name in seen: raise ValueError('recursive include')
    source=read(name)
    return re.sub(r'^\\ir ([A-Za-z0-9_]+\.sql)\s*$',lambda m:build_sql(m.group(1),read,seen+(name,)),source,flags=re.M)

def main():
    try:
        sql=build_sql('verify_parent_portal.sql')+"\nselect 'PARENT_PORTAL_SQL_VERIFIED' as result;\n"+build_sql('verify_goal_parent_sync.sql')
    except Exception:
        print('SQL_SOURCE_STOP: reviewed SQL download/hash failed; database not contacted')
        return 1
    command=['docker','exec','-i','--env','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000','supabase-db','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
    try: result=subprocess.run(command,input=sql,text=True,timeout=150)
    except (OSError,subprocess.TimeoutExpired):
        print('SQL_GATE_STOP: verifier not completed; no PASS attested')
        return 1
    if result.returncode: print('SQL_GATE_STOP: keep evidence false; do not repair policies or rerun migrations')
    else: print('READ_ONLY_SQL_GATES_PASS: catalog verification only, not runtime or isolated E2E')
    return result.returncode

if __name__=='__main__': raise SystemExit(main())

FIZIRA_SQL_READ_ONLY_PY
