#!/usr/bin/env python3
"""One-run, verify-before-extract offline rehearsal of the approved TAR_V2 snapshot.

Remote stdin payload. No live-site modification, no containers, no sudo,
no symlink extraction, no ownership/mode restoration to shared webroot.
The temporary copy is retained for inspection; no automatic deletion.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

BACKUP_ID = "38763866489"
APP_ROOT = Path("/root/supabase-project/volumes/proxy/app")
BACKUP_MANIFEST_PIN = "e18171381a5452860741fbe6578586aa6ceea0d33c7cac54ac3c5f56f5925346"
SOURCE_PIN = "51e18c88377a7b20d06eef24b0db9fcb6d45fd3a"
HEAD_PIN = "ed6c103578cbfcabe19ab0077e8eeff1305d8b3d"
MAX_FILES = 4096
MAX_BYTES = 1024 * 1024 * 1024
CHUNK = 1024 * 1024


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), "NOT_REGULAR_STOP")
    return info


def private_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode)
            and stat.S_IMODE(info.st_mode) == 0o700, "NOT_PRIVATE_DIRECTORY_STOP")


def sha256(path):
    regular(path)
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def safe_name(name):
    p = PurePosixPath(name)
    return (name == "." or (
        bool(name) and not name.startswith("/") and name != "."
        and "\\" not in name and "\x00" not in name
        and not any(x in ("", ".", "..") for x in name.split("/"))
        and str(p) == name
    ))


def check_metadata(member, metadata):
    require(member.uid == metadata["uid"]
            and member.gid == metadata["gid"]
            and member.mode == metadata["mode"]
            and member.mtime == metadata["mtimeNs"] // 1_000_000_000,
            "ARCHIVE_METADATA_MISMATCH_STOP")


def read_archive(archive_path, files, directories, destination=None):
    seen_files, seen_dirs = set(), set()
    bytes_total, count = 0, 0
    with tarfile.open(archive_path, mode="r:gz") as archive:
        for member in archive:
            name = member.name.rstrip("/") or "."
            require(safe_name(name), "UNSAFE_TAR_PATH_STOP")
            count += 1
            require(count <= MAX_FILES, "TOO_MANY_MEMBERS_STOP")
            if member.isdir():
                require(name in directories and name not in seen_dirs, "DIR_DUPLICATE_OR_UNKNOWN_STOP")
                check_metadata(member, directories[name])
                seen_dirs.add(name)
                if destination is not None and name != ".":
                    target = destination.joinpath(*name.split("/"))
                    target.mkdir(parents=False, mode=0o700)
                    private_directory(target)
            elif member.isfile():
                require(name in files and name not in seen_files, "FILE_DUPLICATE_OR_UNKNOWN_STOP")
                require(all(p in seen_dirs for p in ancestor_names(name)),
                        "UNDECLARED_PARENT_STOP")
                info = files[name]
                check_metadata(member, info)
                require(member.size == info["bytes"] <= 64 * 1024 * 1024, "TAR_LENGTH_STOP")
                bytes_total += member.size
                require(bytes_total <= MAX_BYTES, "TAR_TOO_LARGE_STOP")
                stream = archive.extractfile(member)
                require(stream is not None, "MISSING_TAR_STREAM_STOP")
                target = destination.joinpath(*name.split("/")) if destination is not None else None
                digest = hashlib.sha256()
                actual_bytes = 0
                file_handle = None
                try:
                    if target is not None:
                        # Fresh private directory, exclusive creation and nofollow.
                        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                                     os.O_NOFOLLOW, 0o600)
                        file_handle = os.fdopen(fd, "wb")
                    while True:
                        block = stream.read(CHUNK)
                        if not block:
                            break
                        actual_bytes += len(block)
                        require(actual_bytes <= info["bytes"], "TAR_OVERFLOW_STOP")
                        digest.update(block)
                        if file_handle is not None:
                            file_handle.write(block)
                    require(actual_bytes == info["bytes"] and
                            digest.hexdigest() == info["sha256"], "TAR_BYTES_INVALID_STOP")
                    if file_handle is not None:
                        file_handle.flush()
                        os.fsync(file_handle.fileno())
                finally:
                    if file_handle is not None:
                        file_handle.close()
                seen_files.add(name)
            else:
                raise ValueError("UNSAFE_TAR_MEMBER_TYPE_STOP")
    require(seen_files == set(files) and seen_dirs == set(directories),
            "INCOMPLETE_TAR_STOP")
    return len(seen_files), len(seen_dirs), bytes_total


def ancestor_names(path):
    parts = path.split("/")
    return [".", *["/".join(parts[:i]) for i in range(1, len(parts))]]


def check_dir_inventory(destination, directories, files):
    root = destination.resolve(strict=True)
    actual_files, actual_dirs, total = {}, set(), 0
    for path in [destination, *sorted(destination.rglob("*"))]:
        relative = "." if path == destination else path.relative_to(destination).as_posix()
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
            actual_dirs.add(relative)
            require(stat.S_IMODE(info.st_mode) == 0o700, "RESTORED_DIR_PRIVACY_STOP")
        elif stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode):
            require(stat.S_IMODE(info.st_mode) == 0o600, "RESTORED_FILE_PRIVACY_STOP")
            actual_files[relative] = (info.st_size, sha256(path))
            total += info.st_size
        else:
            raise ValueError("RESTORED_NONREGULAR_STOP")
    require(actual_dirs == set(directories), "RESTORED_DIRECTORY_SET_STOP")
    require(set(actual_files) == set(files), "RESTORED_FILE_SET_STOP")
    for name, record in files.items():
        require(actual_files[name] == (record["bytes"], record["sha256"]),
                "RESTORED_FILE_HASH_STOP")
    return len(actual_files), len(actual_dirs), total


def test():
    os.umask(0o077)
    require(RUN_NUMBER.isdecimal() and 1 <= len(RUN_NUMBER) <= 30, "RUN_ID_STOP")
    home = Path.home()
    backup_parent = home / ".cache" / "fizira-frontend-snapshots"
    backup = backup_parent / ("flower-ui-" + BACKUP_ID)
    require(not home.is_symlink() and not (home / ".cache").is_symlink(), "HOME_LINK_STOP")
    private_directory(home / ".cache")
    private_directory(backup_parent)
    private_directory(backup)
    complete = backup / "complete"
    manifest = backup / "manifest.sha256"
    require(regular(complete).st_size <= 1024, "COMPLETION_SIZE_STOP")
    require(regular(manifest).st_size <= 4096, "MANIFEST_SIZE_STOP")
    require(sha256(manifest) == BACKUP_MANIFEST_PIN, "MANIFEST_PIN_MISMATCH_STOP")
    require(complete.read_text() == BACKUP_MANIFEST_PIN + "\n", "INCOMPLETE_BACKUP_STOP")
    expected_files = ("frontend.tar.gz", "snapshot.json", "before.tsv", "release.tsv")
    manifest_rows = manifest.read_text().splitlines()
    require(len(manifest_rows) == len(expected_files), "MANIFEST_ROWS_STOP")
    for row, filename in zip(manifest_rows, expected_files):
        require(row == sha256(backup / filename) + "  " + filename,
                "MANIFEST_ENTRY_SHA_STOP")
    archive_path = backup / "frontend.tar.gz"
    data = json.loads((backup / "snapshot.json").read_text())
    require(data.get("schemaVersion") == 2 and data.get("format") == "private-tar-gzip"
            and data.get("source") == str(APP_ROOT)
            and data.get("sourceRelease") == SOURCE_PIN
            and data.get("intendedRelease") == HEAD_PIN,
            "BACKUP_IDENTITY_STOP")
    files = data["files"]
    directories = data["directoryMetadata"]
    require(isinstance(files, dict) and isinstance(directories, dict) and
            "." in directories and len(files) <= MAX_FILES and
            len(directories) <= MAX_FILES and
            all(safe_name(x) and x != "." for x in files) and
            all(safe_name(x) for x in directories) and
            not set(files).intersection(directories), "BACKUP_STRUCTURE_STOP")
    require(len(files) == 92 and len(directories) == 27, "BACKUP_COUNT_STOP")
    require(sum(x["bytes"] for x in files.values()) == 5823129, "BACKUP_SIZE_STOP")

    # Two-pass safety: validate the archive and all metadata before creating
    # a test directory. No tar.extractall, no extraction of links/devices.
    first = read_archive(archive_path, files, directories)
    require(first == (92, 27, 5823129), "ARCHIVE_FIRST_PASS_STOP")
    require(os.statvfs(home).f_bavail * os.statvfs(home).f_frsize >= 200*1024*1024,
            "RESTORE_DISK_LOW_STOP")
    restore_parent = home / ".cache" / "fizira-frontend-restore-tests"
    require(not restore_parent.is_symlink(), "RESTORE_PARENT_LINK_STOP")
    if not restore_parent.exists():
        restore_parent.mkdir(mode=0o700)
    private_directory(restore_parent)
    destination = restore_parent / ("flower-ui-" + RUN_NUMBER)
    require(not destination.exists() and not destination.is_symlink(),
            "RESTORE_TARGET_EXISTS_STOP")
    destination.mkdir(mode=0o700)
    private_directory(destination)

    second = read_archive(archive_path, files, directories, destination)
    require(second == first, "RESTORE_PASS_MISMATCH_STOP")
    n_files, n_dirs, bytes_total = check_dir_inventory(destination, directories, files)
    require((n_files, n_dirs, bytes_total) == first, "RESTORED_INVENTORY_STOP")
    # Check only the 21 release-allowlisted paths against the recorded baseline,
    # including three expected absent new files. No need to query the live app.
    require(len(PIN_BASE) == 21 and set(PIN_BASE) == set(PIN_HEAD), "PINNED_SET_STOP")
    for name, expected in PIN_BASE.items():
        actual = files.get(name, {}).get("sha256")
        require(actual == expected, "PINNED_BASE_RESTORE_DRIFT_STOP")

    print("BACKUP_PINNED_MANIFEST=PASS")
    print("TAR_SAFETY_AND_METADATA=PASS")
    print("ISOLATED_RESTORE=PASS")
    print("RESTORED_FILES=" + str(n_files))
    print("RESTORED_DIRECTORIES=" + str(n_dirs))
    print("RESTORED_BYTES=" + str(bytes_total))
    print("RESTORED_HASHES=PASS")
    print("FRONTEND_BASE_ALLOWLIST=PASS")
    print("RESTORED_PATH=" + str(destination))
    print("LIVE_PRODUCTION_WRITES=NONE")
    print("DATA_AND_SERVICES_UNTOUCHED=YES")
    print("OWNERSHIP_REPLAY_TESTED=NO")
    print("PRODUCTION_ROLLBACK_TESTED=NO")
    print("TEST_COPY_RETAINED=YES")


if __name__ == "__main__":
    try:
        test()
    except (KeyError, TypeError, ValueError, OSError, tarfile.TarError) as exc:
        reason = str(exc) if isinstance(exc, ValueError) and re.fullmatch("[A-Z_]+", str(exc)) else type(exc).__name__
        print("ISOLATED_RESTORE=STOP " + reason)
        raise SystemExit(1)
