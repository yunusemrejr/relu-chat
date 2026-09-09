#!/usr/bin/env python3
import argparse,json,hashlib,re,time,concurrent.futures,urllib.request,urllib.error,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,required=True);args=parser.parse_args()
manifest=json.loads(args.manifest.read_text());errors=[];checks=[]
files=manifest['files']
def fetch(path):
 request=urllib.request.Request('https://relu.chat'+path,headers={'User-Agent':'ReLU-release-verification/2026-09-09','Cache-Control':'no-cache'})
 with urllib.request.urlopen(request,timeout=25) as response:return response.status,response.read(),dict(response.headers),response.url
def verify(name):
 route='/'+name
 if name.endswith('index.html'):route=route[:-10]
 try:
  status,data,headers,url=fetch(route)
  result={'path':route,'status':status,'bytes':len(data),'url':url,'cache_control':headers.get('Cache-Control',headers.get('cache-control',''))}
  if name.endswith('.html'):
   local=(root/name).read_text();html=data.decode('utf-8')
   for regex in [r'<title>[\s\S]*?</title>',r'<link rel="canonical"[^>]+>',r'<h1[^>]*>[\s\S]*?</h1>']:
    expected=re.search(regex,local)
    if expected and expected.group() not in html:result['error']='HTML metadata/content mismatch'
  else:
   result['sha256']=hashlib.sha256(data).hexdigest()
   if result['sha256']!=files[name]['sha256']:result['error']='Content hash differs'
  if name in ['sw.js','policy.manifest.json','assets/models/policy/policy.wasm','core/chatbot-engine.js'] and 'no-cache' not in result['cache_control']:result['error']='Mutable asset missing revalidation header'
  if name.endswith('policy.wasm') and 'application/wasm' not in headers.get('Content-Type',headers.get('content-type','')):result['error']='WASM MIME mismatch'
  return result
 except Exception as exc:return {'path':route,'error':str(exc)}
start=time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for result in pool.map(verify,[p for p in files if p not in ['.htaccess','.well-known/llms.txt'] and not p.endswith('.php') and files[p]['bytes']<=2_000_000]):
  checks.append(result)
  if 'error'in result:errors.append(result);print('FAIL',result,flush=True)
# Also fetch every sitemap route, including pages that did not need replacement.
urls=[n.text for n in ET.parse(root/'sitemap.xml').findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
indexed=[]
for url in urls:
 path=url.removeprefix('https://relu.chat')
 if not any(c['path']==path and c.get('status')==200 for c in checks):
  try:status,_,_,_=fetch(path);indexed.append({'path':path,'status':status})
  except Exception as exc:errors.append({'path':path,'error':str(exc)})
for path,destination in [('/index.html','https://relu.chat/'),('/chat/linear-algebra-chat/index.html','https://relu.chat/chat/linear-algebra-chat/')]:
 try:
  status,_,_,url=fetch(path)
  if status!=200 or url!=destination:errors.append({'path':path,'error':'Canonical redirect failed','url':url})
 except Exception as exc:errors.append({'path':path,'error':str(exc)})
report={'release':manifest['release'],'seconds':round(time.monotonic()-start,2),'source_commit':manifest.get('source_commit'),'public_files_checked':len(checks),'large_assets_verified_on_host':len([p for p in files if files[p]['bytes']>2_000_000]),'sitemap_routes':len(urls),'additional_indexed_checks':indexed,'checks':checks,'errors':errors}
(root/'dev/exports/production-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ['checks','additional_indexed_checks']},indent=2));raise SystemExit(bool(errors))
