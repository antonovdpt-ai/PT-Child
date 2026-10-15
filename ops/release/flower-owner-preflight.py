#!/usr/bin/env python3
"""Read-only production file owner/mode audit; no secrets or patient data."""
import os, stat
from pathlib import Path

root=Path("/root/supabase-project/volumes/proxy/app")
files=("app.js","cabinet.js","schedule-editor.js","parent-specialist.js","parent.html","index.html")
uid=os.geteuid();groups=set(os.getgroups())|{os.getegid()}
d=root.lstat()
print("ROOT_IS_NORMAL_DIRECTORY=",stat.S_ISDIR(d.st_mode) and not stat.S_ISLNK(d.st_mode))
print("ROOT_WRITABLE_BY_SSH_USER=",os.access(root,os.W_OK|os.X_OK))
print("ROOT_MODE=",oct(stat.S_IMODE(d.st_mode)))
print("ROOT_OWNER_IS_SSH_USER=",d.st_uid==uid)
print("ROOT_GROUP_IS_SSH_MEMBER=",d.st_gid in groups)
for file in files:
    path=root/file
    info=path.lstat()
    print("FILE",file,
          "regular="+str(stat.S_ISREG(info.st_mode)),
          "owner_is_ssh="+str(info.st_uid==uid),
          "group_is_member="+str(info.st_gid in groups),
          "write_allowed="+str(os.access(path,os.W_OK)),
          "mode="+oct(stat.S_IMODE(info.st_mode)))
print("READ_ONLY_METADATA_AUDIT=PASS")
