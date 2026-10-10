#!/usr/bin/env python3
"""Complete frontend copy and integrity checks; no live writes or service calls."""
import argparse
import hashlib
import json
import os
import re
import secrets
import stat
from pathlib import Path


def require(ok, label):
    if not ok:
        raise ValueError(label)


def safe(path):
    path = Path(os.path.abspath(path))
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'SYMLINK_STOP')
    return path


def open_nofollow(path, flags, mode=0o600):
    """Anchor every parent and the final component; never traverse a link."""
    path = safe(path)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = parent
        return os.open(path.name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, mode, dir_fd=fd)
    finally:
        os.close(fd)


def metadata(info):
    return {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid,
            'gid': info.st_gid, 'mtimeNs': info.st_mtime_ns}


def hash_fd(fd):
    before = os.fstat(fd)
    require(stat.S_ISREG(before.st_mode) and before.st_size <= 64 * 1024 * 1024, 'INVALID_FILE_STOP')
    os.lseek(fd, 0, os.SEEK_SET)
    h = hashlib.sha256()
    for chunk in iter(lambda: os.read(fd, 65536), b''):
        h.update(chunk)
    after = os.fstat(fd)
    require((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns), 'FILE_CHANGED_DURING_READ_STOP')
    return h.hexdigest()


def sha(path):
    fd = open_nofollow(path, os.O_RDONLY)
    try:
        return hash_fd(fd)
    finally:
        os.close(fd)


def copy_fd(source, dest, expected):
    before = os.fstat(source)
    require(hash_fd(source) == expected, 'SOURCE_BYTES_CHANGED_STOP')
    os.lseek(source, 0, os.SEEK_SET)
    for chunk in iter(lambda: os.read(source, 65536), b''):
        remaining = memoryview(chunk)
        while remaining:
            remaining = remaining[os.write(dest, remaining):]
    require(hash_fd(dest) == expected and metadata(os.fstat(source)) == metadata(before), 'COPIED_BYTES_CHANGED_STOP')
    os.fchmod(dest, stat.S_IMODE(before.st_mode))
    current = os.fstat(dest)
    if (current.st_uid, current.st_gid) != (before.st_uid, before.st_gid):
        os.fchown(dest, before.st_uid, before.st_gid)
    os.utime(dest, ns=(before.st_atime_ns, before.st_mtime_ns))
    os.fsync(dest)


def copy_checked(source, dest, expected):
    src = open_nofollow(source, os.O_RDONLY)
    try:
        dst = open_nofollow(dest, os.O_RDWR | os.O_CREAT | os.O_EXCL)
        try:
            copy_fd(src, dst, expected)
        finally:
            os.close(dst)
    finally:
        os.close(src)


def directory_metadata(root, directories):
    result = {}
    for name in directories:
        fd = open_nofollow(root / name, os.O_RDONLY | os.O_DIRECTORY)
        try:
            result[name] = metadata(os.fstat(fd))
        finally:
            os.close(fd)
    return result


def assets(path):
    names = safe(path).read_text().splitlines()
    require(0 < len(names) <= 100 and len(names) == len(set(names)) and
            all(re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]*', n) for n in names), 'ASSET_LIST_STOP')
    return names


def inventory(root):
    root = safe(root)
    require(root.is_dir(), 'MISSING_TREE_STOP')
    files, dirs, total = {}, ['.'], 0
    for count, path in enumerate(sorted(root.rglob('*')), 1):
        require(count <= 4096, 'UNBOUNDED_TREE_STOP')
        safe(path)
        name = path.relative_to(root).as_posix()
        require('\n' not in name and '\r' not in name and '\t' not in name, 'UNSAFE_FILENAME_STOP')
        if path.is_dir():
            dirs.append(name)
            continue
        require(path.is_file(), 'NONREGULAR_FILE_STOP')
        before = path.stat()
        total += before.st_size
        require(total <= 1024 * 1024 * 1024, 'UNBOUNDED_TREE_STOP')
        digest = sha(path)
        after = path.stat()
        require((before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns), 'FILE_CHANGED_DURING_READ_STOP')
        files[name] = {'sha256': digest, 'bytes': before.st_size,
                       'mode': stat.S_IMODE(before.st_mode), 'uid': before.st_uid,
                       'gid': before.st_gid, 'mtimeNs': before.st_mtime_ns}
    return files, dirs


def rows(path, names, absent=False):
    require(safe(path).is_file() and path.stat().st_size <= 65536, 'INVALID_TSV_STOP')
    result = {}
    for line in path.read_text().splitlines():
        name, value = line.split('\t')
        require(name in names and name not in result and
                (re.fullmatch('[a-f0-9]{64}', value) or absent and value == 'ABSENT'), 'INVALID_TSV_STOP')
        result[name] = value
    require(set(result) == set(names), 'INCOMPLETE_TSV_STOP')
    return result


def verify(backup, names, expected=None):
    backup = safe(backup)
    manifest = backup / 'manifest.sha256'
    digest = sha(manifest)
    require(expected is None or digest == expected, 'OPERATOR_MANIFEST_HASH_STOP')
    require(safe(backup / 'complete').read_text() == digest + '\n', 'INCOMPLETE_SNAPSHOT_STOP')
    lines = manifest.read_text().splitlines()
    require(len(lines) == 3, 'SNAPSHOT_MANIFEST_STOP')
    for line, name in zip(lines, ('snapshot.json', 'before.tsv', 'release.tsv')):
        require(line == sha(backup / name) + '  ' + name, 'SNAPSHOT_MANIFEST_STOP')
    snapshot = json.loads((backup / 'snapshot.json').read_text())
    require(snapshot['schemaVersion'] == 1, 'SNAPSHOT_SCHEMA_STOP')
    files, directories = inventory(backup / 'files')
    require(files == snapshot['files'] and directories == snapshot['directories'], 'COPIED_TREE_INTEGRITY_STOP')
    require(directory_metadata(backup / 'files', directories) == snapshot['directoryMetadata'], 'COPIED_DIRECTORY_METADATA_STOP')
    require(stat.S_IMODE(backup.stat().st_mode) == 0o700, 'BACKUP_PRIVACY_MODE_STOP')
    before = rows(backup / 'before.tsv', names, absent=True)
    rows(backup / 'release.tsv', names)
    for name in names:
        require(before[name] == files.get(name, {}).get('sha256', 'ABSENT'), 'BEFORE_MANIFEST_STOP')
    return {'snapshot': 'FRONTEND_SNAPSHOT_VERIFIED', 'files': len(files),
            'bytes': sum(f['bytes'] for f in files.values()), 'manifestSha256': digest}


def create(target, stage, backup, names):
    target, stage, backup = safe(target), safe(stage), safe(backup)
    require(target.is_dir() and stage.is_dir(), 'SOURCE_DIRECTORY_STOP')
    require(not any(a == b or a in b.parents or b in a.parents
                    for a, b in ((target, backup), (stage, backup), (target, stage))), 'OVERLAPPING_PATHS_STOP')
    released = {name: sha(stage / name) for name in names}
    files, directories = inventory(target)
    dir_meta = directory_metadata(target, directories)
    if backup.exists():
        require(backup.is_dir() and not any(backup.iterdir()), 'SNAPSHOT_REUSE_STOP')
    else:
        backup.mkdir(mode=0o700)
    backup.chmod(0o700)
    copies = backup / 'files'
    copies.mkdir(mode=0o700)
    for directory in directories:
        if directory != '.':
            (copies / directory).mkdir(parents=True, exist_ok=True)
    for name, info in files.items():
        copy_checked(target / name, copies / name, info['sha256'])
    for directory in reversed(directories):
        fd = open_nofollow(copies / directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            info = dir_meta[directory]
            current = os.fstat(fd)
            os.fchmod(fd, info['mode'])
            if (current.st_uid, current.st_gid) != (info['uid'], info['gid']):
                os.fchown(fd, info['uid'], info['gid'])
            os.utime(fd, ns=(current.st_atime_ns, info['mtimeNs']))
        finally:
            os.close(fd)
    # Copy verification is independent of live hashes: corruption or races STOP
    # before a completion marker or any activator write.
    copied, copied_dirs = inventory(copies)
    require(copied == files and copied_dirs == directories, 'COPIED_TREE_INTEGRITY_STOP')
    current, current_dirs = inventory(target)
    require(current == files and current_dirs == directories and directory_metadata(target, directories) == dir_meta,
            'LIVE_CHANGED_DURING_SNAPSHOT_STOP')
    require({name: sha(stage / name) for name in names} == released, 'STAGE_CHANGED_DURING_SNAPSHOT_STOP')
    snapshot = {'schemaVersion': 1, 'source': str(target), 'files': files,
                'directories': directories, 'directoryMetadata': dir_meta}
    (backup / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    (backup / 'before.tsv').write_text(''.join(name + '\t' + files.get(name, {}).get('sha256', 'ABSENT') + '\n' for name in names))
    (backup / 'release.tsv').write_text(''.join(name + '\t' + released[name] + '\n' for name in names))
    manifest = backup / 'manifest.sha256'
    manifest.write_text(''.join(sha(backup / name) + '  ' + name + '\n'
                                for name in ('snapshot.json', 'before.tsv', 'release.tsv')))
    # Flush copied bytes and manifest files before advertising a complete copy.
    for path in [*(copies / name for name in files), backup / 'snapshot.json',
                 backup / 'before.tsv', backup / 'release.tsv', manifest]:
        with path.open('rb') as stream:
            os.fsync(stream.fileno())
    (backup / 'complete').write_text(sha(manifest) + '\n')
    with (backup / 'complete').open('rb') as stream:
        os.fsync(stream.fileno())
    for path in [*(copies / d for d in reversed(directories)), backup, backup.parent]:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return verify(backup, names)


def mutate(mode, target, stage, backup, names):
    """Used only by the existing protected activator AFTER its release gates."""
    require(names[-1] == 'index.html', 'INDEX_MUST_ACTIVATE_LAST_STOP')
    verify(backup, names)
    target = safe(target)
    before = rows(backup / 'before.tsv', names, absent=True)
    released = rows(backup / 'release.tsv', names)
    root = open_nofollow(target, os.O_RDONLY | os.O_DIRECTORY)

    def current(name):
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root)
        except FileNotFoundError:
            return 'ABSENT'
        try:
            return hash_fd(fd)
        finally:
            os.close(fd)

    def guard(name):
        value = current(name)
        allowed = (before[name],) if mode == 'activate' else (before[name], released[name])
        require(value in allowed, 'UNKNOWN_LIVE__STOP')
        return value

    changed = 0
    try:
        # Validate the entire operation before the first write, including partially
        # activated states. Root and temporary files remain bound to no-follow FDs.
        for name in names:
            guard(name)
            if mode == 'activate':
                require(sha(stage / name) == released[name], 'STAGE_CHANGED_BEFORE_ACTIVATION_STOP')
        for name in names:
            wanted = released[name] if mode == 'activate' else before[name]
            if guard(name) == wanted:
                continue
            if wanted == 'ABSENT':
                os.unlink(name, dir_fd=root)
            else:
                source = stage / name if mode == 'activate' else backup / 'files' / name
                src = open_nofollow(source, os.O_RDONLY)
                temp = '.fizira-' + mode + '-' + secrets.token_hex(16)
                try:
                    dest = os.open(temp, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=root)
                    try:
                        copy_fd(src, dest, wanted)
                    finally:
                        os.close(dest)
                    guard(name)
                    os.replace(temp, name, src_dir_fd=root, dst_dir_fd=root)
                finally:
                    os.close(src)
                    try:
                        os.unlink(temp, dir_fd=root)
                    except FileNotFoundError:
                        pass
            os.fsync(root)
            require(current(name) == wanted, 'LIVE_VERIFICATION_STOP')
            changed += 1
        for name in names:
            require(current(name) == (released[name] if mode == 'activate' else before[name]), 'LIVE_VERIFICATION_STOP')
    finally:
        os.close(root)
    return {'frontend': mode.upper() + '_VERIFIED', 'changedFiles': changed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('create', 'verify', 'activate', 'rollback'))
    parser.add_argument('--target')
    parser.add_argument('--stage')
    parser.add_argument('--backup', required=True)
    parser.add_argument('--assets', required=True)
    parser.add_argument('--expected-manifest-sha256')
    args = parser.parse_args()
    try:
        names = assets(args.assets)
        if args.mode == 'create':
            require(args.target and args.stage, 'CREATE_ARGUMENTS_STOP')
            result = create(args.target, args.stage, args.backup, names)
        else:
            if args.mode == 'verify':
                result = verify(Path(args.backup), names, args.expected_manifest_sha256)
            else:
                require(args.target and (args.stage or args.mode == 'rollback'), 'MUTATION_ARGUMENTS_STOP')
                result = mutate(args.mode, Path(args.target), Path(args.stage) if args.stage else None, Path(args.backup), names)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        label = str(exc) if isinstance(exc, ValueError) and re.fullmatch('[A-Z_]+', str(exc)) else type(exc).__name__
        print(json.dumps({'snapshot': 'STOP', 'reason': label}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
