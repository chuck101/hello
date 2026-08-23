(()=>{
  'use strict';

  const api=window.PriceScannerTestAPI;
  if(!api) return;

  const $=id=>document.getElementById(id);
  const settingsDlg=$('settingsDlg');
  const resetBtn=$('resetScan');
  const pln=$('pln'),czk=$('czk'),rate=$('rate');
  const cam=document.querySelector('.cam');
  const normalButtons=document.querySelector('.buttons');
  if(!settingsDlg||!resetBtn||!cam||!normalButtons) return;

  const style=document.createElement('style');
  style.textContent=`
    .testLaunch{width:100%;margin-top:10px;min-height:46px;background:#fff;color:#050608}
    .testViewer{display:none;position:absolute;inset:0;background:#050608;z-index:1;overflow:hidden;touch-action:none;user-select:none}
    .testStage{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab}
    .testStage.dragging{cursor:grabbing}
    .testViewer img{position:absolute;max-width:none;max-height:none;width:auto;height:auto;object-fit:fill;background:#050608;transform-origin:0 0;pointer-events:none;will-change:transform}
    .testScan{position:absolute;z-index:3;border:2px solid #fff;border-radius:12px;box-shadow:0 0 0 9999px #0005,0 0 18px #0008;pointer-events:none}
    .testCrossH,.testCrossV{position:absolute;z-index:4;background:#fff;opacity:.9;pointer-events:none}
    .testCrossH{width:28px;height:2px;transform:translate(-50%,-50%)}
    .testCrossV{width:2px;height:28px;transform:translate(-50%,-50%)}
    .testGestureHint{position:absolute;z-index:5;top:8px;left:50%;transform:translateX(-50%);background:#000b;border:1px solid #ffffff2a;border-radius:999px;padding:6px 10px;font-size:11px;white-space:nowrap;pointer-events:none}
    .testZoomBadge{position:absolute;z-index:5;top:42px;left:50%;transform:translateX(-50%);background:#000b;border-radius:999px;padding:4px 8px;font-size:11px;pointer-events:none}
    .testInfo{position:absolute;left:8px;right:8px;bottom:8px;z-index:6;background:#000d;border:1px solid #ffffff25;border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.35;max-height:42%;overflow:auto;pointer-events:auto;cursor:pointer;-webkit-user-select:none;user-select:none}
    .testInfo strong{font-size:13px}.copyHint{display:block;margin-top:5px;color:#aeb6c2;font-size:11px;font-weight:700}.copyOk{color:#b8ffc7}
    .testControls{display:none;grid-template-columns:1fr 1.25fr 1fr 1.1fr;gap:8px;padding:10px 10px calc(10px + env(safe-area-inset-bottom));background:#090a0d}
    .testControls button{min-height:50px}
    body.ocrTest .testViewer{display:block}body.ocrTest .testControls{display:grid}body.ocrTest .buttons{display:none}
    body.ocrTest .cam video,body.ocrTest .cam .shade,body.ocrTest .cam .box,body.ocrTest .cam .cross,body.ocrTest .cam .hint{display:none}
    body.ocrTest #status{display:none}
  `;
  document.head.appendChild(style);

  let launch=$('launchOcrTest');
  if(!launch){launch=document.createElement('button');launch.id='launchOcrTest';launch.type='button';launch.className='testLaunch';resetBtn.insertAdjacentElement('afterend',launch)}
  launch.textContent='Testuj OCR na 20 prawdziwych etykietach';

  const viewer=document.createElement('div');
  viewer.className='testViewer';
  viewer.innerHTML=`
    <div id="testStage" class="testStage">
      <img id="testLabelImage" alt="Prawdziwa czeska etykieta">
      <div id="testScan" class="testScan"></div>
      <div id="testCrossH" class="testCrossH"></div><div id="testCrossV" class="testCrossV"></div>
      <div class="testGestureHint">1 palec: przesuń • 2 palce: zoom</div>
      <div id="testZoomBadge" class="testZoomBadge">1.0×</div>
    </div>
    <div id="testLabelInfo" class="testInfo">Ładowanie prawdziwych zdjęć…</div>`;
  cam.appendChild(viewer);

  const controls=document.createElement('footer');controls.className='testControls';
  controls.innerHTML='<button id="testPrev">←</button><button id="testAuto" class="primary">AUTO</button><button id="testNext">→</button><button id="testExit">Koniec</button>';
  normalButtons.insertAdjacentElement('afterend',controls);

  const stage=$('testStage'),img=$('testLabelImage'),info=$('testLabelInfo'),scan=$('testScan'),crossH=$('testCrossH'),crossV=$('testCrossV'),zoomBadge=$('testZoomBadge');
  const prev=$('testPrev'),next=$('testNext'),autoBtn=$('testAuto'),exitBtn=$('testExit');

  let labels=[],index=0,active=false,auto=false,autoToken=0,results=[];
  let imageLoaded=false,recognizeToken=0,gestureTimer=0,copyTimer=0;
  const view={baseX:0,baseY:0,baseW:1,baseH:1,zoom:1,panX:0,panY:0};
  const pointers=new Map();let panGesture=null,pinchGesture=null;

  const fmt=n=>new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const hasExpected=label=>label.expected!==null&&label.expected!==undefined&&Number.isFinite(Number(label.expected));

  async function loadManifest(){
    const r=await fetch('./real-labels/manifest.json?x='+(window.APP_VERSION||Date.now()),{cache:'no-store'}).catch(()=>null);
    if(!r||!r.ok)throw new Error('Nie udało się wczytać prawdziwych etykiet');
    const j=await r.json();labels=Array.isArray(j.labels)?j.labels:[];
    if(!labels.length)throw new Error('Brak prawdziwych etykiet testowych');results=new Array(labels.length).fill(null);
  }

  function scanRect(){const W=Math.max(1,stage.clientWidth),H=Math.max(1,stage.clientHeight),sw=W*clamp(Number(api.cfg?.scanWidth||55),20,90)/100,sh=H*clamp(Number(api.cfg?.scanHeight||18),8,60)/100,x=(W-sw)/2,y=H*.44-sh/2;return{x,y,w:sw,h:sh,cx:x+sw/2,cy:y+sh/2}}
  function layoutScan(){const r=scanRect();Object.assign(scan.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});Object.assign(crossH.style,{left:r.cx+'px',top:r.cy+'px'});Object.assign(crossV.style,{left:r.cx+'px',top:r.cy+'px'})}
  function applyTransform(){img.style.width=view.baseW+'px';img.style.height=view.baseH+'px';img.style.transform=`translate(${view.baseX+view.panX}px,${view.baseY+view.panY}px) scale(${view.zoom})`;zoomBadge.textContent=view.zoom.toFixed(2)+'×'}
  function resetView(){if(!imageLoaded)return;const W=Math.max(1,stage.clientWidth),H=Math.max(1,stage.clientHeight),iw=Math.max(1,img.naturalWidth),ih=Math.max(1,img.naturalHeight),s=Math.min(W/iw,H/ih);view.baseW=iw*s;view.baseH=ih*s;view.baseX=(W-view.baseW)/2;view.baseY=(H-view.baseH)/2;view.zoom=1;view.panX=0;view.panY=0;applyTransform();layoutScan()}
  function loadImage(src){return new Promise((resolve,reject)=>{imageLoaded=false;img.onload=()=>{imageLoaded=true;resetView();resolve(img)};img.onerror=()=>reject(new Error('Błąd obrazu'));img.src=src+'?v='+(window.APP_VERSION||'1')})}

  function captureScanSource(){
    if(!imageLoaded)throw new Error('Obraz nie jest gotowy');
    const r=scanRect(),dispX=view.baseX+view.panX,dispY=view.baseY+view.panY,scaleX=(view.baseW*view.zoom)/img.naturalWidth,scaleY=(view.baseH*view.zoom)/img.naturalHeight;
    let sx=(r.x-dispX)/scaleX,sy=(r.y-dispY)/scaleY,ex=(r.x+r.w-dispX)/scaleX,ey=(r.y+r.h-dispY)/scaleY;
    sx=clamp(sx,0,img.naturalWidth);sy=clamp(sy,0,img.naturalHeight);ex=clamp(ex,0,img.naturalWidth);ey=clamp(ey,0,img.naturalHeight);
    const sw=ex-sx,sh=ey-sy;if(sw<8||sh<8)throw new Error('Ramka jest poza zdjęciem — przesuń zdjęcie pod celownik');
    const outW=Math.min(1200,Math.max(640,Math.round(sw*4))),outH=Math.max(140,Math.round(outW*sh/sw)),c=document.createElement('canvas');c.width=outW;c.height=outH;
    const x=c.getContext('2d',{willReadFrequently:true});x.fillStyle='#fff';x.fillRect(0,0,outW,outH);x.drawImage(img,sx,sy,sw,sh,0,0,outW,outH);return c;
  }

  function otsu(gray){const hist=new Uint32Array(256);for(const v of gray)hist[v]++;const total=gray.length;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sumB=0,wB=0,best=0,thr=128;for(let i=0;i<256;i++){wB+=hist[i];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=i*hist[i];const mB=sumB/wB,mF=(sum-sumB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>best){best=v;thr=i}}return thr}
  function renderVariant(source,mode){
    const {canvas,ctx}=api;canvas.width=source.width;canvas.height=source.height;ctx.drawImage(source,0,0);const im=ctx.getImageData(0,0,canvas.width,canvas.height),d=im.data,gray=new Uint8Array(canvas.width*canvas.height);
    for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);const threshold=mode==='binary'?otsu(gray):0,contrast=mode==='soft'?1.12:mode==='normal'?Math.min(1.45,Math.max(1.05,Number(api.cfg?.contrast||17)/10)):1;
    for(let i=0,j=0;i<d.length;i+=4,j++){let c=gray[j];if(mode==='binary')c=c<threshold?0:255;else c=clamp(Math.round((c-128)*contrast+128),0,255);d[i]=d[i+1]=d[i+2]=c;d[i+3]=255}ctx.putImageData(im,0,0);
  }

  function normalizeRaw(s){return String(s||'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[–—−]/g,'-')}
  function rawPriceCandidates(text){
    const s=normalizeRaw(text),out=[];
    for(const m of s.matchAll(/(?:^|[^0-9])(\d{1,4})\s*[,\.]\s*(\d{2})(?!\d)/g)){const n=Number(m[1])+Number(m[2])/100;if(n>.05&&n<100000)out.push({n,kind:'raw-decimal',quality:7})}
    // Typowy czeski zapis bez halerzy: 8.-, 8,-, 8.–, 8,—. Traktujemy jako 8,00 Kč.
    for(const m of s.matchAll(/(?:^|[^0-9])(\d{1,4})\s*([,.])\s*-(?!\d)/g)){const n=Number(m[1]);if(n>.05&&n<100000)out.push({n,kind:'whole-dash',quality:8})}
    return out;
  }

  async function onePass(worker,source,name,mode,psm){
    renderVariant(source,mode);try{await worker.setParameters({tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:'0123456789,.-'})}catch{}
    const r=await worker.recognize(api.canvas,{}, {text:true,blocks:true}),chosen=api.chooseCandidate(r.data),raw=String(r.data?.text||'').trim().replace(/\s+/g,' ');
    return{name,raw,chosen,rawPrices:rawPriceCandidates(raw)};
  }
  function structuredCandidates(pass){
    const out=[];if(pass.chosen&&['decimal','split'].includes(pass.chosen.kind))out.push({n:Number(pass.chosen.n),quality:8,kind:pass.chosen.kind,confidence:Number(pass.chosen.confidence||0)});
    for(const c of pass.rawPrices)out.push({...c,confidence:0});return out;
  }
  function pickMultiPass(passes){
    const structured=[];for(const p of passes)for(const c of structuredCandidates(p))structured.push({...c,pass:p.name});
    if(structured.length){const groups=new Map();for(const c of structured){const k=Math.round(c.n*100);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c)}const ranked=[...groups.entries()].map(([k,v])=>({n:k/100,v,score:v.length*20+Math.max(...v.map(x=>x.quality*4+x.confidence/25))})).sort((a,b)=>b.score-a.score),best=ranked[0];return{n:best.n,kind:'multi-'+best.v[0].kind,confidence:Math.max(...best.v.map(x=>x.confidence||0)),support:best.v.length,structured:true}}
    const wholes=passes.filter(p=>p.chosen&&p.chosen.kind==='whole'&&Number.isFinite(Number(p.chosen.n))).map(p=>({n:Number(p.chosen.n),confidence:Number(p.chosen.confidence||0),pass:p.name}));if(!wholes.length)return null;
    const groups=new Map();for(const c of wholes){const k=Math.round(c.n*100);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c)}const best=[...groups.entries()].map(([k,v])=>({n:k/100,v,avg:v.reduce((s,x)=>s+x.confidence,0)/v.length})).sort((a,b)=>(b.v.length-a.v.length)||(b.avg-a.avg))[0];
    if(best.n<10){if(best.v.length<3||best.avg<78)return null}else if(best.v.length<2||best.avg<55)return null;return{n:best.n,kind:'multi-whole',confidence:best.avg,support:best.v.length,structured:false};
  }
  function diagnosticPasses(passes){return passes.map(p=>{const c=p.chosen?`${p.chosen.n} (${p.chosen.kind||'?'})`:'brak',special=p.rawPrices.length?' candidates='+p.rawPrices.map(x=>`${x.n}(${x.kind})`).join(','):'';return`${p.name}: ${c}${special}; raw="${p.raw||'—'}"`}).join(' | ')}

  function copyPayload(label,result){
    const lines=[
      `TEST OCR ${index+1}/${labels.length}`,
      `plik: ${label.file||'—'}`,
      `nazwa: ${label.name||'—'}`,
      `expected: ${hasExpected(label)?fmt(Number(label.expected))+' Kč':'brak'}`,
      `wynik: ${result?.got==null?'brak':fmt(result.got)+' Kč'}`,
      `tryb: ${result?.kind||'—'}`,
      `zoom: ${view.zoom.toFixed(2)}x`,
      `diagnostyka: ${result?.diag||'brak wyniku'}`
    ];
    return lines.join('\n');
  }
  async function writeClipboard(text){
    if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return true}catch{}}
    try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();const ok=document.execCommand('copy');ta.remove();return ok}catch{return false}
  }
  async function copyCurrentLog(){
    if(!active||!labels.length)return;const label=labels[index],result=results[index],ok=await writeClipboard(copyPayload(label,result));
    const old=info.querySelector('.copyHint');if(old){old.textContent=ok?'✓ Skopiowano do schowka':'Nie udało się skopiować';old.classList.toggle('copyOk',ok);clearTimeout(copyTimer);copyTimer=setTimeout(()=>{if(old.isConnected){old.textContent='Dotknij tego panelu, aby skopiować pełny log';old.classList.remove('copyOk')}},1600)}
  }

  function paintResult(label,result){
    const known=hasExpected(label),got=result?.got,pending=!result,ok=result?.ok===true,verdict=pending?'':known?(ok?'✅ PASS':'❌ FAIL'):'🔎 WYNIK OCR';
    pln.textContent=pending?'TEST REAL':(known?(ok?'✓ ':'✕ '):'OCR ')+(got==null?'brak':fmt(got));czk.textContent=known?`Oczekiwano ${fmt(Number(label.expected))} Kč`:'Cena referencyjna: brak';rate.textContent=`Prawdziwa ${index+1}/${labels.length} • ${label.name||'etykieta'}`;
    const expectedLine=known?`Oczekiwano: ${fmt(Number(label.expected))} Kč`:'Oczekiwana cena: nieustalona',gesture='<br><b>Przesuń jednym palcem lub przybliż dwoma.</b> OCR uruchomi się ponownie po puszczeniu.',diag=result?.diag?`<br><b>Przebiegi:</b> ${esc(result.diag)}`:'';
    info.innerHTML=pending?`<strong>${index+1}/${labels.length} — ${esc(label.name||'Prawdziwa etykieta')}</strong><br>${expectedLine}<br>Analizuję obszar pod ramką…${gesture}<span class="copyHint">Dotknij tego panelu, aby skopiować pełny log</span>`:`<strong>${verdict} — ${esc(label.name||'Prawdziwa etykieta')}</strong><br>${expectedLine}<br>OCR: ${got==null?'brak':fmt(got)+' Kč'} • tryb: ${esc(result.kind||'—')}${diag}${gesture}<span class="copyHint">Dotknij tego panelu, aby skopiować pełny log</span>`;
  }

  async function recognizeCurrentView(){
    if(!active||!labels.length||!imageLoaded)return null;const token=++recognizeToken,label=labels[index];paintResult(label,null);
    try{
      const source=captureScanSource(),worker=await api.getWorker(),passes=[];
      passes.push(await onePass(worker,source,'linia','soft',7));if(token!==recognizeToken||!active)return null;
      passes.push(await onePass(worker,source,'sparse','normal',11));if(token!==recognizeToken||!active)return null;
      passes.push(await onePass(worker,source,'binary','binary',7));if(token!==recognizeToken||!active)return null;
      try{await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,.-'})}catch{}
      const chosen=pickMultiPass(passes),got=chosen?.n??null,known=hasExpected(label),ok=known&&got!==null&&Math.abs(got-Number(label.expected))<.011,result={got,ok,known,kind:chosen?.kind||null,diag:diagnosticPasses(passes)};
      results[index]=result;paintResult(label,result);return result;
    }catch(e){if(token!==recognizeToken||!active)return null;const result={got:null,ok:false,known:hasExpected(label),kind:null,diag:'Błąd: '+(e.message||e)};results[index]=result;paintResult(label,result);return result}
  }

  async function showLabel(i){if(!active||!labels.length)return null;index=(i+labels.length)%labels.length;const label=labels[index];paintResult(label,null);await loadImage(label.file);return recognizeCurrentView()}
  function scheduleGestureOCR(){clearTimeout(gestureTimer);gestureTimer=setTimeout(()=>{if(active&&!auto)recognizeCurrentView()},320)}
  function point(ev){const r=stage.getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top}}
  function startPinch(){if(pointers.size<2)return;const pts=[...pointers.values()].slice(0,2),mx=(pts[0].x+pts[1].x)/2,my=(pts[0].y+pts[1].y)/2,dist=Math.max(8,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y)),imgX=view.baseX+view.panX,imgY=view.baseY+view.panY;pinchGesture={dist,zoom:view.zoom,anchorX:(mx-imgX)/view.zoom,anchorY:(my-imgY)/view.zoom};panGesture=null}

  stage.addEventListener('pointerdown',ev=>{if(!active)return;ev.preventDefault();try{stage.setPointerCapture(ev.pointerId)}catch{}pointers.set(ev.pointerId,point(ev));stage.classList.add('dragging');if(pointers.size===1){const p=pointers.get(ev.pointerId);panGesture={id:ev.pointerId,x:p.x,y:p.y,panX:view.panX,panY:view.panY};pinchGesture=null}else if(pointers.size===2)startPinch()});
  stage.addEventListener('pointermove',ev=>{if(!pointers.has(ev.pointerId)||!active)return;ev.preventDefault();pointers.set(ev.pointerId,point(ev));if(pointers.size>=2){if(!pinchGesture)startPinch();const pts=[...pointers.values()].slice(0,2),mx=(pts[0].x+pts[1].x)/2,my=(pts[0].y+pts[1].y)/2,dist=Math.max(8,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y)),z=clamp(pinchGesture.zoom*(dist/pinchGesture.dist),.65,8);view.zoom=z;view.panX=mx-view.baseX-pinchGesture.anchorX*z;view.panY=my-view.baseY-pinchGesture.anchorY*z;applyTransform()}else if(panGesture&&panGesture.id===ev.pointerId){const p=pointers.get(ev.pointerId);view.panX=panGesture.panX+(p.x-panGesture.x);view.panY=panGesture.panY+(p.y-panGesture.y);applyTransform()}});
  function endPointer(ev){if(!pointers.has(ev.pointerId))return;pointers.delete(ev.pointerId);try{stage.releasePointerCapture(ev.pointerId)}catch{}if(pointers.size===1){const [id,p]=[...pointers.entries()][0];panGesture={id,x:p.x,y:p.y,panX:view.panX,panY:view.panY};pinchGesture=null}else if(pointers.size===0){panGesture=null;pinchGesture=null;stage.classList.remove('dragging');scheduleGestureOCR()}}
  stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);
  stage.addEventListener('wheel',ev=>{if(!active)return;ev.preventDefault();const p=point(ev),old=view.zoom,newZoom=clamp(old*Math.exp(-ev.deltaY*.002),.65,8),imgX=view.baseX+view.panX,imgY=view.baseY+view.panY,ax=(p.x-imgX)/old,ay=(p.y-imgY)/old;view.zoom=newZoom;view.panX=p.x-view.baseX-ax*newZoom;view.panY=p.y-view.baseY-ay*newZoom;applyTransform();scheduleGestureOCR()},{passive:false});
  stage.addEventListener('dblclick',()=>{resetView();scheduleGestureOCR()});window.addEventListener('resize',()=>{if(active){resetView();scheduleGestureOCR()}});
  info.addEventListener('click',ev=>{ev.stopPropagation();copyCurrentLog()});

  function summary(){const done=results.filter(Boolean),verified=done.filter(r=>r.known),pass=verified.filter(r=>r.ok).length,fail=verified.length-pass,unverified=done.filter(r=>!r.known).length,recognized=done.filter(r=>r.got!==null).length;pln.textContent=`${recognized}/${labels.length} OCR`;czk.textContent=verified.length?`${pass}/${verified.length} poprawnych z ceną wzorcową`:`${unverified} bez ceny wzorcowej`;rate.textContent='Prawdziwe zdjęcia — test zakończony';info.innerHTML=`<strong>Wynik AUTO</strong><br>OCR znalazł cenę na ${recognized}/${done.length} zdjęciach.<br>Zweryfikowane: ${pass} PASS • ${fail} FAIL • bez ceny referencyjnej: ${unverified}.<span class="copyHint">Dotknij tego panelu, aby skopiować log bieżącego zdjęcia</span>`}
  async function runAuto(){if(auto){auto=false;autoToken++;autoBtn.textContent='AUTO';return}auto=true;autoBtn.textContent='STOP';results=new Array(labels.length).fill(null);const token=++autoToken;for(let i=0;i<labels.length;i++){if(!active||!auto||token!==autoToken)break;await showLabel(i);await new Promise(r=>setTimeout(r,180))}if(active&&token===autoToken){auto=false;autoBtn.textContent='AUTO';summary()}}
  async function enter(){try{api.stop();settingsDlg.close();if(!labels.length)await loadManifest();active=true;auto=false;autoToken++;document.body.classList.add('ocrTest');layoutScan();await showLabel(index)}catch(e){alert(e.message||String(e))}}
  function leave(){active=false;auto=false;autoToken++;recognizeToken++;document.body.classList.remove('ocrTest');location.reload()}

  launch.addEventListener('click',enter);prev.addEventListener('click',()=>{auto=false;autoToken++;autoBtn.textContent='AUTO';showLabel(index-1)});next.addEventListener('click',()=>{auto=false;autoToken++;autoBtn.textContent='AUTO';showLabel(index+1)});autoBtn.addEventListener('click',runAuto);exitBtn.addEventListener('click',leave);
})();
