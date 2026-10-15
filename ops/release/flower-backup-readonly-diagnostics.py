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
