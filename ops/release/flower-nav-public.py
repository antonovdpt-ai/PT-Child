#!/usr/bin/env python3
"""Cache-busted independent public SHA checks for all 21 non-secret static assets."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time

BASE="ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
DELTA={"app.js","patient-flower.css","patient-flower.mjs","index.html"}
ORIGIN="https://app.fizira.com"

def verify(pins_file,state):
    pins=json.loads(Path(pins_file).read_text())
    names=pins["assets"]
    if not (pins["fromCommit"]==BASE and pins["targetVersion"]=="0.188-flower-nav"
            and pins["delta"]==["app.js","patient-flower.css","patient-flower.mjs","index.html"]
            and len(names)==21 and len(set(names))==21 and names[-1]=="index.html"
            and set(names)==set(pins["base"])==set(pins["head"])
            and {n for n in names if pins["base"][n]!=pins["head"][n]}==DELTA):
        raise ValueError("PUBLIC_PINS_STOP")
    expected=pins[state]
    for name in names:
        wanted=expected[name]
        if not isinstance(wanted,str) or not re.fullmatch("[a-f0-9]{64}",wanted):
            raise ValueError("PUBLIC_EXPECTED_HASH_STOP")
        path="/" if name=="index.html" else "/"+name
        matched=False
        for attempt in range(3):
            with tempfile.TemporaryDirectory(prefix="flower-nav-public-") as t:
                out=Path(t)/"file"
                url=ORIGIN+path+"?flower-nav-sha="+state+"-"+str(attempt)
                cmd=["curl","--proto","=https","--proto-redir","=https",
                     "--fail","--silent","--show-error","--max-redirs","0",
                     "--connect-timeout","8","--max-time","20","--retry","0",
                     "--output",str(out),"--write-out","%{http_code}",url]
                try:
                    process=subprocess.run(cmd,capture_output=True,timeout=25)
                    if process.returncode==0 and process.stdout.strip()==b"200" and out.is_file() and out.stat().st_size<=64*1024*1024:
                        matched=hashlib.sha256(out.read_bytes()).hexdigest()==wanted
                except (OSError,subprocess.TimeoutExpired):pass
            if matched:break
            if attempt<2:time.sleep(2)
        if not matched:raise ValueError("PUBLIC_SHA_MISMATCH_STOP:"+name)
    print("FLOWER_NAV_PUBLIC=PASS")
    print("PUBLIC_STATE="+state)
    print("PUBLIC_ASSETS=21")

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--pins",required=True)
    p.add_argument("--state",choices=("base","head"),required=True)
    a=p.parse_args()
    try:verify(a.pins,a.state)
    except (ValueError,KeyError,TypeError,OSError) as exc:
        print("FLOWER_NAV_PUBLIC=STOP",str(exc))
        raise SystemExit(1)
