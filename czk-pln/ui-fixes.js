(()=>{
  'use strict';

  // 1) Camera preview: keep the scan area bright. The old UI darkened the video twice
  // (.shade plus the huge shadow around the scan box).
  const style=document.createElement('style');
  style.textContent=`
    .shade{display:none!important}
    .box{box-shadow:0 0 0 9999px rgba(0,0,0,.22),0 0 0 1px #0008!important}
    video{filter:none!important;opacity:1!important}
    #manualDlg{overflow:hidden}
    .manualPadWrap{padding:16px}
    .manualDisplay{width:100%;min-height:72px;border:1px solid #3d424c;border-radius:14px;background:#08090c;color:#fff;padding:10px 14px;font-size:42px;font-weight:850;text-align:right;font-variant-numeric:tabular-nums;caret-color:transparent}
    .manualResult{min-height:25px;margin:8px 2px 12px;text-align:right;font-size:15px;font-weight:750;color:#dfe3e8}
    .manualKeys{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
    .manualKeys button{min-height:64px;font-size:27px;border-radius:14px}
    .manualKeys .wide{grid-column:span 2;font-size:18px}
    .manualKeys .calc{background:#fff;color:#050608;font-size:20px}
    .manualKeys .back{font-size:23px}
    .manualClose{width:100%;margin-top:10px;min-height:48px}
  `;
  document.head.appendChild(style);

  // 2) Live OCR: one pass remains, but sparse-text segmentation is much more suitable
  // for shelf labels than a strict single text line. This wrapper is installed before
  // the camera worker is created.
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

  // The previous default 1.7x contrast is quite aggressive on small printed punctuation.
  // Reduce it only when the user never explicitly saved their own contrast setting.
  const api=window.PriceScannerTestAPI;
  if(api?.cfg&&!localStorage.getItem('scan_contrast')&&Number(api.cfg.contrast)>=17){
    api.cfg.contrast=14;
    const slider=document.getElementById('contrast'),label=document.getElementById('contrastVal');
    if(slider)slider.value='14';
    if(label)label.textContent='1.4×';
  }

  // 3) Manual-entry mode with our own keypad. The input is readonly/inputmode=none,
  // so Android's software keyboard is never opened.
  const dlg=document.getElementById('manualDlg');
  const openBtn=document.getElementById('manual');
  if(!dlg||!openBtn)return;

  dlg.innerHTML=`
    <div class="manualPadWrap">
      <h2 style="margin:0 0 12px">Cena w CZK</h2>
      <input id="manualValuePad" class="manualDisplay" type="text" inputmode="none" readonly aria-label="Cena w CZK" value="">
      <div id="manualPadResult" class="manualResult">Wpisz cenę</div>
      <div class="manualKeys" id="manualKeys">
        <button type="button" data-key="1">1</button><button type="button" data-key="2">2</button><button type="button" data-key="3">3</button>
        <button type="button" data-key="4">4</button><button type="button" data-key="5">5</button><button type="button" data-key="6">6</button>
        <button type="button" data-key="7">7</button><button type="button" data-key="8">8</button><button type="button" data-key="9">9</button>
        <button type="button" data-key=",">,</button><button type="button" data-key="0">0</button><button type="button" data-key="back" class="back">⌫</button>
        <button type="button" data-key="clear">Wyczyść</button><button type="button" data-key="calc" class="wide calc">Przelicz</button>
      </div>
      <button id="manualPadClose" class="manualClose" type="button">Zamknij</button>
    </div>`;

  const display=document.getElementById('manualValuePad');
  const result=document.getElementById('manualPadResult');
  const keys=document.getElementById('manualKeys');
  const close=document.getElementById('manualPadClose');
  let buffer='',replaceOnNext=false;
  const fmt=n=>new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const render=()=>{display.value=buffer};
  const clearForNext=()=>{if(replaceOnNext){buffer='';replaceOnNext=false;result.textContent='Wpisz kolejną cenę'}};

  function append(k){
    clearForNext();
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
    render();
  }

  function calculate(){
    const n=Number(buffer.replace(',','.'));
    if(!(n>0)){result.textContent='Wpisz prawidłową cenę';return}
    const rate100=Number(localStorage.getItem('czkRate100'))||0;
    document.getElementById('czk').textContent=`${fmt(n)} Kč`;
    if(rate100>0){
      const pln=n*rate100/100;
      document.getElementById('pln').textContent=`${fmt(pln)} zł`;
      result.textContent=`${fmt(n)} Kč = ${fmt(pln)} zł`;
    }else{
      document.getElementById('pln').textContent='— zł';
      result.textContent=`${fmt(n)} Kč • brak kursu`;
    }
    replaceOnNext=true; // next digit starts a new price automatically
  }

  keys.addEventListener('click',e=>{
    const b=e.target.closest('button[data-key]');if(!b)return;
    const k=b.dataset.key;
    if(k==='back'){clearForNext();buffer=buffer.slice(0,-1);render();return}
    if(k==='clear'){buffer='';replaceOnNext=false;result.textContent='Wpisz cenę';render();return}
    if(k==='calc'){calculate();return}
    append(k);
  });

  openBtn.onclick=()=>{
    buffer='';replaceOnNext=false;render();result.textContent='Wpisz cenę';
    if(!dlg.open)dlg.showModal();
  };
  close.onclick=()=>dlg.close();
  display.addEventListener('focus',()=>display.blur());
})();
