#!/usr/bin/env python3
"""Independent public HTTPS verification of exact pinned Fizira static assets.

Avoids user/auth data; only unauthenticated GET requests for allowlisted files.
No production writes or backend endpoints. Treat CDN stale/redirect/mismatch as STOP.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time

ORIGIN="https://app.fizira.com"
NEW={"patient-flower.css","patient-flower.mjs","patient-overview.mjs"}

def sha(path):
    digest=hashlib.sha256()
    with open(path,"rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""): digest.update(c)
    return digest.hexdigest()

def verify(pins_path,state,origin=ORIGIN,retries=3):
    pins=json.loads(Path(pins_path).read_text())
    names=pins["assets"]
    expected=pins[state]
    if not (isinstance(names,list) and len(names)==21 and names[-1]=="index.html"
            and set(names)==set(pins["head"])==set(pins["base"])
            and {x for x in names if pins["base"][x] is None}==NEW):
        raise ValueError("INVALID_SOURCE_PINS_STOP")
    if not (origin==ORIGIN or origin.startswith("http://127.0.0.1:")):
        raise ValueError("ORIGIN_NOT_ALLOWLISTED_STOP")
    count=0
    for name in names:
        digest=expected[name]
        if digest is None:
            continue  # New files are absent at base; disk preflight establishes that.
        if not isinstance(digest,str) or not re.fullmatch("[a-f0-9]{64}",digest):
            raise ValueError("INVALID_HASH_STOP")
        path="/" if name=="index.html" else "/"+name
        success=False
        for attempt in range(retries):
            # Fixed query parameter avoids repeated cached copies; no referrer,
            # no auth, no API requests, no redirects, no sensitive output.
            suffix=("-"+str(attempt))
            url=origin+path+"?flower-check="+state+suffix
            with tempfile.TemporaryDirectory(prefix="flower-public-") as tmp:
                dest=Path(tmp)/"asset"
                cmd=["curl","--fail","--silent","--show-error",
                     "--connect-timeout","8","--max-time","20",
                     "--max-redirs","0","--retry","0",
                     "--output",str(dest),"--write-out","%{http_code}",
                     url]
                if origin==ORIGIN:
                    cmd[1:1]=["--proto","=https","--proto-redir","=https"]
                try:
                    result=subprocess.run(cmd,capture_output=True,timeout=25)
                    success=(result.returncode==0 and result.stdout.strip()==b"200"
                             and dest.exists() and dest.stat().st_size<=64*1024*1024
                             and sha(dest)==digest)
                except (OSError,subprocess.TimeoutExpired):
                    success=False
            if success:break
            if attempt+1<retries:
                time.sleep(2)
        if not success:
            raise ValueError("PUBLIC_HASH_MISMATCH_STOP:"+name)
        count+=1
    if count!=(18 if state=="base" else 21):
        raise ValueError("PUBLIC_ASSET_COUNT_STOP")
    print("FLOWER_PUBLIC_SHA256=PASS")
    print("PUBLIC_STATE="+state)
    print("PUBLIC_CHECKED_FILES="+str(count))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--pins",required=True)
    parser.add_argument("--state",choices=("base","head"),required=True)
    args=parser.parse_args()
    try:
        verify(args.pins,args.state)
    except (ValueError,KeyError,TypeError,OSError):
        print("FLOWER_PUBLIC_SHA256=STOP")
        raise SystemExit(1)

if __name__=="__main__":main()
