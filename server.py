#!/usr/bin/env python3
"""NumShift server: opt-in OpenAI title generation and workspace exports."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
from collections import deque
import threading, time, re
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime, timezone
import json, secrets, os

ROOT=Path(__file__).resolve().parent
EXPORTS=ROOT/'exports'
MAX_BYTES=50*1024*1024
ROUTES={'/api/save-pdf','/api/save-zip','/api/generate-titles'}
STATIC_FILES={'index.html','landing.css','landing.js','ai-titles.js','importers.js','exporter.js','session.js','robots.txt'}
WORKSPACE_EXPORTS=os.environ.get('NUMSHIFT_WORKSPACE_EXPORTS','true').lower() in ('1','true','yes')
ALLOW_NULL_ORIGIN=os.environ.get('NUMSHIFT_ALLOW_NULL_ORIGIN','true').lower() in ('1','true','yes')
try:AI_DAILY_LIMIT=max(1,int(os.environ.get('AI_DAILY_LIMIT','100')))
except ValueError:AI_DAILY_LIMIT=100
AI_LOCK=threading.Lock();AI_GLOBAL=deque();AI_DAY=deque();AI_SESSIONS={};AI_SLOTS=threading.BoundedSemaphore(4)
def ai_allowed(session):
    now=time.monotonic();cutoff=now-60
    with AI_LOCK:
        while AI_GLOBAL and AI_GLOBAL[0]<cutoff:AI_GLOBAL.popleft()
        while AI_DAY and AI_DAY[0]<now-86400:AI_DAY.popleft()
        if len(AI_DAY)>=AI_DAILY_LIMIT:return False
        for key in list(AI_SESSIONS):
            q=AI_SESSIONS[key]
            while q and q[0]<cutoff:q.popleft()
            if not q:del AI_SESSIONS[key]
        bucket=AI_SESSIONS.get(session)
        if len(AI_GLOBAL)>=60 or (bucket is not None and len(bucket)>=8):return False
        if bucket is None:
            if len(AI_SESSIONS)>=4096:return False
            bucket=AI_SESSIONS.setdefault(session,deque())
        bucket.append(now);AI_GLOBAL.append(now);AI_DAY.append(now);return True

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def end_headers(self):
        origin=self.headers.get('Origin');host=self.headers.get('Host','')
        if (origin=='null' and ALLOW_NULL_ORIGIN) or (origin and origin!='null' and urlsplit(origin).netloc==host):
            self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
            self.send_header('Access-Control-Allow-Methods','POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type, X-Numshift-Export, X-Numshift-Session')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        super().end_headers()
    def static_allowed(self):
        # Never expose workspace exports, server source or arbitrary files over HTTP.
        try:
            path=Path(self.translate_path(self.path)).resolve()
            relative=path.relative_to(ROOT)
        except (OSError,ValueError):return False
        name=relative.as_posix()
        if name=='.':name='index.html'
        return name in STATIC_FILES or (len(relative.parts)>=2 and relative.parts[0] in ('assets','vendor') and path.is_file())
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/healthz':self.send_json(200,{'status':'ok'});return
        if path=='/api/config':self.send_json(200,{'workspaceExports':WORKSPACE_EXPORTS});return
        if not self.static_allowed():self.send_error(404);return
        super().do_GET()
    def do_HEAD(self):
        if not self.static_allowed():self.send_error(404);return
        super().do_HEAD()
    def send_json(self,code,obj):
        data=json.dumps(obj,ensure_ascii=False).encode('utf-8');self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
    def do_OPTIONS(self):
        if urlsplit(self.path).path not in ROUTES:self.send_error(404);return
        self.send_response(204);self.end_headers()
    def do_POST(self):
        path=urlsplit(self.path).path
        if path not in ROUTES:self.send_error(404);return
        origin=self.headers.get('Origin');host=self.headers.get('Host','')
        if origin and not ((origin=='null' and ALLOW_NULL_ORIGIN) or (origin!='null' and urlsplit(origin).netloc==host)):
            self.send_json(403,{'error':'Request origin not allowed.'});return
        if path in ('/api/save-pdf','/api/save-zip') and not WORKSPACE_EXPORTS:
            self.send_json(403,{'error':'Workspace save is disabled on this deployment. Download the file in a regular browser tab.'});return
        if self.headers.get('X-Numshift-Export')!='1':self.send_json(403,{'error':'Request not allowed.'});return
        session=self.headers.get('X-Numshift-Session','')
        if not re.fullmatch(r'[0-9a-f]{32}',session):self.send_json(400,{'error':'Invalid session. Refresh the app and try again.'});return
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:self.send_json(400,{'error':'Invalid content length.'});return
        limit=8192 if path=='/api/generate-titles' else MAX_BYTES
        if not 1<=length<=limit:self.send_json(413,{'error':'Request is too large.'});return
        data=self.rfile.read(length)
        if len(data)!=length:self.send_json(400,{'error':'Incomplete request.'});return
        if path=='/api/generate-titles':
            try:
                body=json.loads(data)
                title=body.get('title','').strip()
                count=body.get('count')
                if not isinstance(title,str) or not 1<=len(title)<=1000 or type(count) is not int or not 1<=count<=30:
                    raise ValueError()
            except (AttributeError,TypeError,ValueError,json.JSONDecodeError):
                self.send_json(400,{'error':'Enter a title (up to 1,000 characters) and choose 1–30 titles.'});return
            if not ai_allowed(session):self.send_json(429,{'error':'AI rate or shared daily limit reached. Please try again later.'});return
            if not AI_SLOTS.acquire(blocking=False):self.send_json(429,{'error':'AI is busy. Please try again shortly.'});return
            try:self.generate_titles(data)
            finally:AI_SLOTS.release()
            return
        extension='pdf' if path=='/api/save-pdf' else 'zip'
        signature=b'%PDF-' if extension=='pdf' else b'PK\x03\x04'
        if not data.startswith(signature):self.send_json(400,{'error':'Invalid '+extension.upper()+' data.'});return
        EXPORTS.mkdir(mode=0o700,parents=True,exist_ok=True);EXPORTS.chmod(0o700)
        folder=EXPORTS/session;folder.mkdir(mode=0o700,exist_ok=True);folder.chmod(0o700)
        filename='numshift-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(8)+'.'+extension
        target=folder/filename
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as output:output.write(data)
        (folder/'latest.txt').write_text(filename,encoding='utf-8')
        self.send_json(200,{'filename':filename})
    def generate_titles(self,data):
        key=os.environ.get('OPENAI_API_KEY','').strip()
        if not key:self.send_json(503,{'error':'OpenAI is not configured. Set OPENAI_API_KEY in the server environment and restart.'});return
        try:
            body=json.loads(data);title=body.get('title','').strip();count=body.get('count')
            if not isinstance(title,str) or not 1<=len(title)<=1000 or type(count) is not int or not 1<=count<=30:raise ValueError()
        except (ValueError,TypeError,AttributeError,json.JSONDecodeError):self.send_json(400,{'error':'Enter a title (up to 1,000 characters) and choose 1–30 titles.'});return
        model=os.environ.get('OPENAI_MODEL','gpt-4o-mini')
        payload={'model':model,'messages':[{'role':'system','content':'You create distinct, natural-sounding title variations. Preserve the original meaning, language, names, and factual claims. Do not invent information. Return exactly the requested number of unique titles. Do not add emoji, decorative symbols, numbering, quotation marks, or markdown; a separate application will add decorations.'},{'role':'user','content':f'Original title: {title}\nNumber of title variations: {count}'}], 'response_format':{'type':'json_schema','json_schema':{'name':'title_variations','strict':True,'schema':{'type':'object','properties':{'titles':{'type':'array','items':{'type':'string'}}},'required':['titles'],'additionalProperties':False}}},'temperature':0.8,'max_tokens':3000}
        request=Request('https://api.openai.com/v1/chat/completions',data=json.dumps(payload,ensure_ascii=False).encode('utf-8'),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
        try:
            with urlopen(request,timeout=60) as response:result=json.loads(response.read())
            message=result['choices'][0]['message']
            if message.get('refusal'):raise ValueError('The AI declined this request.')
            raw=json.loads(message['content']);titles=[];seen=set()
            for val in raw.get('titles',[]):
                if not isinstance(val,str):continue
                val=val.strip().strip('"').strip()
                if val and val.casefold() not in seen:titles.append(val);seen.add(val.casefold())
            if not titles:raise ValueError('The AI did not return any usable titles.')
            self.send_json(200,{'titles':titles[:count]})
        except HTTPError as error:
            message='OpenAI request failed.'
            if error.code==401:message='OpenAI rejected the API key. Check the server configuration.'
            elif error.code==429:message='OpenAI rate limit or quota reached. Please try again later.'
            self.send_json(502,{'error':message})
        except (URLError,TimeoutError):self.send_json(502,{'error':'Could not reach OpenAI. Please try again.'})
        except (KeyError,IndexError,TypeError,ValueError,json.JSONDecodeError):self.send_json(502,{'error':'Could not read title variations from OpenAI. Please try again.'})

if __name__=='__main__':ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','3000'))),Handler).serve_forever()
