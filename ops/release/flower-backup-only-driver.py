#!/usr/bin/env python3
"""Backup-only driver appended after reviewed frontend-snapshot.py helper definitions.

REMOTE execution: only create and verify an isolated private backup.
PIN_BASE, PIN_HEAD and RUN_NUMBER are injected by the CI-side generator.
No live writes, services, backend, deploy, rollback or stage uploads.
"""
from pathlib import Path
import hashlib
import json
import os
import stat

def build_backup():
    expected_names = tuple(PIN_HEAD.keys())
    require(len(expected_names) == 21 and expected_names[-1] == "index.html", "PINNED_MANIFEST_STOP")
    require(set(PIN_BASE) == set(PIN_HEAD), "PINNED_SET_STOP")
    require(sum(1 for x in expected_names if PIN_BASE[x] is None) == 3, "EXPECTED_NEW_COUNT_STOP")
    require(RUN_NUMBER.isdecimal() and 1 <= len(RUN_NUMBER) <= 30, "RUN_ID_STOP")
    target = safe("/root/supabase-project/volumes/proxy/app")
    require(target.is_dir(), "TARGET_MISSING_STOP")
    names = list(expected_names)

    # Read-only live inspection, and exact pin check, BEFORE creating any backup files.
    files, directories = inventory(target)
    dir_meta = directory_metadata(target, directories)
    for name in names:
        live = files.get(name, {}).get("sha256")
        base = PIN_BASE[name]
        require(live == base and ((live is None) == (base is None)), "PRODUCTION_DRIFT_STOP")
    bytes_total = sum(data["bytes"] for data in files.values())
    disk = os.statvfs(target)
    available = disk.f_bavail * disk.f_frsize
    require(available >= max(512 * 1024 * 1024, bytes_total * 3 + 100 * 1024 * 1024),
            "INSUFFICIENT_BACKUP_DISK_STOP")

    backup_parent = safe(Path.home() / ".cache" / "fizira-frontend-snapshots")
    require(target not in backup_parent.parents and backup_parent not in target.parents,
            "BACKUP_OVERLAP_STOP")
    if not backup_parent.exists():
        backup_parent.mkdir(parents=True, mode=0o700)
    require(backup_parent.is_dir() and not backup_parent.is_symlink()
            and stat.S_IMODE(backup_parent.stat().st_mode) == 0o700,
            "BACKUP_ROOT_PRIVACY_STOP")
    backup = safe(backup_parent / ("flower-ui-" + RUN_NUMBER))
    require(not backup.exists(), "BACKUP_ALREADY_EXISTS_STOP")

    backup.mkdir(mode=0o700)
    copies = backup / "files"
    copies.mkdir(mode=0o700)
    for directory in directories:
        if directory != ".":
            (copies / directory).mkdir(parents=True, exist_ok=True)
    for name, info in files.items():
        copy_checked(target / name, copies / name, info["sha256"])
    for directory in reversed(directories):
        fd = open_nofollow(copies / directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            info = dir_meta[directory]
            current = os.fstat(fd)
            os.fchmod(fd, info["mode"])
            if (current.st_uid, current.st_gid) != (info["uid"], info["gid"]):
                os.fchown(fd, info["uid"], info["gid"])
            os.utime(fd, ns=(current.st_atime_ns, info["mtimeNs"]))
        finally:
            os.close(fd)

    copied, copied_dirs = inventory(copies)
    require(copied == files and copied_dirs == directories, "COPIED_TREE_INTEGRITY_STOP")
    current, current_dirs = inventory(target)
    require(current == files and current_dirs == directories and
            directory_metadata(target, directories) == dir_meta,
            "LIVE_CHANGED_DURING_SNAPSHOT_STOP")

    snapshot = {"schemaVersion": 1, "source": str(target), "files": files,
                "directories": directories, "directoryMetadata": dir_meta}
    (backup / "snapshot.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    (backup / "before.tsv").write_text("".join(name + "\t" + files.get(name, {}).get("sha256", "ABSENT") + "\n" for name in names))
    (backup / "release.tsv").write_text("".join(name + "\t" + PIN_HEAD[name] + "\n" for name in names))
    manifest = backup / "manifest.sha256"
    manifest.write_text("".join(sha(backup / name) + "  " + name + "\n" for name in
                                ("snapshot.json", "before.tsv", "release.tsv")))
    for path in [*(copies / name for name in files), backup / "snapshot.json",
                 backup / "before.tsv", backup / "release.tsv", manifest]:
        with path.open("rb") as f:
            os.fsync(f.fileno())
    (backup / "complete").write_text(sha(manifest) + "\n")
    with (backup / "complete").open("rb") as f:
        os.fsync(f.fileno())
    for path in [*(copies / d for d in reversed(directories)), backup, backup.parent]:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)

    evidence = verify(backup, names)
    require(evidence["files"] == len(files) and evidence["bytes"] == bytes_total,
            "VERIFY_MISMATCH_STOP")
    require(safe(target).is_dir(), "LIVE_TARGET_CHANGED_STOP")
    for name in names:
        actual = sha(target / name) if (target / name).is_file() else None
        require(actual == PIN_BASE[name], "LIVE_CHANGED_AFTER_BACKUP_STOP")
    print("FRONTEND_BACKUP=PASS")
    print("BACKUP_COMPLETE=YES")
    print("FRONTEND_LIVE_CHANGED=NO")
    print("BACKUP_PATH=" + str(backup))
    print("BACKUP_FILES=" + str(len(files)))
    print("BACKUP_BYTES=" + str(bytes_total))
    print("MANIFEST_SHA256=" + evidence["manifestSha256"])

if __name__ == "__main__":
    try:
        build_backup()
    except (ValueError, OSError, KeyError, TypeError) as error:
        reason = str(error) if isinstance(error, ValueError) and str(error).isupper() else type(error).__name__
        print("FRONTEND_BACKUP=STOP reason=" + reason)
        raise SystemExit(1)
