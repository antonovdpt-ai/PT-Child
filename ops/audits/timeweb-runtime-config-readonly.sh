#!/usr/bin/env bash
# Reads only; no installs, file writes, container exec, restarts or network calls.
python3 -B - <<'FIZIRA_RUNTIME_READ_ONLY_PY'
#!/usr/bin/env python3
"""Read-only self-hosted runtime evidence. Collection never attests release gates."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

SAFE_ENV = ('VERIFY_JWT', 'SUPABASE_URL', 'FIZIRA_ALLOWED_ORIGINS')
SECRET_ENV = ('JWT_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
PACKAGING_SHA = '38f8ea2f213aaf2fdd0484484f313cd09c71ea51df073e07c69a8cbb3d7236e4'


def require(ok, label):
    if not ok:
        raise ValueError(label)


def regular(path, limit=2 * 1024 * 1024):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'SYMLINK_STOP')
    require(path.is_file() and path.stat().st_size <= limit, 'MISSING_OR_INVALID_FILE_STOP')
    return path.read_bytes()


def digest(path):
    return hashlib.sha256(regular(path)).hexdigest()


def runtime_inventory(functions):
    require(not any(p.is_symlink() for p in (functions, *functions.parents)), 'SYMLINK_STOP')
    files = {}
    for count, path in enumerate(functions.rglob('*'), 1):
        require(count <= 1024 and not path.is_symlink(), 'RUNTIME_TREE_UNBOUNDED_OR_SYMLINK_STOP')
        if path.is_dir():
            continue
        # Mounted credential files need a separate private architecture review.
        require(path.name != '.env' and not path.name.startswith('.env.') and
                path.suffix not in ('.pem', '.key'), 'MOUNTED_CREDENTIAL_FILE_REVIEW_STOP')
        files[path.relative_to(functions).as_posix()] = digest(path)
    require(len(files) <= 256, 'RUNTIME_TREE_UNBOUNDED_STOP')
    return dict(sorted(files.items()))


def collect(functions, include_source=False):
    functions = Path(functions)
    require(functions.is_absolute(), 'FUNCTIONS_PATH_STOP')
    # stdout/stderr are retained privately; raw inspection and environment never printed.
    proc = subprocess.run(['docker', 'inspect', 'supabase-edge-functions'],
                          capture_output=True, text=True, timeout=20)
    require(proc.returncode == 0, 'DOCKER_INSPECT_UNAVAILABLE_STOP')
    data = json.loads(proc.stdout)
    require(isinstance(data, list) and len(data) == 1, 'DOCKER_INSPECT_SHAPE_STOP')
    data = data[0]
    cfg = data.get('Config') or {}
    env = dict(item.split('=', 1) for item in cfg.get('Env', []) if '=' in item)
    secret_values = [value for key, value in env.items()
                     if re.search('KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL', key) and value]

    def sanitized(value):
        text = str(value)
        for secret in secret_values:
            text = text.replace(secret, '[REDACTED]')
        return re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED_JWT]', text)

    safe_env = {key: env.get(key) for key in SAFE_ENV}
    for key, value in safe_env.items():
        require(value is None or sanitized(value) == value, 'UNSAFE_ENV_VALUE_STOP')
        if key == 'SUPABASE_URL' and value:
            parsed = urlsplit(value)
            require(parsed.scheme in ('http', 'https') and parsed.hostname and
                    not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
                    'UNSAFE_SUPABASE_URL_STOP')
    mounts = sorted([{'type': m.get('Type'), 'source': m.get('Source'),
                      'destination': m.get('Destination'), 'rw': m.get('RW')}
                     for m in data.get('Mounts', [])], key=lambda m: m['destination'] or '')
    # Pin the complete mounted tree, including router imports, custom import maps
    # and files added later; a fixed list cannot detect indirect dependency drift.
    files = runtime_inventory(functions)
    router_path = functions / 'main/index.ts'
    router_bytes = regular(router_path, 192 * 1024)
    compose_files = (cfg.get('Labels') or {}).get('com.docker.compose.project.config_files', '')
    compose = {'configFiles': [{'path': name, 'sha256': digest(name)}
                               for name in compose_files.split(',') if name]}
    snapshot = {'containerName': str(data.get('Name', '')).lstrip('/'),
                'running': (data.get('State') or {}).get('Running') is True,
                'imageId': data.get('Image'), 'imageTag': cfg.get('Image'),
                'process': {'path': data.get('Path'), 'args': data.get('Args')},
                'mounts': mounts, 'environment': safe_env,
                'secretPresence': {key: bool(env.get(key)) for key in SECRET_ENV},
                'compose': compose,
                'router': {'containerPath': '/home/deno/functions/main/index.ts',
                           'sha256': hashlib.sha256(router_bytes).hexdigest()},
                'runtimeFiles': files}
    # Do not let a wrapper command, labels, paths or arbitrary source disclose keys.
    def safe_values(value):
        if isinstance(value, str):
            return sanitized(value) == value
        if isinstance(value, dict):
            return all(safe_values(k) and safe_values(v) for k, v in value.items())
        if isinstance(value, list):
            return all(safe_values(v) for v in value)
        return True
    require(safe_values(snapshot), 'UNSAFE_RUNTIME_METADATA_STOP')
    evidence = {'snapshot': snapshot, 'publicationReady': False,
                'edgeRuntimeGate': 'NOT_ATTESTED_METADATA_ONLY',
                'sqlVerificationGate': 'NOT_ATTESTED',
                'cliConfigRole': 'REQUIRES_ROUTER_AND_COMMAND_REVIEW'}
    if include_source:
        source = router_bytes.decode('utf-8')
        # Conservative: inline credential assignments need private human review.
        unsafe_literal = re.search(r'''(?i)(?:secret|password|token|api_key)\s*[:=]\s*["'][^"']+["']''', source)
        if unsafe_literal:
            evidence['routerSource'] = 'WITHHELD_INLINE_CREDENTIAL_LITERAL_REVIEW_REQUIRED'
        else:
            evidence['routerSource'] = sanitized(source)
            evidence['routerSourceRedacted'] = sanitized(source) != source
    return evidence


try:
    result=collect(Path('/root/supabase-project/volumes/functions'), include_source=True)
    result['checkedCliConfigPath']='/root/supabase-project/supabase/config.toml'
    cfg=Path(result['checkedCliConfigPath'])
    result['cliConfigAbsent']=not cfg.exists() and not cfg.is_symlink()
    print(json.dumps(result,ensure_ascii=False,indent=2))
except (ValueError,KeyError,TypeError,IndexError,OSError,subprocess.TimeoutExpired) as exc:
    label=str(exc) if isinstance(exc,ValueError) and re.fullmatch('[A-Z_]+',str(exc)) else type(exc).__name__
    print(json.dumps({'runtimeAudit':'STOP','reason':label,'publicationReady':False}))

FIZIRA_RUNTIME_READ_ONLY_PY
