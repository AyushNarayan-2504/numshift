/* Browser-only PDF exporter. Pages are rasterised to preserve Unicode and emoji rendering. */
window.NumShiftPdf = (() => {
  const WIDTH=1240,HEIGHT=1754,MARGIN=95,MAX_PAGES=150;
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
  const graphemes=text=>segmenter?Array.from(segmenter.segment(text),part=>part.segment):Array.from(text);
  function wrapLine(ctx,text,maxWidth){
    if(!text)return [''];const units=graphemes(text),result=[];let line='',lastSpace=-1;
    for(const char of units){
      const next=line+char;
      if(line && ctx.measureText(next).width>maxWidth){
        if(lastSpace>=0){result.push(line.slice(0,lastSpace+1));line=line.slice(lastSpace+1)+char}
        else {result.push(line);line=char}
        lastSpace=-1;for(let i=0;i<line.length;i++)if(/\s/.test(line[i]))lastSpace=i;
      }else{line=next;if(/\s/.test(char))lastSpace=line.length-1}
    }
    result.push(line);return result;
  }
  async function download(title,body){
    if(!window.jspdf?.jsPDF)throw new Error('PDF exporter could not be loaded.');
    if(!title.trim()&&!body.trim())throw new Error('Add a title or content before downloading.');
    const pdf=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
    let canvas,ctx,y,pages=0;const previews=[];
    function beginPage(){canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas rendering is not supported by this browser.');ctx.fillStyle='#fff';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.fillStyle='#151a19';ctx.textBaseline='top';y=MARGIN}
    async function finishPage(){if(pages>=MAX_PAGES)throw new Error('This export exceeds the 150-page limit. Please split the content.');if(pages)pdf.addPage('a4','portrait');const image=canvas.toDataURL('image/jpeg',0.94);previews.push(image);pdf.addImage(image,'JPEG',0,0,210,297,undefined,'FAST');pages++;await new Promise(resolve=>setTimeout(resolve,0))}
    async function line(text,font,lineHeight){ctx.font=font;const wrapped=wrapLine(ctx,text,WIDTH-MARGIN*2);for(const part of wrapped){if(y+lineHeight>HEIGHT-MARGIN){await finishPage();beginPage();ctx.font=font}ctx.fillText(part,MARGIN,y);y+=lineHeight}}
    beginPage();
    if(title.trim()){for(const item of title.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n'))await line(item,'700 38px Arial, "Noto Sans", sans-serif',55);y+=24}
    if(body){for(const item of body.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n'))await line(item,'26px Arial, "Noto Sans", sans-serif',42)}
    await finishPage();
    const safe=title.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').replace(/\s+/g,' ').slice(0,70).trim()||'numshift-export';
    return {version:2,pages,bytes:pdf.output('arraybuffer'),previews,filename:safe+'.pdf'};
  }
  return {download};
})();
