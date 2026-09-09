#!/usr/bin/env python3
"""Package a committed public tree; never package uncommitted or runtime data."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path
from release_files import is_public

def package(repository, revision, output):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repository)] + list(args))
    commit = git('rev-parse', '--verify', revision + '^{commit}').decode().strip()
    if not re.fullmatch(r'[a-f0-9]{40,64}', commit):
        raise ValueError('Invalid commit')
    release = 'git-' + commit
    output.mkdir(parents=True, exist_ok=True)
    files = {}
    with tarfile.open(str(output / 'release.tar.gz'), 'w:gz') as archive:
        for record in git('ls-tree', '-rz', '--full-tree', commit).split(b'\0'):
            if not record:
                continue
            metadata, name_bytes = record.split(b'\t', 1)
            mode, kind, blob = metadata.decode().split()
            name = name_bytes.decode('utf-8')
            if not is_public(name):
                continue
            if kind != 'blob' or mode not in {'100644', '100755'}:
                raise ValueError('Public release cannot contain symlinks/submodules: ' + name)
            data = git('cat-file', 'blob', blob)
            files[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            info = tarfile.TarInfo('payload/' + name)
            info.size = len(data)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
        manifest = {'release': release, 'source_commit': commit, 'files': files}
        data = json.dumps(manifest, sort_keys=True).encode('utf-8')
        info = tarfile.TarInfo('release.json')
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
    (output / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--commit', default='HEAD')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = package(args.repository, args.commit, args.output)
    print(json.dumps({'release': result['release'], 'source_commit': result['source_commit'],
                      'files': len(result['files']), 'archive': str(args.output / 'release.tar.gz')}))
