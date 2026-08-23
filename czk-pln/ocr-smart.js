(()=>{
  'use strict';
  if(!window.Tesseract||typeof Tesseract.createWorker!=='function')return;

  const originalCreate=Tesseract.createWorker.bind(Tesseract);
  const digits=s=>String(s||'').replace(/[^0-9]/g,'');
  const h=b=>Math.max(1,(b?.y1||0)-(b?.y0||0));
  const w=b=>Math.max(1,(b?.x1||0)-(b?.x0||0));
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0};

  function allWords(data){
    const out=[],seen=new Set();
    const add=x=>{if(!x||!x.bbox||typeof x.text!=='string')return;const k=[x.text,x.bbox.x0,x.bbox.y0,x.bbox.x1,x.bbox.y1].join('|');if(seen.has(k))return;seen.add(k);out.push(x)};
    if(Array.isArray(data?.words))data.words.forEach(add);
    for(const b of (data?.blocks||[]))for(const p of (b.paragraphs||[]))for(const l of (p.lines||[]))for(const x of (l.words||[]))add(x);
    return out;
  }

  function addWord(data,text,bbox,confidence=85,meta={}){
    if(!bbox)return;
    data.words=Array.isArray(data.words)?data.words.slice():[];
    const exists=data.words.some(x=>x.text===text&&x.bbox&&x.bbox.x0===bbox.x0&&x.bbox.y0===bbox.y0&&x.bbox.x1===bbox.x1&&x.bbox.y1===bbox.y1);
    if(!exists)data.words.push({text,confidence,bbox,...meta});
  }

  function addWholeDash(data){
    for(const x of allWords(data)){
      const t=String(x.text||'').replace(/[–—−]/g,'-').replace(/\s/g,'');
      const m=t.match(/^(\d{1,5})(?:[.,])?-(?:[^0-9]|$)/);
      if(!m)continue;
      const n=Number(m[1]);if(!(n>0&&n<100000))continue;
      addWord(data,`${n},00`,x.bbox,Math.max(70,Number(x.confidence??70)),{_wholeDash:true});
    }
    const raw=String(data?.text||'').replace(/[–—−]/g,'-');
    const m=raw.match(/(?:^|\s)(\d{1,5})\s*(?:[.,])?\s*-(?:\s|$)/);
    if(m&&!allWords(data).some(x=>x._wholeDash)){
      const n=Number(m[1]);
      if(n>0&&n<100000){
        const W=Math.max(10,window.PriceScannerTestAPI?.canvas?.width||100),H=Math.max(10,window.PriceScannerTestAPI?.canvas?.height||40);
        addWord(data,`${n},00`,{x0:W*.3,y0:H*.2,x1:W*.7,y1:H*.8},70,{_wholeDash:true});
      }
    }
  }

  function symbolDigits(word){
    return (Array.isArray(word?.symbols)?word.symbols:[]).map(s=>({text:digits(s.text),bbox:s.bbox,confidence:Number(s.confidence??word.confidence??0)})).filter(s=>s.text.length===1&&s.bbox);
  }

  function addSplitGeometry(data){
    const words=allWords(data),synthetic=[];
    for(const word of words){
      const raw=digits(word.text);if(raw.length<3||raw.length>7)continue;
      const syms=symbolDigits(word);if(syms.length!==raw.length)continue;
      const main=syms.slice(0,-2),cents=syms.slice(-2);if(!main.length)continue;
      const mh=median(main.map(s=>h(s.bbox))),ch=median(cents.map(s=>h(s.bbox))),mw=median(main.map(s=>w(s.bbox))),cw=median(cents.map(s=>w(s.bbox)));if(!mh||!ch)continue;
      const hr=ch/mh,wr=mw?cw/mw:1;if(hr>0.93||(hr>0.88&&wr>0.92))continue;
      const gap=Math.min(...cents.map(s=>s.bbox.x0))-Math.max(...main.map(s=>s.bbox.x1));if(gap < -0.35*mw || gap > mh*2.2)continue;
      const bbox={x0:Math.min(...syms.map(s=>s.bbox.x0)),y0:Math.min(...syms.map(s=>s.bbox.y0)),x1:Math.max(...syms.map(s=>s.bbox.x1)),y1:Math.max(...syms.map(s=>s.bbox.y1))};
      synthetic.push({text:`${Number(raw.slice(0,-2))},${raw.slice(-2)}`,bbox,confidence:Math.max(60,Number(word.confidence??75)),_smartSplit:true});
    }
    for(const main of words){
      const mt=digits(main.text);if(!/^\d{1,5}$/.test(mt)||!main.bbox)continue;
      const mh=h(main.bbox),mw=w(main.bbox),mcx=(main.bbox.x0+main.bbox.x1)/2,mcy=(main.bbox.y0+main.bbox.y1)/2;
      for(const cents of words){
        if(cents===main||!cents.bbox)continue;const ct=digits(cents.text);if(!/^\d{2}$/.test(ct))continue;
        const ch=h(cents.bbox),cw=w(cents.bbox),ccx=(cents.bbox.x0+cents.bbox.x1)/2,ccy=(cents.bbox.y0+cents.bbox.y1)/2,hr=ch/mh,wr=cw/mw;
        if(hr<.2||hr>.92||ccx<=mcx)continue;
        const gap=cents.bbox.x0-main.bbox.x1;if(gap<-.3*mw||gap>Math.max(mh*2.4,mw*1.35))continue;
        if(Math.abs(ccy-mcy)>mh*.95||(hr>.82&&wr>.95))continue;
        synthetic.push({text:`${Number(mt)},${ct}`,bbox:{x0:Math.min(main.bbox.x0,cents.bbox.x0),y0:Math.min(main.bbox.y0,cents.bbox.y0),x1:Math.max(main.bbox.x1,cents.bbox.x1),y1:Math.max(main.bbox.y1,cents.bbox.y1)},confidence:Math.max(65,Math.min(Number(main.confidence??75),Number(cents.confidence??75))),_smartSplit:true});
      }
    }
    for(const x of synthetic)addWord(data,x.text,x.bbox,x.confidence,x);
  }

  const hasDecimal=data=>allWords(data).some(x=>/\d{1,5}[.,]\d{2}/.test(String(x.text||'')));
  function bestWhole(data){
    return allWords(data).filter(x=>/^\d{1,5}$/.test(digits(x.text))&&x.bbox).map(x=>({word:x,n:Number(digits(x.text)),confidence:Number(x.confidence??0),area:w(x.bbox)*h(x.bbox)})).filter(x=>x.n>0&&x.n<100000).sort((a,b)=>(b.confidence*2+b.area/100)-(a.confidence*2+a.area/100))[0]||null;
  }

  function rightCrop(image,box){
    if(!(image instanceof HTMLCanvasElement))return null;const H=image.height,W=image.width,mh=h(box),mw=w(box),sx=Math.max(0,Math.min(W-1,Math.floor(box.x1+Math.max(2,mh*.03)))),sy=Math.max(0,Math.floor(box.y0-mh)),ex=Math.min(W,Math.ceil(box.x1+Math.max(mh*3.5,mw*2))),ey=Math.min(H,Math.ceil(box.y1+mh*.7)),sw=ex-sx,sh=ey-sy;if(sw<8||sh<8)return null;
    const c=document.createElement('canvas');c.width=Math.min(1200,Math.max(420,Math.round(sw*4)));c.height=Math.max(180,Math.round(sh*c.width/sw));const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,sx,sy,sw,sh,0,0,c.width,c.height);return{canvas:c,sx,sy,sw,sh};
  }

  function cents(data,main){
    const cand=[];for(const x of allWords(data)){const d=digits(x.text),conf=Number(x.confidence??0);if(/^\d{2}$/.test(d))cand.push({n:Number(d),conf});else if(/^\d{3,7}$/.test(d)&&d!==String(main))cand.push({n:Number(d.slice(-2)),conf:conf-10})}
    const raw=digits(data?.text||'');if(/^\d{2}$/.test(raw))cand.push({n:Number(raw),conf:55});
    return cand.filter(x=>x.n>=0&&x.n<=99).sort((a,b)=>b.conf-a.conf)[0]||null;
  }

  Tesseract.createWorker=async(...args)=>{
    const worker=await originalCreate(...args),baseRecognize=worker.recognize.bind(worker),baseSet=worker.setParameters.bind(worker);
    worker.recognize=async(...rargs)=>{
      const result=await baseRecognize(...rargs);if(!result?.data)return result;
      addWholeDash(result.data);addSplitGeometry(result.data);

      // Camera mode: exactly one OCR pass. Extra OCR is allowed only on a static test image.
      if(!document.body.classList.contains('ocrTest')||hasDecimal(result.data))return result;

      const image=rargs[0],main=bestWhole(result.data);if(!main||!(image instanceof HTMLCanvasElement))return result;
      const crop=rightCrop(image,main.word.bbox);if(!crop)return result;
      try{
        await baseSet({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'8',preserve_interword_spaces:'1'});
        const rr=await baseRecognize(crop.canvas,{}, {text:true,blocks:true}),c=cents(rr?.data,main.n);
        if(c){
          addWord(result.data,`${main.n},${String(c.n).padStart(2,'0')}`,{x0:main.word.bbox.x0,y0:Math.min(main.word.bbox.y0,crop.sy),x1:Math.min(image.width,crop.sx+crop.sw),y1:Math.max(main.word.bbox.y1,Math.min(image.height,crop.sy+crop.sh))},Math.max(70,main.confidence),{_testRightFallback:true});
          result.data.smartRightPass={main:main.n,cents:c.n,raw:String(rr?.data?.text||'').trim()};
        }
      }catch(e){result.data.smartRightPass={main:main.n,error:String(e?.message||e)}}
      finally{await baseSet({tessedit_char_whitelist:'0123456789,.-',tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'}).catch(()=>{})}
      return result;
    };
    return worker;
  };
})();
