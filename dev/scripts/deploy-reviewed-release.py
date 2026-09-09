#!/usr/bin/env python3
"""Deploy a verified public-file archive with exact-file backups and no deletions.
Run on the production host. All staging and backups stay outside the web root.
"""
import argparse,hashlib,json,os,re,stat,tarfile,tempfile
from pathlib import Path
from release_files import is_public
from datetime import datetime,timezone
WEB = None
BACKUPS = None
def digest(data):return hashlib.sha256(data).hexdigest()
def target(name):
 if not is_public(name):raise ValueError('Not a public release file: '+name)
 dst=WEB/name
 if WEB.resolve() not in dst.resolve().parents:raise ValueError('Path outside web root')
 if dst.is_symlink() or any(p.is_symlink() for p in dst.parents if p!=WEB):raise ValueError('Symlinks cannot be deployed: '+name)
 return dst
def replace(dst,data,mode=0o644):
 dst.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.relu-publish-',dir=str(dst.parent))
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,mode);os.replace(tmp,str(dst))
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def restore(folder):
 record=json.loads((folder/'before.json').read_text())
 with tarfile.open(str(folder/'before.tar.gz'),'r:gz') as archive:
  for name,old in record.items():
   if old['exists']:
    data=archive.extractfile(name).read()
    if digest(data)!=old['sha256']:raise ValueError('Backup checksum mismatch: '+name)
    replace(target(name),data,old['mode'])
 # Added release files remain on disk, unlinked by the restored pages. No deletion.
 previous=folder/'previous-release.json'
 marker=previous.read_bytes() if previous.exists() else json.dumps({'status':'rolled_back','source_commit':None,'backup':str(folder)}).encode()
 replace(BACKUPS/'current-release.json',marker,0o600)
 print(json.dumps({'restored':sum(v['exists'] for v in record.values()),'backup':str(folder)}))
def deploy(archive_path):
 with tarfile.open(str(archive_path),'r:gz') as archive:
  members=archive.getmembers()
  if any(not m.isfile() for m in members) or len(members)>1500 or sum(m.size for m in members)>100_000_000:raise ValueError('Invalid archive members/size')
  manifest=json.load(archive.extractfile('release.json'));release=manifest['release']
  if not re.fullmatch(r'[a-z0-9-]{10,70}',release):raise ValueError('Invalid release id')
  files=manifest['files'];expected={'release.json'}|{'payload/'+name for name in files}
  if len(members)!=len(expected) or {m.name for m in members}!=expected:raise ValueError('Archive allowlist mismatch')
  payload={}
  for name,item in files.items():
   target(name);data=archive.extractfile('payload/'+name).read()
   if len(data)!=item['bytes'] or digest(data)!=item['sha256']:raise ValueError('Payload checksum mismatch: '+name)
   payload[name]=data
 BACKUPS.mkdir(mode=0o700,exist_ok=True);folder=BACKUPS/release
 if folder.exists():folder=BACKUPS/(release+'-'+datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f'))
 folder.mkdir(mode=0o700)
 changed={name:data for name,data in payload.items() if not target(name).exists() or digest(target(name).read_bytes())!=files[name]['sha256']}
 record={}
 with tarfile.open(str(folder/'before.tar.gz'),'w:gz') as backup:
  for name in changed:
   dst=target(name)
   if dst.exists():
    info=dst.stat();record[name]={'exists':True,'sha256':digest(dst.read_bytes()),'mode':stat.S_IMODE(info.st_mode)};backup.add(str(dst),arcname=name,recursive=False)
   else:record[name]={'exists':False}
 if (BACKUPS/'current-release.json').exists():(folder/'previous-release.json').write_bytes((BACKUPS/'current-release.json').read_bytes())
 (folder/'before.json').write_text(json.dumps(record,indent=2));(folder/'release.json').write_text(json.dumps(manifest,indent=2))
 # Refuse concurrent edits before beginning the replacement phase.
 for name,old in record.items():
  dst=target(name)
  if old['exists'] and digest(dst.read_bytes())!=old['sha256'] or not old['exists'] and dst.exists():raise ValueError('Production changed during backup: '+name)
 ordered=sorted(changed,key=lambda n:(3 if n=='sw.js' else 2 if n=='.htaccess' else 1 if n.endswith('.html') else 0,n))
 try:
  for name in ordered:replace(target(name),payload[name],record[name].get('mode',0o644))
  for name in payload:
   if digest(target(name).read_bytes())!=files[name]['sha256']:raise ValueError('Deployed checksum mismatch: '+name)
 except BaseException:
  restore(folder);raise
 receipt={'release':release,'deployed_at':datetime.now(timezone.utc).isoformat(),'source_commit':manifest.get('source_commit'),'file_count':len(files),'changed_files':len(changed),'bytes':sum(len(d) for d in payload.values()),'backup':str(folder),'status':'deployed','deletions':0}
 (folder/'receipt.json').write_text(json.dumps(receipt,indent=2));replace(BACKUPS/'current-release.json',json.dumps(receipt,indent=2).encode(),0o600);print(json.dumps(receipt))
def main():
 global WEB,BACKUPS
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('mode',choices=['deploy','rollback']);p.add_argument('path',type=Path)
 p.add_argument('--web-root',type=Path,required=True);p.add_argument('--backup-root',type=Path,required=True)
 args=p.parse_args();WEB=args.web_root.resolve();BACKUPS=args.backup_root.resolve()
 if not WEB.is_dir() or BACKUPS==WEB or WEB in BACKUPS.parents or BACKUPS in WEB.parents:
  p.error('Web root must exist; backup root must be separate and outside it')
 if args.mode=='deploy':deploy(args.path)
 else:
  folder=args.path.resolve()
  if folder.parent!=BACKUPS:raise ValueError('Rollback must select a release backup')
  restore(folder)
if __name__=='__main__':main()
