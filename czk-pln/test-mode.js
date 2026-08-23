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
    .testInfo{position:absolute;left:8px;right:8px;bottom:8px;z-index:6;background:#000d;border:1px solid #ffffff25;border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.35;max-height:36%;overflow:auto;pointer-events:auto}
    .testInfo strong{font-size:13px}
    .testControls{display:none;grid-template-columns:1fr 1.25fr 1fr 1.1fr;gap:8px;padding:10px 10px calc(10px + env(safe-area-inset-bottom));background:#090a0d}
    .testControls button{min-height:50px}
    body.ocrTest .testViewer{display:block}
    body.ocrTest .testControls{display:grid}
    body.ocrTest .buttons{display:none}
    body.ocrTest .cam video,body.ocrTest .cam .shade,body.ocrTest .cam .box,body.ocrTest .cam .cross,body.ocrTest .cam .hint{display:none}
    body.ocrTest #status{display:none}
  `;
  document.head.appendChild(style);

  let launch=$('launchOcrTest');
  if(!launch){
    launch=document.createElement('button');
    launch.id='launchOcrTest';
    launch.type='button';
    launch.className='testLaunch';
    resetBtn.insertAdjacentElement('afterend',launch);
  }
  launch.textContent='Testuj OCR na 20 prawdziwych etykietach';

  const viewer=document.createElement('div');
  viewer.className='testViewer';
  viewer.innerHTML=`
    <div id="testStage" class="testStage">
      <img id="testLabelImage" alt="Prawdziwa czeska etykieta">
      <div id="testScan" class="testScan"></div>
      <div id="testCrossH" class="testCrossH"></div>
      <div id="testCrossV" class="testCrossV"></div>
      <div class="testGestureHint">1 palec: przesuń • 2 palce: zoom</div>
      <div id="testZoomBadge" class="testZoomBadge">1.0×</div>
    </div>
    <div id="testLabelInfo" class="testInfo">Ładowanie prawdziwych zdjęć…</div>`;
  cam.appendChild(viewer);

  const controls=document.createElement('footer');
  controls.className='testControls';
  controls.innerHTML='<button id="testPrev">←</button><button id="testAuto" class="primary">AUTO</button><button id="testNext">→</button><button id="testExit">Koniec</button>';
  normalButtons.insertAdjacentElement('afterend',controls);

  const stage=$('testStage'),img=$('testLabelImage'),info=$('testLabelInfo');
  const scan=$('testScan'),crossH=$('testCrossH'),crossV=$('testCrossV'),zoomBadge=$('testZoomBadge');
  const prev=$('testPrev'),next=$('testNext'),autoBtn=$('testAuto'),exitBtn=$('testExit');

  let labels=[],index=0,active=false,auto=false,autoToken=0,results=[];
  let imageLoaded=false,currentImageIndex=-1,recognizeToken=0,gestureTimer=0;
  const view={baseX:0,baseY:0,baseW:1,baseH:1,zoom:1,panX:0,panY:0};
  const pointers=new Map();
  let panGesture=null,pinchGesture=null;

  const fmt=n=>new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const hasExpected=label=>label.expected!==null&&label.expected!==undefined&&Number.isFinite(Number(label.expected));
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

  async function loadManifest(){
    const r=await fetch('./real-labels/manifest.json?x='+(window.APP_VERSION||Date.now()),{cache:'no-store'}).catch(()=>null);
    if(!r||!r.ok) throw new Error('Nie udało się wczytać prawdziwych etykiet');
    const j=await r.json();
    labels=Array.isArray(j.labels)?j.labels:[];
    if(!labels.length) throw new Error('Brak prawdziwych etykiet testowych');
    results=new Array(labels.length).fill(null);
  }

  function scanRect(){
    const W=Math.max(1,stage.clientWidth),H=Math.max(1,stage.clientHeight);
    const sw=W*clamp(Number(api.cfg?.scanWidth||55),20,90)/100;
    const sh=H*clamp(Number(api.cfg?.scanHeight||18),8,60)/100;
    const x=(W-sw)/2,y=H*.44-sh/2;
    return {x,y,w:sw,h:sh,cx:x+sw/2,cy:y+sh/2};
  }

  function layoutScan(){
    const r=scanRect();
    Object.assign(scan.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});
    Object.assign(crossH.style,{left:r.cx+'px',top:r.cy+'px'});
    Object.assign(crossV.style,{left:r.cx+'px',top:r.cy+'px'});
  }

  function applyTransform(){
    const x=view.baseX+view.panX,y=view.baseY+view.panY;
    img.style.width=view.baseW+'px';
    img.style.height=view.baseH+'px';
    img.style.transform=`translate(${x}px,${y}px) scale(${view.zoom})`;
    zoomBadge.textContent=view.zoom.toFixed(2)+'×';
  }

  function resetView(){
    if(!imageLoaded)return;
    const W=Math.max(1,stage.clientWidth),H=Math.max(1,stage.clientHeight);
    const iw=Math.max(1,img.naturalWidth),ih=Math.max(1,img.naturalHeight);
    const s=Math.min(W/iw,H/ih);
    view.baseW=iw*s;view.baseH=ih*s;
    view.baseX=(W-view.baseW)/2;view.baseY=(H-view.baseH)/2;
    view.zoom=1;view.panX=0;view.panY=0;
    applyTransform();layoutScan();
  }

  function loadImage(src){
    return new Promise((resolve,reject)=>{
      imageLoaded=false;
      img.onload=()=>{imageLoaded=true;resetView();resolve(img)};
      img.onerror=()=>reject(new Error('Błąd obrazu'));
      img.src=src+'?v='+(window.APP_VERSION||'1');
    });
  }

  function cropVisibleScan(){
    if(!imageLoaded)throw new Error('Obraz nie jest gotowy');
    const {canvas,ctx,cfg}=api;
    const r=scanRect();
    const dispX=view.baseX+view.panX,dispY=view.baseY+view.panY;
    const sxScale=(view.baseW*view.zoom)/img.naturalWidth;
    const syScale=(view.baseH*view.zoom)/img.naturalHeight;
    if(sxScale<=0||syScale<=0)throw new Error('Nieprawidłowa skala obrazu');

    let sx=(r.x-dispX)/sxScale,sy=(r.y-dispY)/syScale;
    let ex=(r.x+r.w-dispX)/sxScale,ey=(r.y+r.h-dispY)/syScale;
    sx=clamp(sx,0,img.naturalWidth);sy=clamp(sy,0,img.naturalHeight);
    ex=clamp(ex,0,img.naturalWidth);ey=clamp(ey,0,img.naturalHeight);
    const sw=ex-sx,sh=ey-sy;
    if(sw<8||sh<8)throw new Error('Ramka jest poza zdjęciem — przesuń zdjęcie pod celownik');

    const outW=Math.min(1100,Math.max(520,Math.round(sw*3)));
    const outH=Math.max(120,Math.round(outW*(sh/sw)));
    canvas.width=outW;canvas.height=outH;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,outW,outH);
    ctx.drawImage(img,sx,sy,sw,sh,0,0,outW,outH);

    const im=ctx.getImageData(0,0,outW,outH),d=im.data,mul=Number(cfg?.contrast||17)/10;
    for(let i=0;i<d.length;i+=4){
      const y=.299*d[i]+.587*d[i+1]+.114*d[i+2];
      const c=Math.max(0,Math.min(255,(y-128)*mul+128));
      d[i]=d[i+1]=d[i+2]=c;
    }
    ctx.putImageData(im,0,0);
    return {sx,sy,sw,sh};
  }

  function paintResult(label,result){
    const known=hasExpected(label),got=result?.got,pending=!result,ok=result?.ok===true;
    const verdict=pending?'':known?(ok?'✅ PASS':'❌ FAIL'):'🔎 WYNIK OCR';
    pln.textContent=pending?'TEST REAL':(known?(ok?'✓ ':'✕ '):'OCR ')+(got==null?'brak':fmt(got));
    czk.textContent=known?`Oczekiwano ${fmt(Number(label.expected))} Kč`:'Cena referencyjna: brak';
    rate.textContent=`Prawdziwa ${index+1}/${labels.length} • ${label.name||'etykieta'}`;
    const expectedLine=known?`Oczekiwano: ${fmt(Number(label.expected))} Kč`:'Oczekiwana cena: nieustalona';
    const gesture='<br><b>Przesuń jednym palcem lub przybliż dwoma.</b> OCR uruchomi się ponownie po puszczeniu.';
    info.innerHTML=pending
      ? `<strong>${index+1}/${labels.length} — ${esc(label.name||'Prawdziwa etykieta')}</strong><br>${expectedLine}<br>Analizuję obszar pod ramką…${gesture}`
      : `<strong>${verdict} — ${esc(label.name||'Prawdziwa etykieta')}</strong><br>${expectedLine}<br>OCR: ${got==null?'brak':fmt(got)+' Kč'} • tryb: ${esc(result.kind||'—')}<br>Surowy OCR: ${esc(result.raw||'—')}${gesture}`;
  }

  async function recognizeCurrentView(){
    if(!active||!labels.length||!imageLoaded)return null;
    const token=++recognizeToken;
    const label=labels[index];
    paintResult(label,null);
    try{
      cropVisibleScan();
      const worker=await api.getWorker();
      const r=await worker.recognize(api.canvas,{}, {text:true,blocks:true});
      if(token!==recognizeToken||!active)return null;
      const chosen=api.chooseCandidate(r.data),got=chosen?.n??null;
      const known=hasExpected(label);
      const ok=known&&got!==null&&Math.abs(got-Number(label.expected))<.011;
      const result={got,ok,known,kind:chosen?.kind||null,raw:(r.data.text||'').trim().replace(/\s+/g,' ')};
      results[index]=result;paintResult(label,result);return result;
    }catch(e){
      if(token!==recognizeToken||!active)return null;
      const result={got:null,ok:false,known:hasExpected(label),kind:null,raw:'Błąd: '+(e.message||e)};
      results[index]=result;paintResult(label,result);return result;
    }
  }

  async function showLabel(i){
    if(!active||!labels.length)return null;
    index=(i+labels.length)%labels.length;
    currentImageIndex=index;
    const label=labels[index];
    paintResult(label,null);
    await loadImage(label.file);
    return recognizeCurrentView();
  }

  function scheduleGestureOCR(){
    clearTimeout(gestureTimer);
    gestureTimer=setTimeout(()=>{if(active&&!auto)recognizeCurrentView()},280);
  }

  function point(ev){
    const r=stage.getBoundingClientRect();
    return {x:ev.clientX-r.left,y:ev.clientY-r.top};
  }

  function startPinch(){
    if(pointers.size<2)return;
    const pts=[...pointers.values()].slice(0,2);
    const mx=(pts[0].x+pts[1].x)/2,my=(pts[0].y+pts[1].y)/2;
    const dist=Math.max(8,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y));
    const imgX=view.baseX+view.panX,imgY=view.baseY+view.panY;
    pinchGesture={dist,zoom:view.zoom,anchorX:(mx-imgX)/view.zoom,anchorY:(my-imgY)/view.zoom};
    panGesture=null;
  }

  stage.addEventListener('pointerdown',ev=>{
    if(!active)return;
    ev.preventDefault();
    try{stage.setPointerCapture(ev.pointerId)}catch{}
    pointers.set(ev.pointerId,point(ev));
    stage.classList.add('dragging');
    if(pointers.size===1){
      const p=pointers.get(ev.pointerId);
      panGesture={id:ev.pointerId,x:p.x,y:p.y,panX:view.panX,panY:view.panY};
      pinchGesture=null;
    }else if(pointers.size===2)startPinch();
  });

  stage.addEventListener('pointermove',ev=>{
    if(!pointers.has(ev.pointerId)||!active)return;
    ev.preventDefault();
    pointers.set(ev.pointerId,point(ev));
    if(pointers.size>=2){
      if(!pinchGesture)startPinch();
      const pts=[...pointers.values()].slice(0,2);
      const mx=(pts[0].x+pts[1].x)/2,my=(pts[0].y+pts[1].y)/2;
      const dist=Math.max(8,Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y));
      const z=clamp(pinchGesture.zoom*(dist/pinchGesture.dist),.65,8);
      view.zoom=z;
      view.panX=mx-view.baseX-pinchGesture.anchorX*z;
      view.panY=my-view.baseY-pinchGesture.anchorY*z;
      applyTransform();
    }else if(panGesture&&panGesture.id===ev.pointerId){
      const p=pointers.get(ev.pointerId);
      view.panX=panGesture.panX+(p.x-panGesture.x);
      view.panY=panGesture.panY+(p.y-panGesture.y);
      applyTransform();
    }
  });

  function endPointer(ev){
    if(!pointers.has(ev.pointerId))return;
    pointers.delete(ev.pointerId);
    try{stage.releasePointerCapture(ev.pointerId)}catch{}
    if(pointers.size===1){
      const [id,p]=[...pointers.entries()][0];
      panGesture={id,x:p.x,y:p.y,panX:view.panX,panY:view.panY};
      pinchGesture=null;
    }else if(pointers.size===0){
      panGesture=null;pinchGesture=null;stage.classList.remove('dragging');scheduleGestureOCR();
    }
  }
  stage.addEventListener('pointerup',endPointer);
  stage.addEventListener('pointercancel',endPointer);

  stage.addEventListener('wheel',ev=>{
    if(!active)return;
    ev.preventDefault();
    const p=point(ev),old=view.zoom,newZoom=clamp(old*Math.exp(-ev.deltaY*.002),.65,8);
    const imgX=view.baseX+view.panX,imgY=view.baseY+view.panY;
    const ax=(p.x-imgX)/old,ay=(p.y-imgY)/old;
    view.zoom=newZoom;
    view.panX=p.x-view.baseX-ax*newZoom;
    view.panY=p.y-view.baseY-ay*newZoom;
    applyTransform();scheduleGestureOCR();
  },{passive:false});

  stage.addEventListener('dblclick',()=>{resetView();scheduleGestureOCR()});
  window.addEventListener('resize',()=>{if(active){resetView();scheduleGestureOCR()}});

  function summary(){
    const done=results.filter(Boolean),verified=done.filter(r=>r.known),pass=verified.filter(r=>r.ok).length,fail=verified.length-pass;
    const unverified=done.filter(r=>!r.known).length,recognized=done.filter(r=>r.got!==null).length;
    pln.textContent=`${recognized}/${labels.length} OCR`;
    czk.textContent=verified.length?`${pass}/${verified.length} poprawnych z ceną wzorcową`:`${unverified} bez ceny wzorcowej`;
    rate.textContent='Prawdziwe zdjęcia — test zakończony';
    info.innerHTML=`<strong>Wynik AUTO</strong><br>OCR znalazł cenę na ${recognized}/${done.length} zdjęciach.<br>Zweryfikowane: ${pass} PASS • ${fail} FAIL • bez ceny referencyjnej: ${unverified}.`;
  }

  async function runAuto(){
    if(auto){auto=false;autoToken++;autoBtn.textContent='AUTO';return}
    auto=true;autoBtn.textContent='STOP';results=new Array(labels.length).fill(null);
    const token=++autoToken;
    for(let i=0;i<labels.length;i++){
      if(!active||!auto||token!==autoToken)break;
      await showLabel(i);
      await new Promise(r=>setTimeout(r,180));
    }
    if(active&&token===autoToken){auto=false;autoBtn.textContent='AUTO';summary()}
  }

  async function enter(){
    try{
      api.stop();settingsDlg.close();
      if(!labels.length)await loadManifest();
      active=true;auto=false;autoToken++;
      document.body.classList.add('ocrTest');
      layoutScan();
      await showLabel(index);
    }catch(e){alert(e.message||String(e))}
  }
  function leave(){active=false;auto=false;autoToken++;recognizeToken++;document.body.classList.remove('ocrTest');location.reload()}

  launch.addEventListener('click',enter);
  prev.addEventListener('click',()=>{auto=false;autoToken++;autoBtn.textContent='AUTO';showLabel(index-1)});
  next.addEventListener('click',()=>{auto=false;autoToken++;autoBtn.textContent='AUTO';showLabel(index+1)});
  autoBtn.addEventListener('click',runAuto);
  exitBtn.addEventListener('click',leave);
})();
