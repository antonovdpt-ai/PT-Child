#!/usr/bin/env python3
"""Root console installer: pinned code delta only; no data/configuration changes."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

RELEASE = '13f0e51fcec44f2fc096da3824ff51c84c3aa4e0'
ROOT = Path('/root/supabase-project')
# Manifest is generated from the reviewed Git objects, never from live data.
MANIFEST = [{'path': 'app.js',
  'base': '6429f87320adba26883de52f5c626a13468b7eb1330c70ec3904d8aece242e7b',
  'head': '40f47bdd8bff5cb532bacab291f8866b8d6598af9030d0a9ddecce45f5016b43'},
 {'path': 'cabinet.js',
  'base': 'eb1ab8004d792d7178a6b916dca327a18330fd4540d15fb5f72796d2e28f7ff4',
  'head': 'eb1ab8004d792d7178a6b916dca327a18330fd4540d15fb5f72796d2e28f7ff4'},
 {'path': 'styles.css',
  'base': '6b4113558346142907d0aa4a9e3db7572700ae522585a526614855f3024a1125',
  'head': 'd4f45909147b41b766aa7be7db7111b3ab117734223a5dc096d58fa44f7f5830'},
 {'path': 'media-fallback.css',
  'base': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975',
  'head': 'bc5a6b19c92696fbabf546d700d2011998d5d7733ce452687636d766afcd1975'},
 {'path': 'auth-domain.mjs',
  'base': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f',
  'head': 'b902755b2064814f679c60a1db0bc5b5be491a5537d735a1ebd4d94ed4624c8f'},
 {'path': 'schedule-domain.mjs',
  'base': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625',
  'head': '7d5a23ff85b15c775bc2463be0d91b988a1cfe1c22e0ace921450100a3a51625'},
 {'path': 'schedule-editor.js',
  'base': '95066df029061e727e2b6e2092f6c17705e931abe6555320dcbdcbc3a89cd81b',
  'head': '95066df029061e727e2b6e2092f6c17705e931abe6555320dcbdcbc3a89cd81b'},
 {'path': 'security-utils.mjs',
  'base': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f',
  'head': 'e5be09693f572215e3439c17851bd0cf0d1774285e8a4c6eeed08209af77423f'},
 {'path': 'role-gate.mjs',
  'base': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85',
  'head': '11872be290c68285d4845dabede1a5f07aaaef4d3d9f2dd18d41f8b30360cf85'},
 {'path': 'parent.html',
  'base': '6753f9ba0039a2c578a5fd7943e212999954072cc85f99f3f0d12d420ddc33c6',
  'head': '0d1fa71b59cd0d360f30f08dde9ffc784aa0ac797f8a39ef27ce1ff813256b02'},
 {'path': 'parent.js',
  'base': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0',
  'head': '186cd708ed7b4fe1005c1d515288bf0c38e4b6f6821b5f3f9cbaaae8987811f0'},
 {'path': 'parent.css',
  'base': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a',
  'head': 'b9a86a9201ce5e309d8e2db4943202096e94e1300fd6f5f8917fdf7474ef383a'},
 {'path': 'parent-domain.mjs',
  'base': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322',
  'head': 'e9118f5613166ee0476cb42059d0f019fa3a689ac45c57476f615b74e8733322'},
 {'path': 'parent-specialist.js',
  'base': 'b3b467467814463f48e1879c8b3f39630615e8fd878cda063b0f4a6d547fccb2',
  'head': 'd09b2242176247c6c563de4453fe093c4cd90a8e6ad8c0d7b196bc5768232d21'},
 {'path': 'report-pdf-export.mjs',
  'base': None,
  'head': '913b140a0e57975e5df7fa4a9634910091a659c9e24b3c7569f38b2fb5b4e4a6'},
 {'path': 'favicon.ico',
  'base': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0',
  'head': 'b36370b5afc4c3306ce9fe5a0f1535c5cab0be19db3e6e11475e76f6684ca5b0'},
 {'path': 'fizira-symbol.png',
  'base': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726',
  'head': 'f80f7c4aac35d56218cdc9e2d2f68d60d100915dcabbad6fd711d7525f137726'},
 {'path': 'index.html',
  'base': '040bf130f4713ef8584332742cc52b42a2a81a1a8e72577d326794413e139723',
  'head': 'ee137d71d18672111627550cc83b4c93e0aac2a6b465f09877f35f69870fd6fa'},
 {'path': 'supabase/functions/_shared/ai-helpers.ts',
  'base': '4c96d0c10bcd50cd5b07bd511790a28960a29bff250ac743584da398a60e1451',
  'head': '7c9e08ada04c6341f4d5c64de4f9c964cfc2d8a32860bd99101906737a07e5e8'},
 {'path': 'supabase/functions/ptchild-ai/index.ts',
  'base': '7050d95cca53769a1433f73443d553a80a2b9d824f5688299747e8bf5a81d4c9',
  'head': '6181b7de17b9da29a8f7fe20dbb7a3e8c3e94408ca2cce2206f1e24e462308b6'},
 {'path': 'supabase/functions/create-parent-invitation/index.ts',
  'base': 'f1d5c288d61638aa8b86f9cb21765518c32419823bae2bbddaa704d896b6bb64',
  'head': 'f1d5c288d61638aa8b86f9cb21765518c32419823bae2bbddaa704d896b6bb64'},
 {'path': 'supabase/functions/resend-parent-invitation/index.ts',
  'base': '2dc3a0aec24a0a1f70b6c2eb338f2136679a6fb8c64ea3748445c335c2bdd3fc',
  'head': '2dc3a0aec24a0a1f70b6c2eb338f2136679a6fb8c64ea3748445c335c2bdd3fc'},
 {'path': 'supabase/functions/revoke-parent-access/index.ts',
  'base': 'dbbe1d087d81ce3c9a4d1d17a7a519c18181d483a8b8730fb884b34199eedab9',
  'head': 'dbbe1d087d81ce3c9a4d1d17a7a519c18181d483a8b8730fb884b34199eedab9'},
 {'path': 'supabase/functions/generate-parent-report-pdf/index.ts',
  'base': '6a350fc2940df98a222d77684ef5bf6b8486eec444f40775b49a24936ff56872',
  'head': '6a350fc2940df98a222d77684ef5bf6b8486eec444f40775b49a24936ff56872'},
 {'path': 'supabase/functions/parent-report-file/index.ts',
  'base': '0cda79db0873d2f8fe1d101bc9f203673307ddd22d2fe120a5bdddf5fdff5df8',
  'head': '0cda79db0873d2f8fe1d101bc9f203673307ddd22d2fe120a5bdddf5fdff5df8'},
 {'path': 'supabase/functions/_shared/parent-portal.ts',
  'base': 'ad75573bb150e94443f862a259e42ba4cf6b79276cf4bf921bfa8bd6242a8db4',
  'head': 'ad75573bb150e94443f862a259e42ba4cf6b79276cf4bf921bfa8bd6242a8db4'},
 {'path': 'supabase/functions/_shared/parent-publication.ts',
  'base': '06bdf278bc2e52c662b69692246e911e70b0a98c91c39920ac9dd79bfc613924',
  'head': '6f0d5aaf95dd5c85be672bc21baf7fcfa049657ec73e27490e4b5ab82f144bc0'},
 {'path': 'supabase/functions/_shared/parent-pdf.ts',
  'base': '810baf02e3492d6c467112e680d5c785f5a00c50fc8ae9deefeda71992aee20f',
  'head': '810baf02e3492d6c467112e680d5c785f5a00c50fc8ae9deefeda71992aee20f'},
 {'path': 'supabase/functions/_shared/font-data.ts',
  'base': '98186e6ed21fbf0a6df1eb748c60acf3d390889ddf69f9d304c3b234cd2e8fd8',
  'head': '98186e6ed21fbf0a6df1eb748c60acf3d390889ddf69f9d304c3b234cd2e8fd8'},
 {'path': 'supabase/functions/_shared/fonts/NotoSans-Regular.ttf',
  'base': 'f5f552c8c5edb61fe6efb824baf4d4de47b1a8689ab4925ff43f7bd6a4ebece5',
  'head': 'f5f552c8c5edb61fe6efb824baf4d4de47b1a8689ab4925ff43f7bd6a4ebece5'},
 {'path': 'supabase/functions/_shared/fonts/OFL.txt',
  'base': '3c200cfde6940eb9e953af2ceb44b3a8011df285a11f16fdf447aecf8339ae67',
  'head': '3c200cfde6940eb9e953af2ceb44b3a8011df285a11f16fdf447aecf8339ae67'}]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_path(path):
    for part in (path, *path.parents):
        if part.is_symlink():
            raise RuntimeError('SYMLINK_STOP ' + str(path))
    if path.exists() and not path.is_file():
        raise RuntimeError('NON_FILE_STOP ' + str(path))


def validate_live(manifest, target):
    for row in manifest:
        path = target(row['path'])
        safe_path(path)
        actual = digest(path) if path.exists() else None
        if actual not in (row['base'], row['head']):
            raise RuntimeError('UNKNOWN_LIVE_STOP ' + row['path'])


def atomic_write(path, data, metadata=None):
    safe_path(path)
    fd, name = tempfile.mkstemp(prefix='.fizira-release-', dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        reference = metadata or (path if path.exists() else None)
        if reference:
            stat = reference.stat()
            shutil.copystat(reference, temp)
            os.chown(temp, stat.st_uid, stat.st_gid)
        else:
            # New public JS module has the same ownership as the existing app.
            reference = path.parent / 'app.js'
            stat = reference.stat() if reference.is_file() else path.parent.stat()
            os.chown(temp, stat.st_uid, stat.st_gid)
            os.chmod(temp, 0o644)
        os.replace(temp, path)
        dirfd = os.open(path.parent, os.O_DIRECTORY)
        try: os.fsync(dirfd)
        finally: os.close(dirfd)
    finally:
        if temp.exists(): temp.unlink()


def backup_files(manifest, target, backup):
    validate_live(manifest, target)
    before = {}
    for row in manifest:
        p = row['path']; live = target(p)
        before[p] = digest(live) if live.exists() else None
        if live.exists():
            saved = backup / 'files' / p
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(live, saved)
            stat = live.stat(); os.chown(saved, stat.st_uid, stat.st_gid)
            if digest(saved) != before[p]: raise RuntimeError('BACKUP_VERIFY_STOP ' + p)
    (backup / 'before.json').write_text(json.dumps(before, indent=2) + '\n')
    (backup / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    validate_live(manifest, target)
    for p, old in before.items():
        live = target(p)
        if (digest(live) if live.exists() else None) != old:
            raise RuntimeError('LIVE_CHANGED_DURING_BACKUP_STOP ' + p)
    (backup / 'complete').write_text(RELEASE + '\n')
    return before


def restore_files(before, manifest, target, backup):
    # Verify every live/backup byte before restoring anything.
    for row in manifest:
        p = row['path']; live = target(p); safe_path(live)
        actual = digest(live) if live.exists() else None
        if actual not in (before[p], row['head']):
            raise RuntimeError('UNKNOWN_LIVE_ROLLBACK_STOP ' + p)
        if before[p] is not None:
            saved = backup / 'files' / p; safe_path(saved)
            if digest(saved) != before[p]: raise RuntimeError('CORRUPT_BACKUP_STOP ' + p)
    ordered = sorted(manifest, key=lambda r: r['path'] != 'index.html')
    for row in ordered:
        p = row['path']; live = target(p)
        if before[p] is None:
            if live.exists(): live.unlink()
        else:
            saved = backup / 'files' / p
            atomic_write(live, saved.read_bytes(), metadata=saved)
    for p, old in before.items():
        live = target(p)
        if (digest(live) if live.exists() else None) != old:
            raise RuntimeError('ROLLBACK_VERIFY_STOP ' + p)


def activate(manifest, stage, target, backup, restart, check_dependencies=lambda: None):
    # Verify all downloaded files before backup or live changes.
    for row in manifest:
        if hashlib.sha256(stage[row['path']]).hexdigest() != row['head']:
            raise RuntimeError('STAGE_HASH_STOP ' + row['path'])
    check_dependencies()
    before = backup_files(manifest, target, backup)
    print('REPORT_EXPORT_BACKUP_OK', str(backup), flush=True)
    mutated = False
    try:
        for row in manifest:
            if row['path'].startswith('supabase/functions/'):
                live = target(row['path'])
                if (digest(live) if live.exists() else None) != before[row['path']]:
                    raise RuntimeError('LIVE_CHANGED_STOP ' + row['path'])
                mutated = True; atomic_write(live, stage[row['path']])
        restart()
        ordered = sorted((r for r in manifest if not r['path'].startswith('supabase/functions/')), key=lambda r: r['path'] == 'index.html')
        for row in ordered:
            live = target(row['path'])
            if (digest(live) if live.exists() else None) != before[row['path']]:
                raise RuntimeError('LIVE_CHANGED_STOP ' + row['path'])
            mutated = True; atomic_write(live, stage[row['path']])
        for row in manifest:
            if digest(target(row['path'])) != row['head']:
                raise RuntimeError('INSTALLED_HASH_STOP ' + row['path'])
        check_dependencies()
    except BaseException:
        if mutated:
            try:
                restore_files(before, manifest, target, backup)
                restart()
                print('REPORT_EXPORT_ROLLBACK_OK', flush=True)
            except BaseException:
                print('ROLLBACK_NEEDS_OPERATOR_KEEP_BACKUP', str(backup), flush=True)
        raise


def docker(*args):
    # Never print docker inspect configuration/environment or application logs.
    result = subprocess.run(['docker', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if result.returncode: raise RuntimeError('DOCKER_COMMAND_STOP ' + args[0])
    return result.stdout.decode().strip()


def runtime_preflight():
    ids = docker('ps', '-q', '--filter', 'label=com.docker.compose.service=functions').split()
    if len(ids) != 1: raise RuntimeError('EXPECTED_ONE_RUNNING_FUNCTIONS_CONTAINER_STOP')
    container = ids[0]
    mounts = json.loads(docker('inspect', '--format', '{{json .Mounts}}', container))
    if not any(m.get('Source') == str(ROOT / 'volumes/functions') and m.get('Destination') == '/home/deno/functions' and m.get('Type') == 'bind' for m in mounts):
        raise RuntimeError('EXISTING_FUNCTIONS_MOUNT_STOP')
    return container


def probe_gateway():
    for function in ('generate-parent-report-pdf', 'parent-report-file', 'ptchild-ai'):
        req = urllib.request.Request('https://auth.fizira.com/functions/v1/' + function, data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=15) as response: status = response.status
        except urllib.error.HTTPError as exc: status = exc.code; exc.close()
        if status not in (401, 403): raise RuntimeError('FUNCTION_GATEWAY_STATUS_STOP ' + function + ' ' + str(status))


def restart_runtime(container):
    docker('restart', container)
    stable = 0
    for _ in range(15):
        state = json.loads(docker('inspect', '--format', '{{json .State}}', container))
        health = state.get('Health', {}).get('Status')
        if state.get('Running') and not state.get('Restarting') and health in (None, 'healthy'):
            stable += 1
            if stable >= 2:
                try:
                    probe_gateway()
                except (RuntimeError, urllib.error.URLError, TimeoutError, OSError):
                    print('WAITING_FOR_FUNCTION_GATEWAY', flush=True)
                else:
                    print('EXISTING_EDGE_RUNTIME_READY', flush=True)
                    return
        else:
            stable = 0
        time.sleep(2)
    raise RuntimeError('EDGE_READINESS_TIMEOUT_STOP')


def production_target(p):
    if p.startswith('supabase/functions/'):
        return ROOT / 'volumes/functions' / p.removeprefix('supabase/functions/')
    return ROOT / 'volumes/proxy/app' / p


def main():
    if os.geteuid() != 0: raise RuntimeError('ROOT_REQUIRED_STOP')
    if ROOT.is_symlink() or not ROOT.is_dir(): raise RuntimeError('EXISTING_PROJECT_REQUIRED_STOP')
    lock_path = ROOT / '.report-export-install.lock'
    safe_path(lock_path)
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        validate_live(MANIFEST, production_target)
        container = runtime_preflight()
        probe_gateway()
        changed = [r for r in MANIFEST if r['base'] != r['head']]
        if all(production_target(r['path']).is_file() and digest(production_target(r['path'])) == r['head'] for r in changed):
            restart_runtime(container)
            print('REPORT_EXPORT_CODE_INSTALLED_OK', RELEASE, flush=True)
            print('MANUAL_REPORT_PDF_CHECK_REQUIRED', flush=True)
            return
        stage = {}
        for row in changed:
            url = 'https://raw.githubusercontent.com/antonovdpt-ai/PT-Child/' + RELEASE + '/' + row['path']
            with urllib.request.urlopen(url, timeout=30) as response: stage[row['path']] = response.read()
            if hashlib.sha256(stage[row['path']]).hexdigest() != row['head']:
                raise RuntimeError('DOWNLOAD_HASH_STOP ' + row['path'])
        print('REPORT_EXPORT_PREFLIGHT_OK', flush=True)
        backup_root = Path('/root/fizira-code-backups')
        if backup_root.is_symlink(): raise RuntimeError('BACKUP_SYMLINK_STOP')
        backup_root.mkdir(mode=0o700, exist_ok=True)
        os.chmod(backup_root, 0o700)
        backup = Path(tempfile.mkdtemp(prefix='report-export-13f0e51-', dir=backup_root))
        # Keep the exact installer next to its code-only backup for operator recovery.
        shutil.copy2(__file__, backup / 'installer.py')
        activate(changed, stage, production_target, backup, lambda: restart_runtime(container),
                 check_dependencies=lambda: validate_live(MANIFEST, production_target))
        validate_live(MANIFEST, production_target)
        (backup / 'installed').write_text(RELEASE + '\n')
        print('REPORT_EXPORT_CODE_INSTALLED_OK', RELEASE, flush=True)
        print('BACKUP', str(backup), flush=True)
        print('MANUAL_REPORT_PDF_CHECK_REQUIRED', flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print('INSTALL_STOP', str(exc), flush=True)
        raise SystemExit(1)
