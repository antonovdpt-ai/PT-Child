#!/usr/bin/env python3
"""Read-only self-hosted runtime evidence. Collection never attests release gates."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

SAFE_ENV = ('VERIFY_JWT', 'SUPABASE_URL', 'SUPABASE_PUBLIC_URL', 'FIZIRA_ALLOWED_ORIGINS')
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
        if key in ('SUPABASE_URL', 'SUPABASE_PUBLIC_URL') and value:
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


def verify(profile, evidence, functions, base, base_dir, head_dir, config):
    require(profile.get('schemaVersion') == 1 and profile.get('status') == 'reviewed' and
            profile.get('mode') == 'self-hosted-bind-mount' and profile.get('sourceBase') == base and
            isinstance(profile.get('reviewEvidence'), str) and bool(profile['reviewEvidence'].strip()),
            'UNREVIEWED_RUNTIME_PROFILE_STOP')
    require(profile.get('cliConfigPath') == str(config), 'UNREVIEWED_CONFIG_PATH_STOP')
    require(not config.exists() and not config.is_symlink() and
            not any(p.is_symlink() for p in config.parents), 'CONFIG_NOT_PROVEN_ABSENT_STOP')
    # Only this known unchanged packaging-only TOML may have a runtime equivalent.
    for root in (base_dir, head_dir):
        require(digest(root / 'supabase/config.toml') == PACKAGING_SHA, 'CLI_CONFIG_SEMANTICS_CHANGED_STOP')
    actual = evidence['snapshot']
    require(actual == profile.get('snapshot'), 'RUNTIME_PROFILE_DRIFT_STOP')
    require(actual['containerName'] == 'supabase-edge-functions' and actual['running'], 'RUNTIME_NOT_RUNNING_STOP')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', actual['imageId'] or '') and
            str(actual['imageTag']).startswith('supabase/edge-runtime:'), 'UNREVIEWED_RUNTIME_IMAGE_STOP')
    process = actual['process']
    require(Path(process['path'] or '').name == 'edge-runtime', 'WRAPPED_RUNTIME_COMMAND_STOP')
    args = process['args'] or []
    require(args and args[0] == 'start' and args.count('--main-service') == 1 and
            args.index('--main-service') + 1 < len(args) and
            args[args.index('--main-service') + 1] == '/home/deno/functions/main' and
            not any('config.toml' in arg or arg == '--config' for arg in args), 'RUNTIME_COMMAND_STOP')
    flags = {'--main-service', '--user-worker-request-idle-timeout', '--port', '--ip'}
    require(len(args) % 2 == 1 and all(args[i] in flags and isinstance(args[i + 1], str)
                                     for i in range(1, len(args), 2)), 'UNSUPPORTED_RUNTIME_FLAG_STOP')
    mount = [m for m in actual['mounts'] if m['destination'] == '/home/deno/functions']
    require(len(mount) == 1 and mount[0]['type'] == 'bind' and
            mount[0]['source'] == str(functions), 'FUNCTIONS_BIND_MOUNT_STOP')
    for m in actual['mounts']:
        dst = m['destination'] or ''
        require(dst == '/home/deno/functions' or
                (not dst.startswith('/home/deno/functions/') and
                 not '/home/deno/functions'.startswith(dst.rstrip('/') + '/')), 'OVERLAPPING_MOUNT_STOP')
    require(re.fullmatch('[a-f0-9]{64}', actual['router']['sha256'] or ''), 'ROUTER_HASH_STOP')
    source = regular(functions / 'main/index.ts').decode('utf-8')
    require('config.toml' not in source, 'ROUTER_REFERENCES_CLI_CONFIG_STOP')
    require(actual['environment']['VERIFY_JWT'] in ('true', 'false') and
            actual['environment']['SUPABASE_URL'] and all(actual['secretPresence'].values()), 'RUNTIME_ENV_INCOMPLETE_STOP')
    public = urlsplit(actual['environment'].get('SUPABASE_PUBLIC_URL') or '')
    # .hostname alone does not reject malformed or out-of-range ports.
    public.port
    require(public.scheme == 'https' and public.hostname and not public.username and
            not public.password and public.path in ('', '/') and not public.query and
            not public.fragment, 'PDF_PUBLIC_ORIGIN_STOP')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--collect', action='store_true')
    parser.add_argument('--functions', default='/root/supabase-project/volumes/functions')
    parser.add_argument('--profile')
    parser.add_argument('--base')
    parser.add_argument('--base-dir')
    parser.add_argument('--head-dir')
    parser.add_argument('--config', default='/root/supabase-project/supabase/config.toml')
    args = parser.parse_args()
    try:
        evidence = collect(Path(args.functions), include_source=args.collect)
        if args.collect:
            print(json.dumps(evidence, ensure_ascii=False, indent=2))
        else:
            require(all((args.profile, args.base, args.base_dir, args.head_dir)), 'PROFILE_ARGUMENTS_STOP')
            profile = json.loads(regular(args.profile, 65536))
            verify(profile, evidence, Path(args.functions), args.base,
                   Path(args.base_dir), Path(args.head_dir), Path(args.config))
            print('REVIEWED_BIND_MOUNT_RUNTIME_MATCH (source/config parity only; runtime gate remains separate)')
    except (ValueError, KeyError, TypeError, IndexError, OSError, subprocess.TimeoutExpired) as exc:
        # Raw Docker stderr and exceptions that might embed source/credentials stay private.
        label = str(exc) if isinstance(exc, ValueError) and re.fullmatch('[A-Z_]+', str(exc)) else type(exc).__name__
        print(json.dumps({'runtimeAudit': 'STOP', 'reason': label, 'publicationReady': False}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
