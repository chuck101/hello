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
    .testViewer{display:none;position:absolute;inset:0;background:#050608;z-index:1}
    .testViewer img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#050608}
    .testInfo{position:absolute;left:8px;right:8px;bottom:8px;z-index:4;background:#000d;border:1px solid #ffffff25;border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.35}
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
    launch.textContent='Testuj OCR na etykietach';
    resetBtn.insertAdjacentElement('afterend',launch);
  }

  const viewer=document.createElement('div');
  viewer.className='testViewer';
  viewer.innerHTML='<img id="testLabelImage" alt="Etykieta testowa"><div id="testLabelInfo" class="testInfo">Ładowanie zestawu testowego…</div>';
  cam.appendChild(viewer);

  const controls=document.createElement('footer');
  controls.className='testControls';
  controls.innerHTML='<button id="testPrev">←</button><button id="testAuto" class="primary">AUTO</button><button id="testNext">→</button><button id="testExit">Koniec</button>';
  normalButtons.insertAdjacentElement('afterend',controls);

  const img=$('testLabelImage'),info=$('testLabelInfo');
  const prev=$('testPrev'),next=$('testNext'),autoBtn=$('testAuto'),exitBtn=$('testExit');

  let labels=[],index=0,active=false,auto=false,autoToken=0,results=[];
  const fmt=n=>new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  async function loadManifest(){
    const r=await fetch('./test-labels/manifest.json?x='+(window.APP_VERSION||Date.now()),{cache:'no-store'}).catch(()=>null);
    if(!r||!r.ok) throw new Error('Nie udało się wczytać etykiet testowych');
    const j=await r.json();
    labels=Array.isArray(j.labels)?j.labels:[];
    if(!labels.length) throw new Error('Brak etykiet testowych');
    results=new Array(labels.length).fill(null);
  }

  function loadImage(src){
    return new Promise((resolve,reject)=>{
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Błąd obrazu'));
      img.src=src+'?v='+(window.APP_VERSION||'1');
    });
  }

  function preprocessImage(image){
    const {canvas,ctx,cfg}=api;
    const ratio=image.naturalHeight/image.naturalWidth;
    const w=Math.min(900,Math.max(420,image.naturalWidth||800));
    const h=Math.max(120,Math.round(w*ratio));
    canvas.width=w;canvas.height=h;
    ctx.drawImage(image,0,0,w,h);
    const im=ctx.getImageData(0,0,w,h),d=im.data,mul=cfg.contrast/10;
    for(let i=0;i<d.length;i+=4){const y=.299*d[i]+.587*d[i+1]+.114*d[i+2];const c=Math.max(0,Math.min(255,(y-128)*mul+128));d[i]=d[i+1]=d[i+2]=c}
    ctx.putImageData(im,0,0);
  }

  function paintResult(label,result){
    const got=result?.got,ok=result?.ok===true,pending=!result;
    pln.textContent=pending?'TEST OCR':(ok?'✓ '+fmt(got):'✕ '+(got==null?'brak':fmt(got)));
    czk.textContent=`Oczekiwano ${fmt(label.expected)} Kč`;
    rate.textContent=`Etykieta ${index+1}/${labels.length} • ${label.name}`;
    info.innerHTML=pending
      ? `<strong>${index+1}/${labels.length} — ${esc(label.name)}</strong><br>Oczekiwana cena: ${fmt(label.expected)} Kč<br>Analizuję…`
      : `<strong>${ok?'✅ PASS':'❌ FAIL'} — ${esc(label.name)}</strong><br>Oczekiwano: ${fmt(label.expected)} Kč • OCR: ${got==null?'brak':fmt(got)+' Kč'} • tryb: ${esc(result.kind||'—')}<br>Surowy OCR: ${esc(result.raw||'—')}`;
  }

  async function analyze(i){
    if(!active||!labels.length)return null;
    index=(i+labels.length)%labels.length;const label=labels[index];paintResult(label,null);
    try{
      await loadImage(label.file);preprocessImage(img);
      const w=await api.getWorker();
      const r=await w.recognize(api.canvas,{}, {text:true,blocks:true});
      const chosen=api.chooseCandidate(r.data),got=chosen?.n??null,ok=got!==null&&Math.abs(got-Number(label.expected))<.011;
      const result={got,ok,kind:chosen?.kind||null,raw:(r.data.text||'').trim().replace(/\s+/g,' ')};
      results[index]=result;paintResult(label,result);return result;
    }catch(e){const result={got:null,ok:false,kind:null,raw:'Błąd: '+(e.message||e)};results[index]=result;paintResult(label,result);return result}
  }

  function summary(){const done=results.filter(Boolean),pass=done.filter(r=>r.ok).length,fail=done.length-pass;pln.textContent=`${pass}/${labels.length} PASS`;czk.textContent=fail?`${fail} błędnych`:'Wszystkie poprawne';rate.textContent='Test OCR zakończony';info.innerHTML=`<strong>Wynik AUTO: ${pass}/${labels.length}</strong><br>Poprawne: ${pass} • błędne: ${fail}. Użyj ←/→, aby obejrzeć konkretną etykietę i wynik.`}

  async function runAuto(){if(auto){auto=false;autoToken++;autoBtn.textContent='AUTO';return}auto=true;autoBtn.textContent='STOP';results=new Array(labels.length).fill(null);const token=++autoToken;for(let i=0;i<labels.length;i++){if(!active||!auto||token!==autoToken)break;await analyze(i);await new Promise(r=>setTimeout(r,180))}if(active&&token===autoToken){auto=false;autoBtn.textContent='AUTO';summary()}}

  async function enter(){try{api.stop();settingsDlg.close();if(!labels.length)await loadManifest();active=true;auto=false;autoToken++;document.body.classList.add('ocrTest');await analyze(index)}catch(e){alert(e.message||String(e))}}
  function leave(){active=false;auto=false;autoToken++;document.body.classList.remove('ocrTest');location.reload()}

  launch.addEventListener('click',enter);
  prev.addEventListener('click',()=>{auto=false;autoToken++;autoBtn.textContent='AUTO';analyze(index-1)});
  next.addEventListener('click',()=>{auto=false;autoToken++;autoBtn.textContent='AUTO';analyze(index+1)});
  autoBtn.addEventListener('click',runAuto);
  exitBtn.addEventListener('click',leave);
})();
