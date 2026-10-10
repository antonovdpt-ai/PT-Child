python3 -B - <<'FIZIRA_PRIVATE_SOURCE_TRANSFER'
"""Transport already-collected sources privately; do not audit or execute them."""
import base64
import hashlib
import json
import os
import re
import stat
import subprocess

FILES=('main/index.ts','hello/index.ts','deno.jsonc','delete-account/index.ts')
SNAPSHOT_SHA='fc8fce1695a2df54abc9ffd77bcabe73ad77f0efa15c28dfed3ad7cda230f118'
PUBLIC_CERTIFICATE='-----BEGIN CERTIFICATE-----\nMIIDzzCCAjcCFGc68GsfrO+7b1z28PRqkVKb6iZxMA0GCSqGSIb3DQEBCwUAMCQx\nIjAgBgNVBAMMGUZpemlyYVByaXZhdGVTb3VyY2VSZXZpZXcwHhcNMjYxMDEwMTgz\nNDEwWhcNMjYxMDE3MTgzNDEwWjAkMSIwIAYDVQQDDBlGaXppcmFQcml2YXRlU291\ncmNlUmV2aWV3MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAuT2nZaC2\nqAOTjBhg7EtlbpkxIg+hhv8WuI/OpCPfKvG7aUjTIrIA7EoEtDxs3r61JAWJ4tZ5\n2+7fb3ealAYpcmFR2KsmexztzE2q6SZ/JeZCfNvOZuWmV9RJKeunkfoS77E8xPgL\nIpXkhOKzbL/CLsFPYx9PWWVCnaM+OahDij22YeanVnrCkfEKAKF1LsSQtIeea8T5\n/i4DVeyZpwTiQa7pptAoKmQreggQsAl96onKebKm57W/ehoCwEr7If9mG2sEtN3n\nA6xc083LV6691KCyoEO/5DkciQB5aDvPyQttrExCYpZJ4+bqCkVSPPu3sLyeQFRx\nnYjbm0DvdKETpSwRz9TY5HIbESu0irHfHIbzlhHYjqGbMewIboSucTqH/SvZeMys\ntyijMjhtOxNZxqAowEcPDjGCuYF7YtADhjQvgss3eJpCd6PA9eeDXHzc31fPsQx/\ncu/+7pZIq4ho6gSQjpk3LUX2ks2iQKKFrR9KbPBQUHg7c+qRQgrbxzAdAgMBAAEw\nDQYJKoZIhvcNAQELBQADggGBADl8t/RnOTGTE/3b8GqAHNmARpppcD2rPYFzbCv8\nwLhZXktP0fmngxwXWT8Z9T/hxkTwN7hOqPJQ86PxVgivAfGUZc55lDLohbVYwZy8\nZAUvTTOwk06p0Pyk9+rZFd8xngIxCFynxk2mtQBqiUB9Ua0eTcuj+QT3EbeqnAd3\nzTvTJ1oSBH6B6KrSaOjkPwNAvRLg60qEDov2zfiuIMjWcLIfRMERJcw27X3amW6e\ndB974xD0gukr9JD9Osdahy5LK6flZmLgp9eWZWhGi6/37wA2r3F+47evqBUPAZVT\noeew7S5KxzL9+vhD5p4bRN66vZyuwdoBqddRq2sxgdD3nfMj4CRqkgdRB9uzhj+4\n6gREs+gB5H2ydzE/RknCh+xT1WYpuq/FQTI8ubRWa43mEISf1zu/OYBH42yCtZzJ\ncLW/8HRvf9ls5nCll0tFffKOnHIFgboNMrtNbfkuKQCwQXk2/iGCiWfBGyGU/CF/\nBlM3+XTzUjFN0iQZNsTJ3Whf8A==\n-----END CERTIFICATE-----\n'

class Stop(Exception):pass

def require(ok,label):
    if not ok:raise Stop(label)

def digest(data):return hashlib.sha256(data).hexdigest()

def bundle(data,expected=SNAPSHOT_SHA):
    snapshot=data['snapshot']
    require(digest(json.dumps(snapshot,sort_keys=True,separators=(',',':')).encode())==expected and data.get('snapshotSha256')==expected,'STORED_SNAPSHOT_IDENTITY_STOP')
    require(set(snapshot['environment'])=={'VERIFY_JWT','SUPABASE_URL','SUPABASE_PUBLIC_URL','FIZIRA_ALLOWED_ORIGINS'},'RAW_ENVIRONMENT_REFUSED_STOP')
    require(set(snapshot['secretPresence'])=={'JWT_SECRET','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'} and all(isinstance(v,bool) for v in snapshot['secretPresence'].values()),'SECRET_VALUES_REFUSED_STOP')
    sources=data['reviewSources']
    require(set(sources)==set(FILES),'SOURCE_SET_STOP')
    selected={}
    for name in FILES:
        source=sources[name]['source']
        require(isinstance(source,str) and len(source.encode())<=96*1024,'SOURCE_SIZE_STOP')
        sha=digest(source.encode())
        require(sha==sources[name]['sha256']==snapshot['runtimeFiles'][name],'STORED_SOURCE_IDENTITY_STOP')
        selected[name]={'sha256':sha,'source':source}
    return {'schemaVersion':1,'purpose':'PRIVATE_FULL_SOURCE_REVIEW_NOT_RELEASE_APPROVAL',
            'snapshotSha256':expected,'snapshot':snapshot,'reviewSources':selected}

def seal(clear,certificate):
    read_fd,write_fd=os.pipe()
    try:
        require(len(certificate)<=4096,'CERTIFICATE_SIZE_STOP')
        os.write(write_fd,certificate)
        os.close(write_fd);write_fd=-1
        result=subprocess.run(['/usr/bin/openssl','cms','-encrypt','-binary','-aes-256-gcm','-outform','DER',
                               '-recip','/proc/self/fd/'+str(read_fd),'-keyopt','rsa_padding_mode:oaep','-keyopt','rsa_oaep_md:sha256'],
                              input=clear,capture_output=True,pass_fds=(read_fd,),timeout=20,
                              env={'PATH':'/usr/bin:/bin','OPENSSL_CONF':'/dev/null'})
        require(result.returncode==0 and 0<len(result.stdout)<=1024*1024,'LOCAL_ENCRYPTION_STOP')
        return result.stdout
    finally:
        os.close(read_fd)
        if write_fd>=0:os.close(write_fd)

def error_label(exc):
    return str(exc) if isinstance(exc,Stop) and re.fullmatch('[A-Z_]+',str(exc)) else 'PRIVATE_TRANSFER_STOP'

if __name__=='__main__':
    try:
        fd=os.open('/tmp/fizira-source-review-result.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            require(stat.S_ISREG(os.fstat(fd).st_mode) and os.fstat(fd).st_size<=512*1024,'STORED_INPUT_SIZE_OR_TYPE_STOP')
            with os.fdopen(fd,'rb',closefd=False) as stream:raw=stream.read(512*1024+1)
            require(len(raw)<=512*1024,'STORED_INPUT_SIZE_OR_TYPE_STOP')
        finally:os.close(fd)
        selected=bundle(json.loads(raw))
        sealed=seal(json.dumps(selected,ensure_ascii=False,separators=(',',':')).encode(),PUBLIC_CERTIFICATE.encode())
        encoded=base64.b64encode(sealed).decode('ascii')
        print('BEGIN_FIZIRA_PRIVATE_REVIEW_CMS_BASE64')
        print('\n'.join(encoded[i:i+72] for i in range(0,len(encoded),72)))
        print('END_FIZIRA_PRIVATE_REVIEW_CMS_BASE64')
        print(json.dumps({'encryptedPayloadSha256':digest(sealed),'sourceFiles':4,'rawSourcePrinted':False,'rawEnvironmentPrinted':False,
                          'productionWrites':0,'productionRequests':0,'servicesRestarted':False,'publicationReady':False}))
    except Exception as exc:
        print(json.dumps({'privateTransfer':'STOP','reason':error_label(exc),'productionWrites':0,'publicationReady':False}))
        raise SystemExit(1)

FIZIRA_PRIVATE_SOURCE_TRANSFER
