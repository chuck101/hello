(()=>{
  'use strict';
  if(!window.Tesseract || typeof Tesseract.createWorker!=='function') return;

  const originalCreate=Tesseract.createWorker.bind(Tesseract);
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
  const digits=s=>String(s||'').replace(/[^0-9]/g,'');
  const h=b=>Math.max(1,b.y1-b.y0);
  const w=b=>Math.max(1,b.x1-b.x0);

  function allWords(data){
    const out=[],seen=new Set();
    const push=x=>{
      if(!x||!x.bbox||typeof x.text!=='string')return;
      const k=[x.text,x.bbox.x0,x.bbox.y0,x.bbox.x1,x.bbox.y1].join('|');
      if(seen.has(k))return;seen.add(k);out.push(x);
    };
    if(Array.isArray(data?.words))data.words.forEach(push);
    for(const b of (data?.blocks||[]))for(const p of (b.paragraphs||[]))for(const l of (p.lines||[]))for(const x of (l.words||[]))push(x);
    return out;
  }

  function symbolDigits(word){
    const syms=Array.isArray(word.symbols)?word.symbols:[];
    return syms.map(s=>({text:digits(s.text),bbox:s.bbox,confidence:Number(s.confidence??word.confidence??0)})).filter(s=>s.text.length===1&&s.bbox);
  }

  function makeSynthetic(whole,cents,bbox,confidence,meta={}){
    whole=Number(whole);cents=Number(cents);
    if(!Number.isFinite(whole)||whole<0||whole>99999||!Number.isFinite(cents)||cents<0||cents>99)return null;
    return {text:`${whole},${String(cents).padStart(2,'0')}`,confidence:Math.max(55,Math.min(99,confidence||80)),bbox,_smartSplit:true,...meta};
  }

  function mergedSplitCandidate(word){
    const raw=digits(word.text);
    if(raw.length<3||raw.length>7)return null;
    const syms=symbolDigits(word);
    if(syms.length!==raw.length)return null;
    const main=syms.slice(0,-2),cents=syms.slice(-2);
    if(!main.length)return null;
    const mh=median(main.map(s=>h(s.bbox))),ch=median(cents.map(s=>h(s.bbox))),mw=median(main.map(s=>w(s.bbox))),cw=median(cents.map(s=>w(s.bbox)));
    if(!mh||!ch)return null;
    const hr=ch/mh,wr=mw?cw/mw:1;
    if(hr>0.93)return null;
    if(hr>0.88&&wr>0.92)return null;
    const mainRight=Math.max(...main.map(s=>s.bbox.x1)),centsLeft=Math.min(...cents.map(s=>s.bbox.x0)),gap=centsLeft-mainRight;
    if(gap < -0.35*mw || gap > mh*2.2)return null;
    const bbox={x0:Math.min(...syms.map(s=>s.bbox.x0)),y0:Math.min(...syms.map(s=>s.bbox.y0)),x1:Math.max(...syms.map(s=>s.bbox.x1)),y1:Math.max(...syms.map(s=>s.bbox.y1))};
    return makeSynthetic(raw.slice(0,-2),raw.slice(-2),bbox,Number(word.confidence??80)+8,{_heightRatio:hr,_source:'merged-symbols'});
  }

  function separateSplitCandidates(words){
    const out=[];
    for(const main of words){
      const mt=digits(main.text);
      if(!/^\d{1,5}$/.test(mt)||!main.bbox)continue;
      const mh=h(main.bbox),mw=w(main.bbox),mcx=(main.bbox.x0+main.bbox.x1)/2,mcy=(main.bbox.y0+main.bbox.y1)/2;
      for(const cents of words){
        if(cents===main||!cents.bbox)continue;
        const ct=digits(cents.text);
        if(!/^\d{2}$/.test(ct))continue;
        const ch=h(cents.bbox),cw=w(cents.bbox),ccx=(cents.bbox.x0+cents.bbox.x1)/2,ccy=(cents.bbox.y0+cents.bbox.y1)/2;
        const hr=ch/mh,wr=cw/mw;
        if(hr<0.20||hr>0.92||ccx<=mcx)continue;
        const gap=cents.bbox.x0-main.bbox.x1;
        if(gap < -0.30*mw || gap > Math.max(mh*2.4,mw*1.35))continue;
        if(Math.abs(ccy-mcy)>mh*0.95)continue;
        if(hr>0.82&&wr>0.95)continue;
        const bbox={x0:Math.min(main.bbox.x0,cents.bbox.x0),y0:Math.min(main.bbox.y0,cents.bbox.y0),x1:Math.max(main.bbox.x1,cents.bbox.x1),y1:Math.max(main.bbox.y1,cents.bbox.y1)};
        const s=makeSynthetic(mt,ct,bbox,Math.min(Number(main.confidence??80),Number(cents.confidence??80))+10,{_heightRatio:hr,_source:'separate-words'});
        if(s)out.push(s);
      }
    }
    return out;
  }

  function addSynthetic(data,synthetic){
    if(!synthetic.length)return;
    data.words=Array.isArray(data.words)?data.words.slice():[];
    const keys=new Set(data.words.map(x=>`${x.text}|${x.bbox?.x0}|${x.bbox?.y0}|${x.bbox?.x1}|${x.bbox?.y1}`));
    for(const s of synthetic){
      const k=`${s.text}|${s.bbox.x0}|${s.bbox.y0}|${s.bbox.x1}|${s.bbox.y1}`;
      if(!keys.has(k)){data.words.push(s);keys.add(k)}
    }
    data.smartSplits=(data.smartSplits||[]).concat(synthetic.map(s=>({text:s.text,source:s._source,heightRatio:s._heightRatio??null})));
  }

  function enhanceGeometry(data){
    if(!data)return;
    const words=allWords(data),synthetic=[];
    for(const x of words){if(!/\d[.,]\d{2}/.test(String(x.text||''))){const c=mergedSplitCandidate(x);if(c)synthetic.push(c)}}
    synthetic.push(...separateSplitCandidates(words));
    addSynthetic(data,synthetic);
  }

  function bestWholeWord(data){
    const words=allWords(data)
      .filter(x=>/^\d{1,5}$/.test(digits(x.text))&&x.bbox)
      .map(x=>({word:x,n:Number(digits(x.text)),confidence:Number(x.confidence??0),area:w(x.bbox)*h(x.bbox)}))
      .filter(x=>x.n>0&&x.n<100000)
      .sort((a,b)=>(b.confidence*2+b.area/100)-(a.confidence*2+a.area/100));
    return words[0]||null;
  }

  function hasDecimalCandidate(data){
    return allWords(data).some(x=>/\d{1,5}[.,]\d{2}/.test(String(x.text||'')));
  }

  function makeRightCrop(image,mainBox){
    if(!(image instanceof HTMLCanvasElement))return null;
    const H=image.height,W=image.width,mh=h(mainBox),mw=w(mainBox);
    // Zaczynamy tuż przed prawą krawędzią dużej ceny, żeby nie uciąć małych cyfr.
    const sx=Math.max(0,Math.floor(mainBox.x1-Math.max(4,mw*0.06)));
    const sy=Math.max(0,Math.floor(mainBox.y0-mh*0.75));
    const ex=Math.min(W,Math.ceil(mainBox.x1+Math.max(mh*3.2,mw*1.8)));
    const ey=Math.min(H,Math.ceil(mainBox.y1+mh*0.75));
    const sw=Math.max(1,ex-sx),sh=Math.max(1,ey-sy);
    if(sw<8||sh<8)return null;

    const c=document.createElement('canvas');
    // Małe cyfry powiększamy 4x przed drugim OCR.
    c.width=Math.min(1400,Math.max(320,sw*4));
    c.height=Math.max(180,Math.round(sh*c.width/sw));
    const cx=c.getContext('2d',{willReadFrequently:true});
    cx.imageSmoothingEnabled=true;
    cx.drawImage(image,sx,sy,sw,sh,0,0,c.width,c.height);
    return {canvas:c,sx,sy,sw,sh,scaleX:c.width/sw,scaleY:c.height/sh};
  }

  function centsFromRightData(data,mainValue){
    const candidates=[];
    for(const x of allWords(data)){
      const t=digits(x.text),conf=Number(x.confidence??0);
      if(/^\d{2}$/.test(t))candidates.push({cents:Number(t),confidence:conf,text:t});
      // Jeśli drugi OCR złapał fragment dużej ceny razem z końcówką, bierzemy ostatnie 2 cyfry,
      // ale tylko gdy prefiks nie jest identyczny z całą dużą ceną bez końcówki.
      if(/^\d{3,7}$/.test(t)&&t!==String(mainValue))candidates.push({cents:Number(t.slice(-2)),confidence:conf-8,text:t});
    }
    const raw=digits(data?.text||'');
    if(/^\d{2}$/.test(raw))candidates.push({cents:Number(raw),confidence:55,text:raw});
    if(/^\d{3,7}$/.test(raw)&&raw!==String(mainValue))candidates.push({cents:Number(raw.slice(-2)),confidence:45,text:raw});
    return candidates.filter(x=>x.cents>=0&&x.cents<=99).sort((a,b)=>b.confidence-a.confidence)[0]||null;
  }

  Tesseract.createWorker=async(...args)=>{
    const worker=await originalCreate(...args);
    const originalRecognize=worker.recognize.bind(worker);
    worker.recognize=async(...rargs)=>{
      const result=await originalRecognize(...rargs);
      if(!result?.data)return result;

      enhanceGeometry(result.data);

      // Najważniejszy fallback: jeżeli pierwszy OCR zwrócił tylko np. "49",
      // wykonujemy drugi OCR na małym obszarze po prawej stronie dużej ceny.
      const image=rargs[0];
      if(!hasDecimalCandidate(result.data) && image instanceof HTMLCanvasElement){
        const main=bestWholeWord(result.data);
        if(main){
          const crop=makeRightCrop(image,main.word.bbox);
          if(crop){
            try{
              const rr=await originalRecognize(crop.canvas,{}, {text:true,blocks:true});
              const suffix=centsFromRightData(rr?.data,main.n);
              if(suffix){
                const bbox={x0:main.word.bbox.x0,y0:Math.min(main.word.bbox.y0,crop.sy),x1:Math.min(image.width,crop.sx+crop.sw),y1:Math.max(main.word.bbox.y1,Math.min(image.height,crop.sy+crop.sh))};
                const synthetic=makeSynthetic(main.n,suffix.cents,bbox,Math.min(98,Math.max(main.confidence,suffix.confidence)+8),{_source:'second-pass-right',_rightRaw:String(rr?.data?.text||'').trim()});
                if(synthetic)addSynthetic(result.data,[synthetic]);
              }
            }catch(e){
              console.debug('OCR right-suffix fallback failed',e);
            }
          }
        }
      }
      return result;
    };
    return worker;
  };
})();
