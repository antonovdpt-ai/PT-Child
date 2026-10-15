#!/usr/bin/env python3
"""Read-only Fizira Flower UI source audit via GitHub-hosted runner."""
import hashlib, os, re, subprocess, tempfile
from pathlib import Path

BASE="51e18c88377a7b20d06eef24b0db9fcb6d45fd3a"
HEAD="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
ASSETS=("app.js","cabinet.js","styles.css","patient-flower.css",
"patient-flower.mjs","patient-overview.mjs","media-fallback.css",
"auth-domain.mjs","schedule-domain.mjs","schedule-editor.js",
"security-utils.mjs","role-gate.mjs","parent.html","parent.js",
"parent.css","parent-domain.mjs","parent-specialist.js",
"report-pdf-export.mjs","favicon.ico","fizira-symbol.png","index.html")
CHANGED=set(("app.js","cabinet.js","schedule-editor.js","parent-specialist.js",
"parent.html","index.html","patient-flower.css","patient-flower.mjs",
"patient-overview.mjs"))

def stop(msg):
    raise SystemExit("BLOCKED "+msg)
def run(args,timeout=45,input=None):
    try:
        return subprocess.run(args,input=input,stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE,timeout=timeout)
    except (OSError,subprocess.TimeoutExpired):
        stop("COMMAND_FAILED_OR_TIMED_OUT")

def blob(ref,path):
    if run(["git","cat-file","-e",ref+":"+path],10).returncode:
        return None
    if run(["git","cat-file","-t",ref+":"+path],10).stdout.strip()!=b"blob":
        stop("GIT_NONBLOB")
    r=run(["git","show",ref+":"+path],20)
    if r.returncode or len(r.stdout)>64*1024*1024:
        stop("GIT_READ")
    return hashlib.sha256(r.stdout).hexdigest()

def main():
    if (os.environ.get("GITHUB_ACTIONS")!="true" or
        os.environ.get("GITHUB_REPOSITORY")!="antonovdpt-ai/PT-Child" or
        os.environ.get("GITHUB_REF")!="refs/heads/release/flower-frontend-only-20261015"):
        stop("CI_IDENTITY")
    if run(["git","merge-base","--is-ancestor",HEAD,"HEAD"]).returncode:
        stop("CI_SOURCE_ANCESTRY")
    manifest=run(["git","show",HEAD+":ops/release/frontend-assets.txt"])
    if manifest.returncode or tuple(manifest.stdout.decode().splitlines())!=ASSETS:
        stop("FRONTEND_MANIFEST")
    expected={}
    for name in ASSETS:
        b,h=blob(BASE,name),blob(HEAD,name)
        if h is None or ((b!=h)!=(name in CHANGED)):
            stop("FRONTEND_PIN_"+name)
        expected[name]=(b,h)
    if sum(b is None for b,h in expected.values())!=3:
        stop("FRONTEND_NEW_COUNT")

    host=os.environ.get("TIMEWEB_HOST","")
    port=os.environ.get("TIMEWEB_PORT") or "22"
    user=os.environ.get("TIMEWEB_USER","")
    if not (re.fullmatch("[A-Za-z0-9.:-]{1,255}",host)
        and re.fullmatch("[0-9]{1,5}",port) and 0<int(port)<65536
        and re.fullmatch("[A-Za-z_][A-Za-z0-9_.-]{0,63}",user)):
        stop("SSH_CONFIG")
    key=Path.home()/".ssh/id_ed25519"
    if not key.is_file():
        stop("SSH_KEY_MISSING")
    files=" ".join("'"+p+"'" for p in ASSETS)
    remote=f"""
set -eu
cd /root/supabase-project/volumes/proxy/app
for f in {files}; do
  if [ -L "$f" ]; then printf 'FILE\\t%s\\tSYMLINK\\n' "$f"
  elif [ -f "$f" ]; then
     digest=$(sha256sum -- "$f" | cut -d' ' -f1)
     printf 'FILE\\t%s\\t%s\\n' "$f" "$digest"
  elif [ -e "$f" ]; then printf 'FILE\\t%s\\tNONREGULAR\\n' "$f"
  else printf 'FILE\\t%s\\tABSENT\\n' "$f"; fi
done
df -Pk . | awk 'NR==2 {{print "FREE_KB\\t" $4}}'
echo AUDIT_REMOTE_COMPLETE
"""
    result=run(["ssh","-i",str(key),"-o","IdentitiesOnly=yes",
       "-o","StrictHostKeyChecking=yes","-o","BatchMode=yes",
       "-o","ConnectTimeout=12","-o","ServerAliveInterval=10",
       "-o","ServerAliveCountMax=2","-p",port,user+"@"+host,"bash","-s"],
       timeout=80,input=remote.encode())
    if result.returncode:
        stop("SSH_READONLY_AUDIT_FAILED")
    try:
        lines=result.stdout.decode("ascii").splitlines()
    except UnicodeDecodeError:
        stop("SSH_ENCODING")
    actual={}; free=None; done=False
    for line in lines:
        a=line.split("\t")
        if len(a)==3 and a[0]=="FILE" and a[1] in expected and a[1] not in actual:
            if a[2]!="ABSENT" and not re.fullmatch("[a-f0-9]{64}",a[2]):
                stop("UNSAFE_REMOTE_ENTRY")
            actual[a[1]]=a[2]
        elif len(a)==2 and a[0]=="FREE_KB" and a[1].isdigit() and free is None:
            free=int(a[1])
        elif line=="AUDIT_REMOTE_COMPLETE" and not done:
            done=True
        else:
            stop("SSH_UNEXPECTED_OUTPUT")
    if not done or set(actual)!=set(ASSETS) or free is None or free<512*1024:
        stop("REMOTE_INCOMPLETE_OR_LOW_DISK")
    states={}
    for name in ASSETS:
        b,h=expected[name];live=actual[name]
        if live==b and b==h:
            states[name]="UNCHANGED"
        elif live==b and b is not None:
            states[name]="BASE"
        elif live==h:
            states[name]="HEAD"
        elif live=="ABSENT" and b is None:
            states[name]="EXPECTED_ABSENT"
        else:
            states[name]="DRIFT_STOP"
    for name,status in states.items():
        print("SERVER",name,status)
    if "DRIFT_STOP" in states.values():
        stop("SERVER_UNKNOWN_BYTES")

    checked=0
    for name in ASSETS:
        if actual[name]=="ABSENT":
            continue
        url="https://app.fizira.com/"+("" if name=="index.html" else name)
        url+="?flower-audit="+HEAD[:10]
        with tempfile.TemporaryDirectory(prefix="flower-public-") as d:
            dest=Path(d)/"asset"
            result=run(["curl","--fail","--silent","--show-error","--location",
                "--max-redirs","2","--proto","=https","--proto-redir","=https",
                "--connect-timeout","8","--max-time","20","--retry","0",
                "--output",str(dest),url],timeout=25)
            if result.returncode or not dest.is_file() or dest.stat().st_size>64*1024*1024:
                stop("PUBLIC_FETCH_"+name)
            if hashlib.sha256(dest.read_bytes()).hexdigest()!=actual[name]:
                stop("PUBLIC_DISK_MISMATCH_"+name)
        checked+=1
    statuses=set(states.values())
    if statuses<=set(("BASE","UNCHANGED","EXPECTED_ABSENT")):
        verdict="BASELINE_READY_FOR_BACKUP"
    elif statuses<=set(("HEAD","UNCHANGED")):
        verdict="ALREADY_RELEASED"
    else:
        verdict="PARTIAL_RELEASE_STOP"
    print("PUBLIC_BYTES_MATCH_DISK",checked)
    print("FREE_DISK_GT_512M",free>=512*1024)
    print("BACKEND_QUERIES=NONE")
    print("PRODUCTION_FILE_WRITES=NONE")
    print("RESULT="+verdict)
    if verdict=="PARTIAL_RELEASE_STOP":
        stop(verdict)
if __name__=="__main__":
    main()
