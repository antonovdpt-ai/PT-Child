#!/usr/bin/env python3
"""Read-only targeted diagnosis of the failed Flower snapshot. No file contents."""
import os,stat
from pathlib import Path
root=Path.home()
base=Path("/root/supabase-project/volumes/proxy/app")
parent=root/".cache"/"fizira-frontend-snapshots"
backup=parent/"flower-ui-38762549644"
print("IDENTITY_EUID=",os.geteuid())
print("IDENTITY_HOME_IS_ROOT=",root==Path("/root"))
for label,p in [("HOME",root),("DOTCACHE",root/".cache"),("BACKUP_PARENT",parent),
                ("BACKUP",backup),("BACKUP_FILES",backup/"files"),
                ("BACKUP_COMPLETE",backup/"complete"),
                ("BACKUP_MANIFEST",backup/"manifest.sha256"),
                ("LIVE_APP",base)]:
    try:
        v=p.lstat()
        kind=("dir" if stat.S_ISDIR(v.st_mode) else
              "file" if stat.S_ISREG(v.st_mode) else
              "link" if stat.S_ISLNK(v.st_mode) else "other")
        rwx=("R" if os.access(p,os.R_OK) else "-")+("W" if os.access(p,os.W_OK) else "-")+("X" if os.access(p,os.X_OK) else "-")
        print(label,"PRESENT",kind,"MODE",oct(stat.S_IMODE(v.st_mode)),"OWNER_IS_EUID",v.st_uid==os.geteuid(),"ACCESS",rwx)
    except FileNotFoundError:
        print(label,"ABSENT")
    except PermissionError:
        print(label,"PERMISSION_DENIED")
if backup.is_dir() and not backup.is_symlink():
    try:
        files=list(backup.iterdir())
        print("BACKUP_TOP_LEVEL_ENTRIES=",len(files))
        print("BACKUP_HAS_COMPLETE=", (backup/"complete").is_file())
    except PermissionError:
        print("BACKUP_ENTRIES=PERMISSION_DENIED")
print("DIAGNOSTIC_READ_ONLY=PASS")


# Full-tree readability and metadata suitability; no file names or content emitted.
import hashlib
unreadable=0
unreadable_dirs=0
symlinks=0
other_types=0
owner_mismatch=0
group_mismatch=0
files_count=0
folders_count=0
tree_bytes=0
def failed(e):
    global unreadable_dirs
    unreadable_dirs+=1
for current, subdirs, filenames in os.walk(base,followlinks=False,onerror=failed):
    folders_count+=1
    for name in subdirs:
        v=Path(current)/name
        try:
            info=v.lstat()
            if stat.S_ISLNK(info.st_mode): symlinks+=1
            elif not stat.S_ISDIR(info.st_mode):other_types+=1
        except PermissionError: unreadable_dirs+=1
    for name in filenames:
        v=Path(current)/name
        try:
            info=v.lstat()
            if not stat.S_ISREG(info.st_mode):
                symlinks+=int(stat.S_ISLNK(info.st_mode))
                other_types+=int(not stat.S_ISLNK(info.st_mode))
                continue
            owner_mismatch+=int(info.st_uid!=os.geteuid())
            group_mismatch+=int(info.st_gid!=os.getegid())
            files_count+=1
            tree_bytes+=info.st_size
            fd=os.open(v,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            os.close(fd)
        except PermissionError:
            unreadable+=1
print("FULL_TREE_FILES=",files_count)
print("FULL_TREE_DIRS=",folders_count)
print("FULL_TREE_TOTAL_BYTES=",tree_bytes)
print("UNREADABLE_FILES=",unreadable)
print("UNREADABLE_DIRS=",unreadable_dirs)
print("SYMLINKS=",symlinks)
print("OTHER_TYPES=",other_types)
print("OWNER_DIFFERENT_EUID_FILES=",owner_mismatch)
print("GROUP_DIFFERENT_EGID_FILES=",group_mismatch)
print("FULL_TREE_AUDIT_COMPLETE=YES")
