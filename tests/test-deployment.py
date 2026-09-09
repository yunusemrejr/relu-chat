"""Public-file deployment must never overwrite runtime data or follow links."""
import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dev/scripts'))
from release_files import is_public
class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.web = self.base / 'public'; self.web.mkdir()
        self.backups = self.base / 'backups'
    def tearDown(self):
        self.temp.cleanup()
    def archive(self, files, release='test-release-001'):
        path = self.base / (release + '.tar.gz')
        manifest = {'release': release, 'source_commit': 'a' * 40,
                    'files': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data in files.items()}}
        with tarfile.open(path, 'w:gz') as archive:
            for name, data in dict({'release.json': json.dumps(manifest).encode()}, **{'payload/' + name: data for name, data in files.items()}).items():
                info = tarfile.TarInfo(name); info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        return path
    def run_deploy(self, mode, path):
        return subprocess.run([sys.executable, str(ROOT / 'dev/scripts/deploy-reviewed-release.py'), mode, str(path), '--web-root', str(self.web), '--backup-root', str(self.backups)], capture_output=True, text=True)
    def test_allowlist(self):
        for path in ['index.html', '.htaccess', '.well-known/security.txt', 'api/subscribe.php', 'core/nlp.js']:
            self.assertTrue(is_public(path), path)
        for path in ['data/subscribers.db', 'data/indexnow-marker.json', '.env', 'dev/scripts/x.py', 'assets/uploads/a.png', '/index.html', 'core/../index.html', 'data/site-secret.json']:
            self.assertFalse(is_public(path), path)
    def test_deploy_and_rollback_preserve_runtime_files(self):
        (self.web / 'index.html').write_text('old page')
        (self.web / 'data').mkdir(); database = self.web / 'data/subscribers.db'; database.write_bytes(b'private runtime data')
        marker = self.web / 'data/indexnow-marker.json'; marker.write_text('runtime marker')
        run = self.run_deploy('deploy', self.archive({'index.html': b'new page', 'core/new.js': b'new code'}))
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual((self.web / 'index.html').read_text(), 'new page')
        receipt = json.loads((self.backups / 'current-release.json').read_text())
        self.assertEqual(receipt['source_commit'], 'a' * 40)
        self.assertEqual(receipt['changed_files'], 2)
        run = self.run_deploy('rollback', self.backups / 'test-release-001')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual((self.web / 'index.html').read_text(), 'old page')
        self.assertEqual(json.loads((self.backups / 'current-release.json').read_text())['status'], 'rolled_back')
        self.assertEqual(database.read_bytes(), b'private runtime data')
        self.assertEqual(marker.read_text(), 'runtime marker')
        self.assertTrue((self.web / 'core/new.js').exists())
    def test_reject_database_and_symlink(self):
        self.assertNotEqual(self.run_deploy('deploy', self.archive({'data/subscribers.db': b'overwrite'})).returncode, 0)
        outside = self.base / 'private'; outside.write_text('keep')
        (self.web / 'index.html').symlink_to(outside)
        self.assertNotEqual(self.run_deploy('deploy', self.archive({'index.html': b'overwrite'})).returncode, 0)
        self.assertEqual(outside.read_text(), 'keep')
    def test_package_uses_commit_not_dirty_worktree(self):
        repo = self.base / 'repository'; repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo)] + list(args), stderr=subprocess.DEVNULL)
        git('init'); git('config', 'user.name', 'Release test'); git('config', 'user.email', 'test@example.invalid')
        (repo / 'index.html').write_text('committed page'); (repo / 'data').mkdir(); (repo / 'data/subscribers.db').write_text('private')
        git('add', '.'); git('commit', '-m', 'fixture'); (repo / 'index.html').write_text('uncommitted page')
        output = self.base / 'package'
        subprocess.run([sys.executable, str(ROOT / 'dev/scripts/package-release.py'), '--repository', str(repo), '--output', str(output)], check=True, capture_output=True)
        with tarfile.open(output / 'release.tar.gz') as archive:
            self.assertEqual(archive.extractfile('payload/index.html').read(), b'committed page')
            self.assertNotIn('payload/data/subscribers.db', archive.getnames())
if __name__ == '__main__':
    unittest.main()
