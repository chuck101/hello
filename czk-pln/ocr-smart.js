(()=>{
  'use strict';
  if(!window.Tesseract || typeof Tesseract.createWorker!=='function') return;

  const originalCreate=Tesseract.createWorker.bind(Tesseract);
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
  const digits=s=>String(s||'').replace(/[^0-9]/g,'');
  const h=b=>Math.max(1,b.y1-b.y0), w=b=>Math.max(1,b.x1-b.x0);
  const normDash=s=>String(s||'').replace(/[–—−]/g,'-');

  function allWords(data){
    const out=[],seen=new Set();
    const push=x=>{if(!x||!x.bbox||typeof x.text!=='string')return;const k=[x.text,x.bbox.x0,x.bbox.y0,x.bbox.x1,x.bbox.y1].join('|');if(seen.has(k))return;seen.add(k);out.push(x)};
    if(Array.isArray(data?.words))data.words.forEach(push);
    for(const b of (data?.blocks||[]))for(const p of (b.paragraphs||[]))for(const l of (p.lines||[]))for(const x of (l.words||[]))push(x);
    return out;
  }

  function symbolDigits(word){
    return (Array.isArray(word.symbols)?word.symbols:[]).map(s=>({text:digits(s.text),bbox:s.bbox,confidence:Number(s.confidence??word.confidence??0)})).filter(s=>s.text.length===1&&s.bbox);
  }

  function makeSynthetic(whole,cents,bbox,confidence,meta={}){
    whole=Number(whole);cents=Number(cents);
    if(!Number.isFinite(whole)||whole<0||whole>99999||!Number.isFinite(cents)||cents<0||cents>99)return null;
    return {text:`${whole},${String(cents).padStart(2,'0')}`,confidence:Math.max(55,Math.min(99,confidence||80)),bbox,_smartSplit:true,...meta};
  }

  function mergedSplitCandidate(word){
    const raw=digits(word.text);if(raw.length<3||raw.length>7)return null;
    const syms=symbolDigits(word);if(syms.length!==raw.length)return null;
    const main=syms.slice(0,-2),cents=syms.slice(-2);if(!main.length)return null;
    const mh=median(main.map(s=>h(s.bbox))),ch=median(cents.map(s=>h(s.bbox))),mw=median(main.map(s=>w(s.bbox))),cw=median(cents.map(s=>w(s.bbox)));if(!mh||!ch)return null;
    const hr=ch/mh,wr=mw?cw/mw:1;if(hr>0.93||(hr>0.88&&wr>0.92))return null;
    const gap=Math.min(...cents.map(s=>s.bbox.x0))-Math.max(...main.map(s=>s.bbox.x1));if(gap < -0.35*mw || gap > mh*2.2)return null;
    const bbox={x0:Math.min(...syms.map(s=>s.bbox.x0)),y0:Math.min(...syms.map(s=>s.bbox.y0)),x1:Math.max(...syms.map(s=>s.bbox.x1)),y1:Math.max(...syms.map(s=>s.bbox.y1))};
    return makeSynthetic(raw.slice(0,-2),raw.slice(-2),bbox,Number(word.confidence??80)+8,{_heightRatio:hr,_source:'merged-symbols'});
  }

  function separateSplitCandidates(words){
    const out=[];
    for(const main of words){
      const mt=digits(main.text);if(!/^\d{1,5}$/.test(mt)||!main.bbox)continue;
      const mh=h(main.bbox),mw=w(main.bbox),mcx=(main.bbox.x0+main.bbox.x1)/2,mcy=(main.bbox.y0+main.bbox.y1)/2;
      for(const cents of words){
        if(cents===main||!cents.bbox)continue;const ct=digits(cents.text);if(!/^\d{2}$/.test(ct))continue;
        const ch=h(cents.bbox),cw=w(cents.bbox),ccx=(cents.bbox.x0+cents.bbox.x1)/2,ccy=(cents.bbox.y0+cents.bbox.y1)/2,hr=ch/mh,wr=cw/mw;
        if(hr<0.20||hr>0.92||ccx<=mcx)continue;
        const gap=cents.bbox.x0-main.bbox.x1;if(gap < -0.30*mw || gap > Math.max(mh*2.4,mw*1.35))continue;
        if(Math.abs(ccy-mcy)>mh*0.95||(hr>0.82&&wr>0.95))continue;
        const bbox={x0:Math.min(main.bbox.x0,cents.bbox.x0),y0:Math.min(main.bbox.y0,cents.bbox.y0),x1:Math.max(main.bbox.x1,cents.bbox.x1),y1:Math.max(main.bbox.y1,cents.bbox.y1)};
        const s=makeSynthetic(mt,ct,bbox,Math.min(Number(main.confidence??80),Number(cents.confidence??80))+10,{_heightRatio:hr,_source:'separate-words'});if(s)out.push(s);
      }
    }
    return out;
  }

  function addSynthetic(data,synthetic){
    if(!synthetic.length)return;data.words=Array.isArray(data.words)?data.words.slice():[];
    const keys=new Set(data.words.map(x=>`${x.text}|${x.bbox?.x0}|${x.bbox?.y0}|${x.bbox?.x1}|${x.bbox?.y1}`));
    for(const s of synthetic){const k=`${s.text}|${s.bbox.x0}|${s.bbox.y0}|${s.bbox.x1}|${s.bbox.y1}`;if(!keys.has(k)){data.words.push(s);keys.add(k)}}
    data.smartSplits=(data.smartSplits||[]).concat(synthetic.map(s=>({text:s.text,source:s._source,heightRatio:s._heightRatio??null,rightRaw:s._rightRaw??null})));
  }

  function wholeDashCandidates(data){
    const out=[],words=allWords(data);
    for(const word of words){
      const t=normDash(word.text);
      const m=t.match(/(?:^|[^0-9])(\d{1,5})\s*[,\.]\s*-(?:$|[^0-9])/);
      if(m){const s=makeSynthetic(Number(m[1]),0,word.bbox,Number(word.confidence??80)+12,{_source:'whole-dash'});if(s)out.push(s)}
    }
    // Tesseract potrafi rozdzielić "8.-" na kilka słów. Wtedy korzystamy z tekstu całej linii
    // i bbox największej liczby całkowitej, ale tylko gdy w surowym OCR faktycznie jest kropka/przecinek + kreska.
    const raw=normDash(data?.text||'');
    const m=raw.match(/(?:^|[^0-9])(\d{1,5})\s*[,\.]\s*-(?:$|[^0-9])/);
    if(m){
      const n=Number(m[1]);
      const main=words.filter(x=>digits(x.text)===String(n)&&x.bbox).sort((a,b)=>(w(b.bbox)*h(b.bbox))-(w(a.bbox)*h(a.bbox)))[0];
      if(main){const s=makeSynthetic(n,0,main.bbox,Number(main.confidence??75)+10,{_source:'whole-dash-line'});if(s)out.push(s)}
    }
    return out;
  }

  function enhanceGeometry(data){
    if(!data)return;const words=allWords(data),synthetic=[];
    synthetic.push(...wholeDashCandidates(data));
    for(const x of words){if(!/\d[.,]\d{2}/.test(String(x.text||''))){const c=mergedSplitCandidate(x);if(c)synthetic.push(c)}}
    synthetic.push(...separateSplitCandidates(words));addSynthetic(data,synthetic);
  }

  function bestWholeWord(data){
    return allWords(data).filter(x=>/^\d{1,5}$/.test(digits(x.text))&&x.bbox).map(x=>({word:x,n:Number(digits(x.text)),confidence:Number(x.confidence??0),area:w(x.bbox)*h(x.bbox)})).filter(x=>x.n>0&&x.n<100000).sort((a,b)=>(b.confidence*2+b.area/100)-(a.confidence*2+a.area/100))[0]||null;
  }
  const hasDecimalCandidate=data=>allWords(data).some(x=>/\d{1,5}[.,]\d{2}/.test(String(x.text||'')));

  function makeRightCrop(image,mainBox,binary=false){
    if(!(image instanceof HTMLCanvasElement))return null;
    const H=image.height,W=image.width,mh=h(mainBox),mw=w(mainBox);
    const sx=Math.max(0,Math.min(W-1,Math.floor(mainBox.x1+Math.max(2,mh*0.03))));
    const sy=Math.max(0,Math.floor(mainBox.y0-mh*1.05));
    const ex=Math.min(W,Math.ceil(mainBox.x1+Math.max(mh*4.0,mw*2.4)));
    const ey=Math.min(H,Math.ceil(mainBox.y1+mh*0.75));
    const sw=Math.max(1,ex-sx),sh=Math.max(1,ey-sy);if(sw<8||sh<8)return null;

    const c=document.createElement('canvas');c.width=Math.min(1600,Math.max(500,Math.round(sw*5)));c.height=Math.max(220,Math.round(sh*c.width/sw));
    const cx=c.getContext('2d',{willReadFrequently:true});cx.imageSmoothingEnabled=true;cx.drawImage(image,sx,sy,sw,sh,0,0,c.width,c.height);
    if(binary){const im=cx.getImageData(0,0,c.width,c.height),d=im.data;for(let i=0;i<d.length;i+=4){const y=.299*d[i]+.587*d[i+1]+.114*d[i+2],v=y<190?0:255;d[i]=d[i+1]=d[i+2]=v}cx.putImageData(im,0,0)}
    return {canvas:c,sx,sy,sw,sh,binary};
  }

  function centsFromData(data,mainValue){
    const cand=[];
    for(const x of allWords(data)){const t=digits(x.text),conf=Number(x.confidence??0);if(/^\d{2}$/.test(t))cand.push({cents:Number(t),confidence:conf,text:t});else if(/^\d{3,7}$/.test(t)&&t!==String(mainValue))cand.push({cents:Number(t.slice(-2)),confidence:conf-10,text:t})}
    const raw=digits(data?.text||'');if(/^\d{2}$/.test(raw))cand.push({cents:Number(raw),confidence:60,text:raw});else if(/^\d{3,7}$/.test(raw)&&raw!==String(mainValue))cand.push({cents:Number(raw.slice(-2)),confidence:45,text:raw});
    return cand.filter(x=>x.cents>=0&&x.cents<=99).sort((a,b)=>b.confidence-a.confidence)[0]||null;
  }

  async function readRightSuffix(worker,originalRecognize,image,main,resultData){
    const attempts=[],configs=[{psm:'8',binary:true,label:'word-binary'},{psm:'11',binary:false,label:'sparse-gray'},{psm:'7',binary:false,label:'line-gray'}];
    try{
      for(const cfg of configs){
        const crop=makeRightCrop(image,main.word.bbox,cfg.binary);if(!crop)continue;
        await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:cfg.psm,preserve_interword_spaces:'1'});
        const rr=await originalRecognize(crop.canvas,{}, {text:true,blocks:true});
        const raw=String(rr?.data?.text||'').trim().replace(/\s+/g,' '),suffix=centsFromData(rr?.data,main.n);attempts.push({mode:cfg.label,raw,found:suffix?.cents??null});
        if(suffix){resultData.smartRightPass={main:main.n,attempts};return {suffix,crop,raw}}
      }
      resultData.smartRightPass={main:main.n,attempts};return null;
    } finally {
      await worker.setParameters({tessedit_char_whitelist:'0123456789,.-',tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'}).catch(()=>{});
    }
  }

  Tesseract.createWorker=async(...args)=>{
    const worker=await originalCreate(...args),originalRecognize=worker.recognize.bind(worker),originalSetParameters=worker.setParameters.bind(worker);
    // Główny skaner wcześniej zabraniał znaku '-', więc Tesseract fizycznie nie mógł zwrócić "8.-".
    // Rozszerzamy tylko whitelisty cenowe (z kropką/przecinkiem), pozostawiając cyfrowe fallbacki bez zmian.
    worker.setParameters=async params=>{
      const p={...(params||{})};
      if(typeof p.tessedit_char_whitelist==='string'&&(p.tessedit_char_whitelist.includes(',')||p.tessedit_char_whitelist.includes('.'))&&!p.tessedit_char_whitelist.includes('-'))p.tessedit_char_whitelist+='-';
      return originalSetParameters(p);
    };
    worker.recognize=async(...rargs)=>{
      const result=await originalRecognize(...rargs);if(!result?.data)return result;
      enhanceGeometry(result.data);
      const image=rargs[0];
      if(!hasDecimalCandidate(result.data)&&image instanceof HTMLCanvasElement){
        const main=bestWholeWord(result.data);
        if(main){
          try{
            const right=await readRightSuffix(worker,originalRecognize,image,main,result.data);
            if(right){
              const bbox={x0:main.word.bbox.x0,y0:Math.min(main.word.bbox.y0,right.crop.sy),x1:Math.min(image.width,right.crop.sx+right.crop.sw),y1:Math.max(main.word.bbox.y1,Math.min(image.height,right.crop.sy+right.crop.sh))};
              const synthetic=makeSynthetic(main.n,right.suffix.cents,bbox,Math.min(98,Math.max(main.confidence,right.suffix.confidence)+8),{_source:'second-pass-right',_rightRaw:right.raw});if(synthetic)addSynthetic(result.data,[synthetic]);
            }
          }catch(e){result.data.smartRightPass={main:main.n,error:String(e?.message||e)};console.debug('OCR right-suffix fallback failed',e)}
        }
      }
      return result;
    };
    return worker;
  };
})();
