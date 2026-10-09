#!/usr/bin/env python3
"""Verify the complete entry set, types and blob bytes of a Git-archive snapshot.

No source entries are excluded. Gitlinks are allowed only as empty archive
directories; their pinned commit is recorded and no submodule contents are used.
Empty tracked-parent directories are checked too; symlink directories are never
followed. Git metadata belongs in the separate upstream checkout, not snapshots.
"""
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys


def verify(repo, commit, directory):
    root = pathlib.Path(directory)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Snapshot root must be a real directory')
    env = dict(os.environ, GIT_NO_LAZY_FETCH='1')
    entries = {}
    directories = set()
    gitlinks = {}
    records = subprocess.check_output(
        ['git', '-C', repo, 'ls-tree', '-rz', commit], env=env
    ).split(b'\0')
    for record in records:
        if not record:
            continue
        meta, name = record.split(b'\t')
        mode, kind, oid = meta.decode().split()
        path = name.decode()
        if kind == 'commit' and mode == '160000':
            gitlinks[path] = oid
            directories.add(path)
        elif kind == 'blob' and mode in {'100644', '100755', '120000'}:
            entries[path] = (mode, oid)
        else:
            raise ValueError('Unsupported pinned entry: ' + path)
        parent = pathlib.PurePosixPath(path).parent
        while str(parent) != '.':
            directories.add(str(parent))
            parent = parent.parent

    actual_entries = set()
    actual_directories = set()
    for base, dirs, files, dir_fd in os.fwalk(root, follow_symlinks=False):
        for name in list(dirs):
            path = pathlib.Path(base) / name
            relative = path.relative_to(root).as_posix()
            if stat.S_ISLNK(os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_mode):
                actual_entries.add(relative)
                dirs.remove(name)
            else:
                actual_directories.add(relative)
        for name in files:
            actual_entries.add((pathlib.Path(base) / name).relative_to(root).as_posix())
    for label, actual, expected in [
        ('source entry', actual_entries, set(entries)),
        ('directory', actual_directories, directories),
    ]:
        extra = sorted(actual - expected)
        missing = sorted(expected - actual)
        if extra:
            raise ValueError('Unexpected ' + label + ': ' + extra[0])
        if missing:
            raise ValueError('Missing ' + label + ': ' + missing[0])

    manifest = hashlib.sha256()
    # Open every ancestor relative to the snapshot root with O_NOFOLLOW. A
    # substituted directory symlink cannot redirect blob reads outside it.
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for relative, (mode, expected_oid) in sorted(entries.items()):
            parts = relative.split('/')
            parent_fd = os.dup(root_fd)
            try:
                for part in parts[:-1]:
                    child_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                       dir_fd=parent_fd)
                    os.close(parent_fd)
                    parent_fd = child_fd
                name = parts[-1]
                info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                if mode == '120000':
                    if not stat.S_ISLNK(info.st_mode):
                        raise ValueError('Expected symlink: ' + relative)
                    data = os.readlink(name, dir_fd=parent_fd).encode()
                else:
                    if not stat.S_ISREG(info.st_mode):
                        raise ValueError('Expected regular source file: ' + relative)
                    if bool(info.st_mode & 0o111) != (mode == '100755'):
                        raise ValueError('Git executable mode mismatch: ' + relative)
                    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
                    with os.fdopen(fd, 'rb') as source:
                        opened = os.fstat(source.fileno())
                        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                            raise ValueError('Source changed while opening: ' + relative)
                        data = source.read()
                        after = os.fstat(source.fileno())
                        if (after.st_mode, after.st_size, after.st_mtime_ns) != (opened.st_mode, opened.st_size, opened.st_mtime_ns):
                            raise ValueError('Source changed while reading: ' + relative)
                actual_oid = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
                if actual_oid != expected_oid:
                    raise ValueError('Upstream snapshot content mismatch: ' + relative)
                manifest.update((relative + '\0' + mode + '\0' + actual_oid + '\n').encode())
            finally:
                os.close(parent_fd)
    finally:
        os.close(root_fd)
    for relative, oid in sorted(gitlinks.items()):
        manifest.update((relative + '\0' + '160000' + '\0' + oid + '\n').encode())
    return {'commit': commit, 'trackedBlobs': len(entries),
            'directories': len(directories), 'sourceSetSha256': manifest.hexdigest(),
            'emptyGitlinks': gitlinks, 'unexpectedEntriesAllowed': 0}



if __name__ == '__main__':
    try:
        print(json.dumps(verify(*sys.argv[1:]), sort_keys=True))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
