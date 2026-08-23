(()=>{
  'use strict';
  if(!window.Tesseract||typeof Tesseract.createWorker!=='function')return;

  const previousCreate=Tesseract.createWorker.bind(Tesseract);
  const clean=s=>String(s||'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[–—−]/g,'-');
  const onlyDigits=s=>clean(s).replace(/[^0-9]/g,'');
  const h=b=>Math.max(1,(b?.y1||0)-(b?.y0||0));
  const w=b=>Math.max(1,(b?.x1||0)-(b?.x0||0));

  function words(data){
    const out=[],seen=new Set();
    const add=x=>{if(!x||typeof x.text!=='string'||!x.bbox)return;const k=[x.text,x.bbox.x0,x.bbox.y0,x.bbox.x1,x.bbox.y1].join('|');if(seen.has(k))return;seen.add(k);out.push(x)};
    if(Array.isArray(data?.words))data.words.forEach(add);
    for(const b of (data?.blocks||[]))for(const p of (b.paragraphs||[]))for(const l of (p.lines||[]))for(const x of (l.words||[]))add(x);
    return out;
  }

  function structuredAlready(data){
    try{
      const c=window.PriceScannerTestAPI?.chooseCandidate?.(data);
      return !!(c&&['decimal','split','whole-dash','left-cents'].includes(c.kind));
    }catch{return false}
  }

  function symbolDigitBoxes(word){
    const a=[];
    for(const s of (Array.isArray(word?.symbols)?word.symbols:[])){
      const d=onlyDigits(s.text);
      if(d.length===1&&s.bbox)a.push({digit:d,bbox:s.bbox,confidence:Number(s.confidence??word.confidence??0)});
    }
    return a;
  }

  function centsCandidates(data){
    const out=[];
    for(const x of words(data)){
      const t=clean(x.text).trim(),d=onlyDigits(t),conf=Number(x.confidence??0);
      if(/^\d{2}[.,-]?$/.test(t))out.push({cents:Number(d),bbox:x.bbox,confidence:conf,source:'word-2'});
      if(/^\d{3,6}[.,]?$/.test(t)){
        const syms=symbolDigitBoxes(x);
        if(syms.length===d.length&&syms.length>=3){
          const tail=syms.slice(-2),head=syms.slice(0,-2);
          const tb={x0:Math.min(...tail.map(s=>s.bbox.x0)),y0:Math.min(...tail.map(s=>s.bbox.y0)),x1:Math.max(...tail.map(s=>s.bbox.x1)),y1:Math.max(...tail.map(s=>s.bbox.y1))};
          const th=(h(tail[0].bbox)+h(tail[1].bbox))/2,hh=head.reduce((s,z)=>s+h(z.bbox),0)/head.length;
          const punctuation=/[.,]$/.test(t);
          if(punctuation||th<hh*.92)out.push({cents:Number(d.slice(-2)),bbox:tb,confidence:conf-5,source:'merged-tail'});
        }
      }
    }
    return out.filter(x=>x.cents>=0&&x.cents<=99).sort((a,b)=>(b.confidence-a.confidence)||(b.bbox.x0-a.bbox.x0));
  }

  function makeLeftCrop(image,cents){
    if(!(image instanceof HTMLCanvasElement)||!cents?.bbox)return null;
    const b=cents.bbox,ch=h(b),cw=w(b),W=image.width,H=image.height;
    const ex=Math.max(1,Math.min(W,Math.floor(b.x0-Math.max(1,ch*.04))));
    const sx=Math.max(0,Math.floor(ex-Math.max(ch*7.0,cw*4.4)));
    const sy=Math.max(0,Math.floor(b.y0-ch*2.5));
    const ey=Math.min(H,Math.ceil(b.y1+ch*2.3));
    const sw=ex-sx,sh=ey-sy;if(sw<10||sh<10)return null;
    const c=document.createElement('canvas');
    c.width=Math.min(1400,Math.max(650,Math.round(sw*6)));
    c.height=Math.max(260,Math.round(sh*c.width/sw));
    const x=c.getContext('2d',{willReadFrequently:true});
    x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
    x.drawImage(image,sx,sy,sw,sh,0,0,c.width,c.height);
    return{canvas:c,sx,sy,sw,sh};
  }

  function grayData(canvas){
    const x=canvas.getContext('2d',{willReadFrequently:true}),im=x.getImageData(0,0,canvas.width,canvas.height),g=new Uint8Array(canvas.width*canvas.height);
    for(let i=0,j=0;i<im.data.length;i+=4,j++)g[j]=Math.round(.299*im.data[i]+.587*im.data[i+1]+.114*im.data[i+2]);
    return g;
  }
  function otsu(g){
    const hist=new Uint32Array(256);for(const v of g)hist[v]++;let total=g.length,sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let wb=0,sb=0,best=-1,t=128;
    for(let i=0;i<256;i++){wb+=hist[i];if(!wb)continue;const wf=total-wb;if(!wf)break;sb+=i*hist[i];const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)*(mb-mf);if(v>best){best=v;t=i}}
    return t;
  }
  function variant(src,mode){
    const c=document.createElement('canvas');c.width=src.width;c.height=src.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0);const im=x.getImageData(0,0,c.width,c.height),d=im.data,g=new Uint8Array(c.width*c.height);
    for(let i=0,j=0;i<d.length;i+=4,j++)g[j]=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);
    const th=otsu(g);
    for(let i=0,j=0;i<d.length;i+=4,j++){
      let v=g[j];
      if(mode==='soft')v=Math.max(0,Math.min(255,Math.round((v-128)*1.12+128)));
      else if(mode==='binary')v=v<th?0:255;
      else if(mode==='thin')v=v<Math.min(245,th+24)?0:255;
      d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;
    }
    x.putImageData(im,0,0);return c;
  }

  function topologyDigit(src){
    const g=grayData(src),W=src.width,H=src.height,th=otsu(g),black=new Uint8Array(W*H);
    for(let i=0;i<g.length;i++)black[i]=g[i]<th?1:0;
    const seen=new Uint8Array(W*H),dirs=[[1,0],[-1,0],[0,1],[0,-1]],comps=[];
    for(let y=0;y<H;y+=2)for(let x=0;x<W;x+=2){const i=y*W+x;if(!black[i]||seen[i])continue;const q=[[x,y]];seen[i]=1;let area=0,x0=x,x1=x,y0=y,y1=y;
      while(q.length){const [cx,cy]=q.pop();area++;x0=Math.min(x0,cx);x1=Math.max(x1,cx);y0=Math.min(y0,cy);y1=Math.max(y1,cy);for(const[dX,dY]of dirs){const nx=cx+dX,ny=cy+dY;if(nx<0||ny<0||nx>=W||ny>=H)continue;const ni=ny*W+nx;if(black[ni]&&!seen[ni]){seen[ni]=1;q.push([nx,ny])}}}
      if(area>80)comps.push({area,x0,x1,y0,y1});
    }
    if(!comps.length)return null;comps.sort((a,b)=>b.area-a.area);const b=comps[0],bw=b.x1-b.x0+1,bh=b.y1-b.y0+1;if(bw<12||bh<24)return null;
    const ext=new Uint8Array(bw*bh),qq=[];const push=(x,y)=>{if(x<0||y<0||x>=bw||y>=bh)return;const gi=(b.y0+y)*W+b.x0+x,li=y*bw+x;if(ext[li]||black[gi])return;ext[li]=1;qq.push([x,y])};
    for(let x=0;x<bw;x++){push(x,0);push(x,bh-1)}for(let y=0;y<bh;y++){push(0,y);push(bw-1,y)}
    while(qq.length){const[cx,cy]=qq.pop();for(const[dX,dY]of dirs)push(cx+dX,cy+dY)}
    const holes=[],hs=new Uint8Array(bw*bh);
    for(let y=1;y<bh-1;y++)for(let x=1;x<bw-1;x++){const li=y*bw+x,gi=(b.y0+y)*W+b.x0+x;if(black[gi]||ext[li]||hs[li])continue;const q=[[x,y]];hs[li]=1;let area=0,sy=0;while(q.length){const[cx,cy]=q.pop();area++;sy+=cy;for(const[dX,dY]of dirs){const nx=cx+dX,ny=cy+dY;if(nx<=0||ny<=0||nx>=bw-1||ny>=bh-1)continue;const nli=ny*bw+nx,ngi=(b.y0+ny)*W+b.x0+nx;if(!black[ngi]&&!ext[nli]&&!hs[nli]){hs[nli]=1;q.push([nx,ny])}}}if(area>bw*bh*.002)holes.push({area,y:sy/area/bh})}
    if(holes.length>=2)return 8;if(holes.length===1){const y=holes[0].y;if(y>.55)return 6;if(y<.43)return 9;return 0}return null;
  }

  function parseWhole(data){
    const cand=[],rawText=clean(data?.text||'').trim();
    if(/^\d{1,4}$/.test(rawText))cand.push({n:Number(rawText),confidence:55,raw:rawText});
    for(const x of words(data)){
      const t=clean(x.text).trim(),conf=Number(x.confidence??0);
      if(x._smartSplit||x._runtimeLeftFallback||/[.,-]/.test(t))continue;
      if(/^\d{1,4}$/.test(t))cand.push({n:Number(t),confidence:conf,raw:t});
    }
    return cand.filter(x=>x.n>=0&&x.n<10000).sort((a,b)=>b.confidence-a.confidence)[0]||null;
  }

  async function readWholeLeft(worker,baseRecognize,crop,before){
    const attempts=[],configs=[['soft','8'],['soft','13'],['binary','8'],['thin','8']];
    try{
      for(const[mode,psm]of configs){
        const c=variant(crop.canvas,mode);
        await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:psm,preserve_interword_spaces:'1'});
        const r=await baseRecognize(c,{}, {text:true,blocks:true});
        const hit=parseWhole(r?.data),raw=String(r?.data?.text||'').trim().replace(/\s+/g,' ');
        attempts.push({mode,psm,raw,hit:hit?.n??null,confidence:hit?.confidence??0});
      }
      const groups=new Map();for(const a of attempts){if(a.hit===null)continue;const k=String(a.hit);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(a)}
      if(!groups.size)return{hit:null,attempts};
      let best=[...groups.entries()].map(([k,v])=>({n:Number(k),votes:v.length,conf:v.reduce((s,x)=>s+x.confidence,0)/v.length})).sort((a,b)=>(b.votes-a.votes)||(b.conf-a.conf))[0];
      if(best.n===5){const topo=topologyDigit(crop.canvas);if(topo===6)best={...best,n:6,topology:'5→6 (lower hole)'}}
      if(best.votes<2&&best.conf<82)return{hit:null,attempts,best};
      return{hit:best.n,attempts,best};
    }finally{try{await worker.setParameters(before)}catch{}}
  }

  function addSynthetic(data,whole,cents,centsBox,crop,diag){
    const value=whole+cents/100,bbox={x0:Math.max(0,crop.sx),y0:Math.max(0,Math.min(crop.sy,centsBox.y0)),x1:Math.max(centsBox.x1,crop.sx+crop.sw),y1:Math.max(centsBox.y1,crop.sy+crop.sh)};
    const word={text:`${whole},${String(cents).padStart(2,'0')}`,confidence:88,bbox,_runtimeLeftFallback:true};
    data.words=Array.isArray(data.words)?data.words.slice():[];data.words.push(word);data.runtimeLeftFallback={value,whole,cents,diag};
  }

  Tesseract.createWorker=async(...args)=>{
    const worker=await previousCreate(...args),baseRecognize=worker.recognize.bind(worker),baseSet=worker.setParameters.bind(worker);let current={};
    worker.setParameters=async p=>{current={...current,...(p||{})};return baseSet(p)};
    worker.recognize=async(...rargs)=>{
      const before={...current},result=await baseRecognize(...rargs);if(!result?.data)return result;
      const image=rargs[0];if(!(image instanceof HTMLCanvasElement)||structuredAlready(result.data))return result;
      const cents=centsCandidates(result.data)[0];if(!cents)return result;const crop=makeLeftCrop(image,cents);if(!crop)return result;
      try{const left=await readWholeLeft(worker,baseRecognize,crop,before);if(left.hit!==null&&left.hit>=0&&left.hit<10000)addSynthetic(result.data,left.hit,cents.cents,cents.bbox,crop,{centsSource:cents.source,attempts:left.attempts,best:left.best||null})}
      catch(e){result.data.runtimeLeftFallback={error:String(e?.message||e),cents:cents.cents}}
      return result;
    };
    return worker;
  };

  const api=window.PriceScannerTestAPI;
  if(api&&typeof api.chooseCandidate==='function'){
    const oldChoose=api.chooseCandidate.bind(api);
    api.chooseCandidate=data=>{const c=oldChoose(data);if(c&&data?.runtimeLeftFallback&&Math.abs(Number(c.n)-Number(data.runtimeLeftFallback.value))<.011){c.kind='left-cents';c.runtimeLeftFallback=data.runtimeLeftFallback}return c};
  }
})();
