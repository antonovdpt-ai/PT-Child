python3 -B - <<'FIZIRA_PRIVATE_RUNTIME_REVIEW'
"""Private, non-executing source facts. This cannot approve a security gate."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit

SNAPSHOT_SHA = 'fc8fce1695a2df54abc9ffd77bcabe73ad77f0efa15c28dfed3ad7cda230f118'
FILES = ('main/index.ts', 'deno.jsonc', 'delete-account/index.ts', 'hello/index.ts')
ROOT = Path('/root/supabase-project/volumes/functions')
INPUT = Path('/tmp/fizira-source-review-result.json')

class Stop(Exception):
    pass

def require(ok, label):
    if not ok:
        raise Stop(label)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def snapshot_sha(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())

def read_only(path, limit):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'SYMLINK_STOP')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'INPUT_SIZE_OR_TYPE_STOP')
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, min(65536, limit + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            require(size <= limit, 'INPUT_SIZE_OR_TYPE_STOP')
        after = os.fstat(fd)
        require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'INPUT_CHANGED_DURING_READ_STOP')
        return b''.join(chunks)
    finally:
        os.close(fd)

def lexical_masks(source):
    # Suppress comments/string bodies before counting call-site signals.
    # Template interpolation and regexp literals are NOT analysed as JS control flow.
    code, comments_removed, literals = list(source), list(source), []
    i = 0
    while i < len(source):
        start = i
        if source.startswith('//', i):
            i = source.find('\n', i)
            if i < 0:
                i = len(source)
        elif source.startswith('/*', i):
            end = source.find('*/', i + 2)
            require(end >= 0, 'UNTERMINATED_COMMENT_STOP')
            i = end + 2
        elif source[i] in "\"'`":
            quote = source[i]
            i += 1
            while i < len(source) and source[i] != quote:
                i += 2 if source[i] == '\\' else 1
            require(i < len(source), 'UNTERMINATED_STRING_STOP')
            i += 1
            body = source[start + 1:i - 1]
            literals.append((start, i, body, quote))
            for j in range(start, i):
                if code[j] != '\n':
                    code[j] = ' '
            continue
        else:
            i += 1
            continue
        for j in range(start, i):
            if source[j] != '\n':
                code[j] = comments_removed[j] = ' '
    return ''.join(code), ''.join(comments_removed), literals

def source_signals(source):
    code, _, literals = lexical_masks(source)
    def lines(pattern):
        return [code.count('\n', 0, m.start()) + 1 for m in re.finditer(pattern, code)]
    values = [v for _, _, v, _ in literals]
    cors_pairs = [(v, literals[n + 1][2]) for n, (_, _, v, _) in enumerate(literals[:-1])
                  if v.lower() in ('access-control-allow-origin', 'access-control-allow-credentials')]
    return {
        'analysis': 'LEXICAL_SIGNALS_ONLY_NOT_CONTROL_FLOW_PROOF',
        'remoteUserVerificationLines': lines(r'\.auth\s*\.\s*getUser\s*\('),
        'jwtVerificationNamedCallLines': lines(r'\b(?:jwtVerify|verifyJWT)\s*\(|\bjose\s*\.\s*jwtVerify\s*\('),
        'jwtDecodeOnlyLines': lines(r'\b(?:decodeJwt|decodeJWT)\s*\('),
        'workerCreationLines': lines(r'\b(?:EdgeRuntime\s*\.)?userWorkers\s*\.\s*create\s*\('),
        'workerDispatchLines': lines(r'\bworker\s*\.\s*fetch\s*\('),
        'urlPathReadLines': lines(r'\.\s*pathname\b'),
        'requestBodyReadLines': lines(r'\b(?:req|request)\s*\.\s*(?:json|formData|text)\s*\('),
        'adminDeleteUserLines': lines(r'\.auth\s*\.\s*admin\s*\.\s*deleteUser\s*\('),
        'mutationNamedMethodLines': lines(r'\.\s*(?:insert|upsert|update|delete|remove|upload)\s*\('),
        'fetchCallLines': lines(r'\bfetch\s*\('),
        'dynamicImportLines': lines(r'\bimport\s*\('),
        'dynamicEvaluationLines': lines(r'\beval\s*\(|\bnew\s+Function\s*\('),
        'processExecutionLines': lines(r'\bDeno\s*\.\s*(?:run|Command)\b'),
        'wholeEnvironmentReadLines': lines(r'\bDeno\s*\.\s*env\s*\.\s*toObject\s*\('),
        'errorMessageOrStackReferenceLines': lines(r'\b(?:error|err|e)\s*\.\s*(?:message|stack)\b'),
        'consoleLogLines': lines(r'\bconsole\s*\.\s*(?:log|error|warn)\s*\('),
        'literalWildcardCorsObserved': any(k.lower() == 'access-control-allow-origin' and v == '*' for k, v in cors_pairs),
        'literalCredentialCorsObserved': any(k.lower() == 'access-control-allow-credentials' and v.lower() == 'true' for k, v in cors_pairs),
        'cliConfigLiteralObserved': any('config.toml' in v for v in values),
        'templateLiteralPresent': any(q == '`' for _, _, _, q in literals),
        'guardDominance': 'UNVERIFIED',
        'deleteTargetEqualsAuthenticatedActor': 'UNVERIFIED',
        'transitiveDependenciesReviewed': 'UNVERIFIED',
    }

def import_map_signals(source):
    _, cleaned, literals = lexical_masks(source)
    masked, _, _ = lexical_masks(cleaned)
    chars = list(cleaned)
    for match in re.finditer(r',\s*[}\]]', masked):
        chars[match.start()] = ' '
    def pairs(items):
        out = {}
        for key, value in items:
            require(key not in out, 'JSONC_DUPLICATE_KEY_STOP')
            out[key] = value
        return out
    config = json.loads(''.join(chars), object_pairs_hook=pairs)
    require(isinstance(config, dict), 'JSONC_SHAPE_STOP')
    imports = config.get('imports', {})
    require(isinstance(imports, dict) and len(imports) <= 128 and all(isinstance(v, str) for v in imports.values()), 'IMPORT_MAP_SHAPE_STOP')
    scopes = config.get('scopes', {})
    require(isinstance(scopes, dict) and len(scopes) <= 128, 'IMPORT_MAP_SCOPES_SHAPE_STOP')
    dependencies = list(imports.values())
    for scoped in scopes.values():
        require(isinstance(scoped, dict) and len(scoped) <= 128 and all(isinstance(v, str) for v in scoped.values()), 'IMPORT_MAP_SCOPES_SHAPE_STOP')
        dependencies.extend(scoped.values())
    require(len(dependencies) <= 256, 'IMPORT_MAP_SIZE_STOP')
    counts = {'NPM': 0, 'JSR': 0, 'HTTP': 0, 'HTTPS': 0, 'LOCAL': 0, 'OTHER': 0}
    pinned = credentialed = local_escape = query_or_fragment = 0
    for value in dependencies:
        parsed = urlsplit(value)
        scheme = parsed.scheme.upper()
        kind = scheme if scheme in counts else 'LOCAL' if value.startswith(('./', '../', '/')) else 'OTHER'
        counts[kind] += 1
        pinned += bool(kind in ('NPM', 'JSR') and re.search(r'@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?(?:/|$)', value))
        credentialed += bool(parsed.username or parsed.password)
        query_or_fragment += bool(parsed.query or parsed.fragment)
        local_escape += bool(kind == 'LOCAL' and (value.startswith('/') or '..' in Path(value).parts))
    return {'dependencyCount': len(dependencies), 'topLevelImportCount': len(imports),
            'scopedImportCount': len(dependencies) - len(imports), 'dependencyKinds': counts,
            'fullyPinnedDependencyCount': pinned, 'credentialBearingDependencyCount': credentialed,
            'queryOrFragmentDependencyCount': query_or_fragment,
            'localEscapeReferenceCount': local_escape, 'tasksPresent': bool(config.get('tasks')),
            'externalImportMapReferencePresent': bool(config.get('importMap')),
            'externalConfigReferencePresent': bool(config.get('extends')),
            'permissionsOrImportSemantics': 'UNVERIFIED'}

def build_report(data, root=ROOT, expected=SNAPSHOT_SHA):
    require(isinstance(data, dict), 'STORED_RESULT_SHAPE_STOP')
    snapshot = data.get('snapshot')
    require(isinstance(snapshot, dict) and snapshot_sha(snapshot) == expected and
            data.get('snapshotSha256') == expected, 'CONFIRMED_SNAPSHOT_DRIFT_STOP')
    stored = data.get('reviewSources')
    require(isinstance(stored, dict) and set(stored) == set(FILES), 'SOURCE_SET_STOP')
    files = snapshot['runtimeFiles']
    require(isinstance(files, dict) and len(files) == 17 and all(re.fullmatch('[a-f0-9]{64}', v or '') for v in files.values()), 'INVENTORY_SHAPE_STOP')
    output, retained = {}, {}
    for name in FILES:
        item = stored[name]
        source = item['source']
        require(isinstance(source, str) and len(source.encode()) <= 96 * 1024, 'SOURCE_SIZE_STOP')
        require(sha(source.encode()) == item['sha256'] == files.get(name), 'STORED_SOURCE_DRIFT_STOP')
        live = read_only(root / name, 96 * 1024)
        require(sha(live) == item['sha256'], 'LIVE_SOURCE_DRIFT_STOP')
        retained[name] = sha(live)
        output[name] = {'sha256': retained[name], 'bytes': len(live), 'lines': len(source.splitlines()),
                        'signals': import_map_signals(source) if name == 'deno.jsonc' else source_signals(source)}
    require(snapshot['router']['sha256'] == retained['main/index.ts'], 'ROUTER_IDENTITY_STOP')
    process, env, mounts = snapshot['process'], snapshot['environment'], snapshot['mounts']
    args = process['args']
    flags = {'--main-service', '--user-worker-request-idle-timeout', '--port', '--ip'}
    direct = (Path(process['path']).name == 'edge-runtime' and isinstance(args, list) and
              len(args) % 2 == 1 and args[0] == 'start' and args.count('--main-service') == 1 and
              all(args[i] in flags and isinstance(args[i+1], str) for i in range(1, len(args), 2)) and
              args[args.index('--main-service') + 1] == '/home/deno/functions/main')
    selected = [m for m in mounts if m['destination'] == '/home/deno/functions']
    bound = len(selected) == 1 and selected[0]['type'] == 'bind' and selected[0]['source'] == str(root)
    overlap = any(m['destination'] != '/home/deno/functions' and
                  (m['destination'].startswith('/home/deno/functions/') or
                   '/home/deno/functions'.startswith(m['destination'].rstrip('/') + '/')) for m in mounts)
    public = urlsplit(env.get('SUPABASE_PUBLIC_URL') or '')
    public.port  # Reject malformed ports without emitting the exception body.
    public_ok = bool(public.scheme == 'https' and public.hostname and not public.username and
                     not public.password and public.path in ('', '/') and not public.query and not public.fragment)
    runtime_ok = (snapshot['running'] is True and snapshot['containerName'] == 'supabase-edge-functions' and
                  snapshot['imageTag'] == 'supabase/edge-runtime:v1.76.2' and
                  bool(re.fullmatch('sha256:[a-f0-9]{64}', snapshot['imageId'] or '')) and direct and bound and not overlap)
    require(runtime_ok, 'CAPTURED_RUNTIME_ARCHITECTURE_STOP')
    for name, digest in retained.items():
        require(sha(read_only(root / name, 96 * 1024)) == digest, 'SOURCE_CHANGED_DURING_REVIEW_STOP')
    return {'schemaVersion': 1, 'snapshotSha256': expected, 'sourceIdentity': 'PASS',
            'capturedRuntimeArchitecture': 'PASS',
            'runtimeFacts': {'directMainService': direct, 'functionsBindMount': bound,
                             'overlappingFunctionsMount': overlap, 'runtimeFileCount': len(files),
                             'composeFileCount': len(snapshot['compose']['configFiles']),
                             'jwtSettingRecognized': env.get('VERIFY_JWT') in ('true', 'false'),
                             'requiredSecretPresence': all(snapshot['secretPresence'].get(k) is True for k in ('JWT_SECRET','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY')),
                             'publicStorageOriginValid': public_ok,
                             'originPolicyConfigured': bool(env.get('FIZIRA_ALLOWED_ORIGINS'))},
            'sourceFacts': output,
            'independentSecurityReview': 'UNVERIFIED', 'edgeRuntimeGate': 'UNVERIFIED',
            'remainingReview': ['ROUTING_AND_PATH_CONFINEMENT', 'JWT_VERIFICATION_AND_DENIAL_DOMINANCE',
                                'ADMIN_WRITE_AUTHORIZATION_AND_DELETE_TARGET', 'CORS_POLICY_AND_ERROR_DISCLOSURE',
                                'IMPORT_MAP_AND_TRANSITIVE_DEPENDENCY_CLOSURE', 'ACTUAL_PDF_AUTH_STORAGE_RUNTIME'],
            'rawSourcePrinted': False, 'environmentValuesPrinted': False,
            'productionWrites': 0, 'servicesRestarted': False, 'publicationReady': False}

def stop_report(exc):
    label = str(exc) if isinstance(exc, Stop) and re.fullmatch('[A-Z_]+', str(exc)) else 'PRIVATE_ANALYSIS_ERROR_STOP'
    return {'sourceIdentity': 'FAIL', 'independentSecurityReview': 'UNVERIFIED', 'reason': label,
            'productionWrites': 0, 'servicesRestarted': False, 'publicationReady': False}

if __name__ == '__main__':
    try:
        report = build_report(json.loads(read_only(INPUT, 512 * 1024)))
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except Exception as exc:
        print(json.dumps(stop_report(exc)))
        raise SystemExit(1)

FIZIRA_PRIVATE_RUNTIME_REVIEW
