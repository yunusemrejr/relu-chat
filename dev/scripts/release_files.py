"""The shared allowlist for deployment, packaging, and release verification."""
import re
from pathlib import PurePosixPath
PUBLIC_ROOTS = {'assets', 'chat', 'core', 'policy', 'data', 'blog', 'tools', 'errors', 'api'}
PUBLIC_FILES = {'.htaccess', 'index.html', 'how-it-works.html', 'sw.js', 'manifest.webmanifest',
                'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt', 'policy.manifest.json', 'LICENSE'}
WELL_KNOWN = {'.well-known/security.txt', '.well-known/ai-plugin.json',
              '.well-known/openapi.yaml', '.well-known/llms.txt'}
def is_public(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or str(path) != name:
        return False
    if name in PUBLIC_FILES or name in WELL_KNOWN:
        return True
    if any(part.startswith('.') for part in path.parts):
        return False
    if any(part in {'uploads', 'media', 'user-content', 'cache', 'logs', 'tmp', '__pycache__'} for part in path.parts):
        return False
    if name == 'data/indexnow-marker.json' or re.search(r'\.(db|sqlite3?|sql|log|zip|gz|bak|backup|pyc?|sh|md)$', name):
        return False
    if re.search(r'(?:^|/)(?:ftp-info|.*-secret|.*-creds|.*-pass)[^/]*$', name):
        return False
    return path.parts[0] in PUBLIC_ROOTS or bool(re.fullmatch(r'[a-f0-9]{20,64}\.txt', name))
