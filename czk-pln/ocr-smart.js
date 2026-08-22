(()=>{
  'use strict';
  if(!window.Tesseract || typeof Tesseract.createWorker!=='function') return;

  const originalCreate=Tesseract.createWorker.bind(Tesseract);
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};
  const digits=s=>String(s||'').replace(/[^0-9]/g,'');

  function allWords(data){
    const out=[];
    const push=w=>{if(w&&w.bbox&&typeof w.text==='string')out.push(w)};
    if(Array.isArray(data?.words)) data.words.forEach(push);
    for(const b of (data?.blocks||[]))for(const p of (b.paragraphs||[]))for(const l of (p.lines||[]))for(const w of (l.words||[]))push(w);
    return out;
  }

  function symbolDigits(word){
    const syms=Array.isArray(word.symbols)?word.symbols:[];
    return syms.map(s=>({
      text:digits(s.text),
      bbox:s.bbox,
      confidence:Number(s.confidence??word.confidence??0)
    })).filter(s=>s.text.length===1&&s.bbox);
  }

  function mergedSplitCandidate(word){
    const raw=digits(word.text);
    if(raw.length<3||raw.length>6) return null;
    const syms=symbolDigits(word);
    if(syms.length!==raw.length) return null;

    const split=syms.length-2;
    const main=syms.slice(0,split), cents=syms.slice(split);
    if(!main.length||cents.length!==2) return null;

    const mh=median(main.map(s=>Math.max(1,s.bbox.y1-s.bbox.y0)));
    const ch=median(cents.map(s=>Math.max(1,s.bbox.y1-s.bbox.y0)));
    const mw=median(main.map(s=>Math.max(1,s.bbox.x1-s.bbox.x0)));
    const cw=median(cents.map(s=>Math.max(1,s.bbox.x1-s.bbox.x0)));
    if(!mh||!ch) return null;

    const heightRatio=ch/mh;
    const widthRatio=mw?cw/mw:1;
    const mainRight=Math.max(...main.map(s=>s.bbox.x1));
    const centsLeft=Math.min(...cents.map(s=>s.bbox.x0));
    const centsRight=Math.max(...cents.map(s=>s.bbox.x1));
    const mainLeft=Math.min(...main.map(s=>s.bbox.x0));
    const gap=centsLeft-mainRight;
    const mainSpan=Math.max(1,mainRight-mainLeft);

    // Najważniejszy sygnał: ostatnie dwie cyfry są wyraźnie mniejsze.
    // Dopuszczamy lekki overlap, bo Tesseract potrafi rozszerzać bbox symboli.
    if(heightRatio>0.84) return null;
    if(widthRatio>0.95 && heightRatio>0.72) return null;
    if(gap < -0.12*mw || gap > Math.max(mh*1.25,mainSpan*0.55)) return null;
    if(centsRight<=mainRight) return null;

    const whole=Number(raw.slice(0,-2)), dec=Number(raw.slice(-2));
    if(!Number.isFinite(whole)||whole<0||whole>99999||dec<0||dec>99) return null;

    const bbox={
      x0:Math.min(...syms.map(s=>s.bbox.x0)),
      y0:Math.min(...syms.map(s=>s.bbox.y0)),
      x1:Math.max(...syms.map(s=>s.bbox.x1)),
      y1:Math.max(...syms.map(s=>s.bbox.y1))
    };
    return {
      text:`${whole},${String(dec).padStart(2,'0')}`,
      confidence:Math.max(55,Math.min(99,Number(word.confidence??80)+5)),
      bbox,
      symbols:syms,
      _smartSplit:true,
      _heightRatio:heightRatio
    };
  }

  function enhance(data){
    if(!data) return data;
    const synthetic=[];
    for(const w of allWords(data)){
      // Jawny separator ma pierwszeństwo — niczego wtedy nie poprawiamy.
      if(/\d[.,]\d{2}/.test(String(w.text||''))) continue;
      const c=mergedSplitCandidate(w);
      if(c) synthetic.push(c);
    }
    if(synthetic.length){
      data.words=Array.isArray(data.words)?data.words.slice():[];
      const keys=new Set(data.words.map(w=>`${w.text}|${w.bbox?.x0}|${w.bbox?.y0}|${w.bbox?.x1}|${w.bbox?.y1}`));
      for(const s of synthetic){const k=`${s.text}|${s.bbox.x0}|${s.bbox.y0}|${s.bbox.x1}|${s.bbox.y1}`;if(!keys.has(k)){data.words.push(s);keys.add(k)}}
      data.smartSplits=synthetic.map(s=>({text:s.text,heightRatio:s._heightRatio}));
    }
    return data;
  }

  Tesseract.createWorker=async(...args)=>{
    const worker=await originalCreate(...args);
    const originalRecognize=worker.recognize.bind(worker);
    worker.recognize=async(...rargs)=>{
      const result=await originalRecognize(...rargs);
      if(result?.data) enhance(result.data);
      return result;
    };
    return worker;
  };
})();
