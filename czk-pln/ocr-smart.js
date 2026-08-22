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
    if(Array.isArray(data?.words)) data.words.forEach(push);
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
    return {
      text:`${whole},${String(cents).padStart(2,'0')}`,
      confidence:Math.max(55,Math.min(99,confidence||80)),
      bbox,
      _smartSplit:true,
      ...meta
    };
  }

  // Przypadek: Tesseract zwraca jedno słowo "4995", ale dwie ostatnie cyfry
  // są fizycznie mniejsze. Rozdzielamy po rozmiarach symboli.
  function mergedSplitCandidate(word){
    const raw=digits(word.text);
    if(raw.length<3||raw.length>7)return null;
    const syms=symbolDigits(word);
    if(syms.length!==raw.length)return null;

    const split=syms.length-2,main=syms.slice(0,split),cents=syms.slice(split);
    if(!main.length)return null;
    const mh=median(main.map(s=>h(s.bbox))),ch=median(cents.map(s=>h(s.bbox)));
    const mw=median(main.map(s=>w(s.bbox))),cw=median(cents.map(s=>w(s.bbox)));
    if(!mh||!ch)return null;

    const hr=ch/mh,wr=mw?cw/mw:1;
    // Wystarczy, że końcówka jest zauważalnie mniejsza. Tesseract często zawyża bbox,
    // więc próg musi być łagodniejszy niż wcześniej.
    if(hr>0.93)return null;
    if(hr>0.88&&wr>0.92)return null;

    const mainRight=Math.max(...main.map(s=>s.bbox.x1));
    const centsLeft=Math.min(...cents.map(s=>s.bbox.x0));
    const gap=centsLeft-mainRight;
    if(gap < -0.35*mw || gap > mh*2.2)return null;

    const bbox={x0:Math.min(...syms.map(s=>s.bbox.x0)),y0:Math.min(...syms.map(s=>s.bbox.y0)),x1:Math.max(...syms.map(s=>s.bbox.x1)),y1:Math.max(...syms.map(s=>s.bbox.y1))};
    return makeSynthetic(raw.slice(0,-2),raw.slice(-2),bbox,Number(word.confidence??80)+8,{_heightRatio:hr,_source:'merged-symbols'});
  }

  // Przypadek: OCR zwraca dwa osobne słowa "49" i "95". To jest najczęstszy
  // układ na etykietach sklepowych. Łączymy je na podstawie rozmiaru i położenia.
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
        if(hr<0.20||hr>0.92)continue;
        if(ccx<=mcx)continue;
        const gap=cents.bbox.x0-main.bbox.x1;
        // Małe cyfry na prawdziwych etykietach bywają odsunięte bardziej niż zakładaliśmy.
        if(gap < -0.30*mw || gap > Math.max(mh*2.4,mw*1.35))continue;
        if(Math.abs(ccy-mcy)>mh*0.95)continue;
        // Końcówka nie musi być idealnie podniesiona; wystarczy, że jest mniejsza.
        if(hr>0.82&&wr>0.95)continue;

        const bbox={x0:Math.min(main.bbox.x0,cents.bbox.x0),y0:Math.min(main.bbox.y0,cents.bbox.y0),x1:Math.max(main.bbox.x1,cents.bbox.x1),y1:Math.max(main.bbox.y1,cents.bbox.y1)};
        const conf=Math.min(Number(main.confidence??80),Number(cents.confidence??80))+10;
        const s=makeSynthetic(mt,ct,bbox,conf,{_heightRatio:hr,_source:'separate-words'});
        if(s)out.push(s);
      }
    }
    return out;
  }

  function enhance(data){
    if(!data)return data;
    const words=allWords(data),synthetic=[];

    for(const x of words){
      if(/\d[.,]\d{2}/.test(String(x.text||'')))continue;
      const c=mergedSplitCandidate(x);if(c)synthetic.push(c);
    }
    synthetic.push(...separateSplitCandidates(words));

    if(synthetic.length){
      data.words=Array.isArray(data.words)?data.words.slice():[];
      const keys=new Set(data.words.map(x=>`${x.text}|${x.bbox?.x0}|${x.bbox?.y0}|${x.bbox?.x1}|${x.bbox?.y1}`));
      for(const s of synthetic){
        const k=`${s.text}|${s.bbox.x0}|${s.bbox.y0}|${s.bbox.x1}|${s.bbox.y1}`;
        if(!keys.has(k)){data.words.push(s);keys.add(k)}
      }
      data.smartSplits=synthetic.map(s=>({text:s.text,heightRatio:s._heightRatio,source:s._source}));
    }
    return data;
  }

  Tesseract.createWorker=async(...args)=>{
    const worker=await originalCreate(...args);
    const originalRecognize=worker.recognize.bind(worker);
    worker.recognize=async(...rargs)=>{
      const result=await originalRecognize(...rargs);
      if(result?.data)enhance(result.data);
      return result;
    };
    return worker;
  };
})();
