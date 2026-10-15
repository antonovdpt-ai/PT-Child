#!/usr/bin/env python3
"""Read-only anonymous public checksum audit of 21 Fizira static assets."""
import argparse, hashlib, json, pathlib, time, urllib.request, urllib.error
ORIGIN="https://app.fizira.com"
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def check(pins,state):
    values=json.loads(pathlib.Path(pins).read_text())
    assert state in ("base","head") and len(values["assets"])==21
    opener=urllib.request.build_opener(NoRedirect)
    for n in values["assets"]:
        want=values[state][n]
        path="/" if n=="index.html" else "/"+n
        for i in range(3):
            url=ORIGIN+path+"?flower-nav-audit="+state+"-"+str(i)
            try:
                with opener.open(urllib.request.Request(url,headers={"Cache-Control":"no-cache"}),timeout=15) as resp:
                    assert resp.status==200 and resp.geturl()==url
                    raw=resp.read(64*1024*1024+1)
                    assert len(raw)<=64*1024*1024
                    if hashlib.sha256(raw).hexdigest()==want:break
            except (urllib.error.URLError,TimeoutError,AssertionError):pass
            if i<2:time.sleep(2)
        else:raise ValueError("PUBLIC_MISMATCH_STOP:"+n)
    print("FLOWER_NAV_PUBLIC_"+state.upper()+"_21=PASS")
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--pins",required=True)
    p.add_argument("--state",choices=("base","head"),required=True)
    a=p.parse_args()
    check(a.pins,a.state)
