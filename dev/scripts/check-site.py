#!/usr/bin/env python3
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit,unquote
import json,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[2]
class Page(HTMLParser):
 def __init__(self):super().__init__();self.links=[];self.ids=[];self.h1=0;self.canonical=[];self.description=[];self.title='';self.in_title=False;self.schema=[];self.in_schema=False;self.buffer=''
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if 'id'in a:self.ids.append(a['id'])
  if tag=='h1':self.h1+=1
  if tag=='title':self.in_title=True
  if tag=='meta' and a.get('name')=='description':self.description.append(a.get('content',''))
  if tag=='link' and a.get('rel')=='canonical':self.canonical.append(a.get('href'))
  if tag=='script' and a.get('type')=='application/ld+json':self.in_schema=True;self.buffer=''
  for key in ['src','href']:
   if key in a:self.links.append(a[key])
 def handle_data(self,d):
  if self.in_title:self.title+=d
  if self.in_schema:self.buffer+=d
 def handle_endtag(self,tag):
  if tag=='title':self.in_title=False
  if tag=='script'and self.in_schema:self.schema.append(self.buffer);self.in_schema=False
sitemap=root/'sitemap.xml';urls=[n.text for n in ET.parse(sitemap).findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
errors=[];checked=0
for url in urls:
 rel=urlsplit(url).path;path=root/rel.lstrip('/');path=path/'index.html' if rel.endswith('/') else path
 if not path.exists():errors.append(f'Missing sitemap route: {rel}');continue
 parsed=Page();parsed.feed(path.read_text());checked+=1
 if parsed.h1!=1:errors.append(f'{rel}: {parsed.h1} H1s')
 if parsed.canonical!=[url]:errors.append(f'{rel}: canonical {parsed.canonical}')
 if not parsed.title or len(parsed.description)!=1 or not parsed.description[0]:errors.append(f'{rel}: missing title/description')
 if len(set(parsed.ids))!=len(parsed.ids):errors.append(f'{rel}: duplicate ids')
 for block in parsed.schema:
  try:
   data=json.loads(block)
   if isinstance(data,dict) and '@context'not in data:errors.append(f'{rel}: schema context missing')
   if isinstance(data,list) and not all('@context'in d for d in data):errors.append(f'{rel}: array schema context missing')
  except ValueError as e:errors.append(f'{rel}: invalid JSON-LD {e}')
 for link in parsed.links:
  u=urlsplit(link)
  if u.scheme and u.scheme not in ['http','https']:continue
  if u.netloc and u.netloc!='relu.chat':continue
  if not u.path:
   if u.fragment and unquote(u.fragment)not in parsed.ids:errors.append(f'{rel}: missing anchor {link}')
   continue
  local=root/unquote(u.path).lstrip('/') if u.path.startswith('/') else path.parent/unquote(u.path)
  if local.is_dir():local=local/'index.html'
  if not local.exists():errors.append(f'{rel}: missing local resource {link}')
report={'indexed_pages':checked,'sitemap_urls':len(urls),'errors':sorted(set(errors))}
(root/'dev/exports/site-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2));raise SystemExit(bool(errors))
