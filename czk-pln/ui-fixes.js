(()=>{
  'use strict';

  const style=document.createElement('style');
  style.textContent=`
    .shade{display:none!important}
    .box{box-shadow:0 0 0 9999px rgba(0,0,0,.22),0 0 0 1px #0008!important}
    video{filter:none!important;opacity:1!important}
    #manualDlg{overflow:hidden;width:min(92vw,390px)}
    .manualPadWrap{padding:14px}
    .manualDisplay{width:100%;height:62px;border:1px solid #3d424c;border-radius:14px;background:#08090c;color:#fff;padding:8px 13px;font-size:36px;font-weight:850;text-align:right;font-variant-numeric:tabular-nums;caret-color:transparent}
    .manualResult{min-height:76px;margin:7px 2px 5px;text-align:right;display:flex;flex-direction:column;justify-content:center;line-height:1.05}
    .manualResultHint{font-size:13px;font-weight:700;color:#aeb6c2;min-height:17px}
    .manualResultCzk{font-size:16px;font-weight:750;color:#b9bec7;margin-bottom:2px}
    .manualResultPln{font-size:48px;font-weight:900;letter-spacing:-.04em;color:#fff;white-space:nowrap}
    .manualIdle{height:20px;margin:0 2px 8px;position:relative}
    .manualIdleText{font-size:11px;color:#aeb6c2;text-align:right;line-height:14px;min-height:14px;transition:opacity .18s,transform .18s}
    .manualIdleTrack{height:3px;background:#ffffff18;border-radius:999px;overflow:hidden;margin-top:3px}
    .manualIdleBar{height:100%;width:0;background:#fff;transform-origin:left center;transition:width .08s linear,opacity .18s}
    .manualIdle.ready .manualIdleText{font-weight:800;transform:scale(1.015);transform-origin:right center}
    .manualIdle.ready .manualIdleBar{opacity:.25}
    .manualKeys{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
    .manualKeys button{width:100%;height:54px;min-height:54px;padding:0;font-size:24px;border-radius:12px}
    .manualKeys .back{font-size:21px}
    .manualClear{width:100%;height:46px;min-height:46px;margin-top:7px;border-radius:12px;font-size:15px}
    .manualClose{width:100%;margin-top:7px;height:44px;min-height:44px;border-radius:12px;font-size:14px}
    @media (max-height:700px){
      .manualPadWrap{padding:10px}.manualDisplay{height:54px;font-size:31px}.manualResult{min-height:64px;margin:4px 2px 3px}.manualResultPln{font-size:42px}.manualIdle{margin-bottom:6px}.manualKeys button{height:47px;min-height:47px}.manualClear{height:42px;min-height:42px}.manualClose{height:40px;min-height:40px}
    }
  `;
  document.head.appendChild(style);

  if(window.Tesseract&&typeof Tesseract.createWorker==='function'){
    const previousCreate=Tesseract.createWorker.bind(Tesseract);
    Tesseract.createWorker=async(...args)=>{
      const worker=await previousCreate(...args);
      const previousSet=worker.setParameters.bind(worker);
      worker.setParameters=async params=>{
        const p={...(params||{})};
        if(!document.body.classList.contains('ocrTest')){
          if(String(p.tessedit_pageseg_mode||'')==='7')p.tessedit_pageseg_mode='11';
          if('tessedit_char_whitelist' in p)p.tessedit_char_whitelist='0123456789,.-';
        }
        return previousSet(p);
      };
      return worker;
    };
  }

  const api=window.PriceScannerTestAPI;
  if(api?.cfg&&!localStorage.getItem('scan_contrast')&&Number(api.cfg.contrast)>=17){
    api.cfg.contrast=14;
    const slider=document.getElementById('contrast'),label=document.getElementById('contrastVal');
    if(slider)slider.value='14';
    if(label)label.textContent='1.4×';
  }

  const dlg=document.getElementById('manualDlg');
  const openBtn=document.getElementById('manual');
  if(!dlg||!openBtn)return;

  dlg.innerHTML=`
    <div class="manualPadWrap">
      <h2 style="margin:0 0 10px">Cena w CZK</h2>
      <input id="manualValuePad" class="manualDisplay" type="text" inputmode="none" readonly aria-label="Cena w CZK" value="">
      <div id="manualPadResult" class="manualResult"><span class="manualResultHint">Wpisz cenę</span></div>
      <div id="manualIdle" class="manualIdle">
        <div id="manualIdleText" class="manualIdleText"></div>
        <div class="manualIdleTrack"><div id="manualIdleBar" class="manualIdleBar"></div></div>
      </div>
      <div class="manualKeys" id="manualKeys">
        <button type="button" data-key="1">1</button><button type="button" data-key="2">2</button><button type="button" data-key="3">3</button>
        <button type="button" data-key="4">4</button><button type="button" data-key="5">5</button><button type="button" data-key="6">6</button>
        <button type="button" data-key="7">7</button><button type="button" data-key="8">8</button><button type="button" data-key="9">9</button>
        <button type="button" data-key=",">,</button><button type="button" data-key="0">0</button><button type="button" data-key="back" class="back">⌫</button>
      </div>
      <button id="manualClear" class="manualClear" type="button">Wyczyść</button>
      <button id="manualPadClose" class="manualClose" type="button">Zamknij</button>
    </div>`;

  const display=document.getElementById('manualValuePad');
  const result=document.getElementById('manualPadResult');
  const keys=document.getElementById('manualKeys');
  const clearBtn=document.getElementById('manualClear');
  const close=document.getElementById('manualPadClose');
  const idle=document.getElementById('manualIdle');
  const idleText=document.getElementById('manualIdleText');
  const idleBar=document.getElementById('manualIdleBar');
  const TIMEOUT=3000;
  let buffer='',replaceOnNext=false,lastInputAt=0,idleTimer=0;

  const fmt=n=>new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const render=()=>{display.value=buffer};
  const hint=text=>{result.innerHTML=`<span class="manualResultHint">${text}</span>`};

  function stopIdle(){
    clearInterval(idleTimer);idleTimer=0;idle.classList.remove('ready');idleText.textContent='';idleBar.style.width='0%';
  }

  function armIdle(){
    clearInterval(idleTimer);replaceOnNext=false;lastInputAt=performance.now();idle.classList.remove('ready');
    const tick=()=>{
      const elapsed=performance.now()-lastInputAt;
      const left=Math.max(0,TIMEOUT-elapsed);
      const pct=Math.max(0,Math.min(100,left/TIMEOUT*100));
      idleBar.style.width=pct+'%';
      if(left<=0){
        replaceOnNext=true;idle.classList.add('ready');idleText.textContent='Następna cyfra zacznie nową cenę';idleBar.style.width='0%';clearInterval(idleTimer);idleTimer=0;
      }else if(left<=1000){
        idleText.textContent='Nowa cena za '+Math.ceil(left/1000)+' s';
      }else{
        idleText.textContent='';
      }
    };
    tick();idleTimer=setInterval(tick,80);
  }

  function calculateLive(){
    const n=Number(buffer.replace(',','.'));
    if(!(n>0)){
      hint(buffer?'Wpisz prawidłową cenę':'Wpisz cenę');
      document.getElementById('czk').textContent='— Kč';
      document.getElementById('pln').textContent='— zł';
      return;
    }
    const rate100=Number(localStorage.getItem('czkRate100'))||0;
    document.getElementById('czk').textContent=`${fmt(n)} Kč`;
    if(rate100>0){
      const pln=n*rate100/100;
      document.getElementById('pln').textContent=`${fmt(pln)} zł`;
      result.innerHTML=`<span class="manualResultCzk">${fmt(n)} Kč</span><span class="manualResultPln">${fmt(pln)} zł</span>`;
    }else{
      document.getElementById('pln').textContent='— zł';
      result.innerHTML=`<span class="manualResultCzk">${fmt(n)} Kč</span><span class="manualResultHint">Brak kursu</span>`;
    }
  }

  function startNewIfArmed(k){
    if(!replaceOnNext)return;
    if(k==='back')return;
    buffer='';replaceOnNext=false;render();
  }

  function append(k){
    startNewIfArmed(k);
    if(k===','){
      if(buffer.includes(','))return;
      buffer=buffer||'0';buffer+=',';
    }else{
      const decimals=buffer.includes(',')?buffer.split(',')[1].length:0;
      if(decimals>=2)return;
      const whole=buffer.split(',')[0].replace(/^0+(?=\d)/,'');
      if(!buffer.includes(',')&&whole.length>=5)return;
      buffer+=k;
    }
    render();calculateLive();armIdle();
  }

  function backspace(){
    replaceOnNext=false;buffer=buffer.slice(0,-1);render();calculateLive();
    if(buffer)armIdle();else stopIdle();
  }

  function clearAll(){
    buffer='';replaceOnNext=false;render();stopIdle();hint('Wpisz cenę');
  }

  keys.addEventListener('click',e=>{
    const b=e.target.closest('button[data-key]');if(!b)return;
    const k=b.dataset.key;
    if(k==='back')backspace();else append(k);
  });
  clearBtn.onclick=clearAll;

  openBtn.onclick=()=>{
    clearAll();
    if(!dlg.open)dlg.showModal();
  };
  close.onclick=()=>{stopIdle();dlg.close()};
  display.addEventListener('focus',()=>display.blur());
})();
