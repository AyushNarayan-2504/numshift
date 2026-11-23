/* Local, browser-side extraction. The original file never leaves the browser. */
window.NumShiftImport = (() => {
  const supported = new Set(['txt','md','markdown','csv','tsv','json','xml','html','htm','pdf','docx','xlsx','pptx']);
  const textTypes = new Set(['txt','md','markdown','csv','tsv','json','xml']);
  function xml(text) {
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.querySelector('parsererror')) throw new Error('This file contains invalid XML.');
    return doc;
  }
  const tags=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
  const textOf=(node,name)=>tags(node,name).map(e=>e.textContent).join('');
  async function zipFile(zip,path){const f=zip.file(path);return f?await f.async('string'):null}
  async function coreTitle(zip){const content=await zipFile(zip,'docProps/core.xml');return content?(tags(xml(content),'title')[0]?.textContent||'').trim():''}
  function paragraphText(p){let parts=[];function visit(node){if(node.nodeType===1){if(node.localName==='t'){parts.push(node.textContent);return}if(node.localName==='tab'){parts.push('\t');return}if(node.localName==='br'||node.localName==='cr'){parts.push('\n');return}}for(const child of node.childNodes)visit(child)}visit(p);return parts.join('')}
  // Remove one standalone copy of the title near the beginning, without changing later body mentions.
  function removeLeadingTitle(content,title){
    if(!title||!content)return content;
    const normalize=value=>value.replace(/\s+/g,' ').trim().toLocaleLowerCase();
    const wanted=normalize(title);if(!wanted)return content;
    const lines=content.split('\n');let nonEmpty=0;
    for(let start=0;start<lines.length;start++){
      if(!lines[start].trim())continue;
      if(++nonEmpty>12)break;
      let candidate='';
      for(let end=start;end<Math.min(lines.length,start+5);end++){
        if(!lines[end].trim())break;
        candidate+=(candidate?' ':'')+lines[end];const normalized=normalize(candidate);
        if(normalized===wanted){lines.splice(start,end-start+1);return lines.join('\n').replace(/^\s*\n/,'')}
        if(!wanted.startsWith(normalized))break;
      }
    }
    return content;
  }
  async function readDocx(zip){
    const content=await zipFile(zip,'word/document.xml');if(!content)throw new Error('Could not find document content in this DOCX.');
    let title=await coreTitle(zip),parts=[],firstHeading=null,titleRemoved=false;const doc=xml(content);
    for(const p of tags(doc,'p')){const val=paragraphText(p);if(!val.trim())continue;const style=tags(p,'pStyle')[0];const styleName=style?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','val')||style?.getAttribute('w:val')||'';if(firstHeading===null && /^(title|heading\s*1)$/i.test(styleName))firstHeading={index:parts.length,text:val.trim()};parts.push(val)}
    if(firstHeading && (!title||firstHeading.text===title)){if(!title)title=firstHeading.text;parts.splice(firstHeading.index,1);titleRemoved=true}
    let body=parts.join('\n');if(title&&!titleRemoved)body=removeLeadingTitle(body,title);
    return {title,content:body,note:'DOCX text extracted; tables are read in document order.'};
  }
  async function readPptx(zip){
    let title=await coreTitle(zip),titleRemoved=false;const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));if(!names.length)throw new Error('No slides found in this PPTX.');
    let slides=[];for(const [index,name] of names.entries()){const doc=xml(await zipFile(zip,name)),texts=[];for(const shape of tags(doc,'sp')){const paragraphs=tags(shape,'p').map(paragraphText).filter(Boolean);const ph=tags(shape,'ph')[0];const kind=ph?.getAttribute('type')||'';const isTitle=index===0 && (kind==='title'||kind==='ctrTitle');const shapeText=paragraphs.join('\n');if(isTitle && shapeText && !title){title=shapeText;titleRemoved=true;continue}if(isTitle && shapeText===title){titleRemoved=true;continue}texts.push(...paragraphs)}slides.push('Slide '+(index+1)+'\n'+texts.join('\n'))}
    let body=slides.join('\n\n');if(title&&!titleRemoved)body=removeLeadingTitle(body,title);return {title,content:body,note:'Slide text extracted; speaker notes and images are not included.'};
  }
  async function readXlsx(zip){
    const title=await coreTitle(zip),sharedXml=await zipFile(zip,'xl/sharedStrings.xml');const shared=sharedXml?tags(xml(sharedXml),'si').map(si=>textOf(si,'t')):[];
    const workbook=await zipFile(zip,'xl/workbook.xml');const sheets=workbook?tags(xml(workbook),'sheet').map(x=>x.getAttribute('name')):[];
    const names=Object.keys(zip.files).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/sheet(\d+)/)[1])-Number(b.match(/sheet(\d+)/)[1]));if(!names.length)throw new Error('No worksheets found in this XLSX.');
    let all=[];for(const [i,path] of names.entries()){const doc=xml(await zipFile(zip,path)),lines=[];for(const row of tags(doc,'row')){const cells=[];for(const cell of tags(row,'c')){const ref=cell.getAttribute('r')||'',letters=(ref.match(/^[A-Z]+/i)||[''])[0].toUpperCase();let column=0;for(const c of letters)column=column*26+c.charCodeAt(0)-64;if(column>256)throw new Error('Worksheet exceeds 256 columns; please export as CSV.');const v=tags(cell,'v')[0]?.textContent||'',type=cell.getAttribute('t');let value=type==='s'?(shared[Number(v)]||''):type==='inlineStr'?textOf(cell,'t'):type==='b'?(v==='1'?'TRUE':'FALSE'):v;cells[column?column-1:cells.length]=value}lines.push(Array.from({length:cells.length},(_,j)=>cells[j]||'').join('\t'))}all.push('Sheet: '+(sheets[i]||String(i+1))+'\n'+lines.join('\n'))}
    return {title,content:all.join('\n\n'),note:'Cell values extracted as tab-separated text; formatting and formulas may differ.'};
  }
  async function readPdf(file){
    if(!window.pdfjsLib)throw new Error('PDF reader could not be loaded.');pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js';const data=await file.arrayBuffer();const task=pdfjsLib.getDocument({data});const pdf=await task.promise;let title='';try{const meta=await pdf.getMetadata();title=(meta.info?.Title||'').trim()}catch(_){}let pages=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const tc=await page.getTextContent();let out='',lastY=null;for(const item of tc.items){if(typeof item.str!=='string')continue;const y=item.transform?.[5];if(out && lastY!==null && y!==undefined && Math.abs(lastY-y)>3 && !out.endsWith('\n'))out+='\n';else if(out && !/\s$/.test(out) && item.str && !/^\s/.test(item.str))out+=' ';out+=item.str;if(item.hasEOL&&!out.endsWith('\n'))out+='\n';if(y!==undefined)lastY=y}pages.push(out.trim())}return {title,content:removeLeadingTitle(pages.join('\n\n'),title),note:'PDF text extracted. Scanned PDFs and images require OCR, which is not available yet.'};
  }
  function readHtml(source){const doc=new DOMParser().parseFromString(source,'text/html');const title=(doc.querySelector('h1')?.textContent||doc.querySelector('title')?.textContent||'').trim();doc.querySelectorAll('script,style,noscript,template,head').forEach(e=>e.remove());const heading=doc.querySelector('h1');if(heading&&heading.textContent.trim()===title)heading.remove();let out='';const blocks=new Set(['P','DIV','SECTION','ARTICLE','HEADER','FOOTER','LI','H1','H2','H3','H4','H5','H6','TR','BR']);function visit(n){if(n.nodeType===3){out+=n.nodeValue;return}if(n.nodeType!==1)return;const block=blocks.has(n.tagName);if(block&&out&&!out.endsWith('\n'))out+='\n';for(const child of n.childNodes)visit(child);if(block&&!out.endsWith('\n'))out+='\n'}visit(doc.body);return {title,content:out.replace(/\n[ \t]*\n[ \t]*\n/g,'\n\n').trim(),note:'HTML text extracted; visual formatting is not retained.'}}
  async function read(file){
    const ext=(file.name.split('.').pop()||'').toLowerCase();if(!supported.has(ext))throw new Error('Unsupported file type. Use TXT, MD, CSV, TSV, JSON, XML, HTML, PDF, DOCX, XLSX or PPTX.');
    if(file.size>20*1024*1024)throw new Error('File is larger than the 20 MB limit.');
    if(ext==='pdf')return readPdf(file);
    if(ext==='html'||ext==='htm')return readHtml(await file.text());
    if(textTypes.has(ext)){let content=await file.text(),title='';if(ext==='md'||ext==='markdown'){const m=content.match(/^\s*#\s+([^\r\n]+)(?:\r?\n|$)/);if(m){title=m[1].trim();content=content.slice(m[0].length)}}return {title,content,note:'Text imported. A title is separated when it is explicitly identifiable.'}}
    if(!window.JSZip)throw new Error('Office file reader could not be loaded.');const zip=await JSZip.loadAsync(await file.arrayBuffer());let expanded=0;for(const entry of Object.values(zip.files)){expanded+=entry._data?.uncompressedSize||0;if(expanded>100*1024*1024)throw new Error('This file expands beyond the 100 MB safety limit.')}
    if(ext==='docx')return readDocx(zip);if(ext==='pptx')return readPptx(zip);return readXlsx(zip);
  }
  return {read};
})();
