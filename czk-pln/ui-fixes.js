(()=>{
  'use strict';

  // 1) Camera preview: keep the scan area bright. The old UI darkened the video twice
  // (.shade plus the huge shadow around the scan box).
  const style=document.createElement('style');
  style.textContent=`
    .shade{display:none!important}
    .box{box-shadow:0 0 0 9999px rgba(0,0,0,.22),0 0 0 1px #0008!important}
    video{filter:none!important;opacity:1!important}
    #manualDlg{overflow:hidden;width:min(92vw,390px)}
    .manualPadWrap{padding:14px}
    .manualDisplay{width:100%;height:62px;border:1px solid #3d424c;border-radius:14px;background:#08090c;color:#fff;padding:8px 13px;font-size:36px;font-weight:850;text-align:right;font-variant-numeric:tabular-nums;caret-color:transparent}
    .manualResult{min-height:64px;margin:7px 2px 10px;text-align:right;display:flex;flex-direction:column;justify-content:center;line-height:1.05}
    .manualResultHint{font-size:14px;font-weight:700;color:#aeb6c2}
    .manualResultCzk{font-size:16px;font-weight:750;color:#b9bec7;margin-bottom:2px}
    .manualResultPln{font-size:44px;font-weight:900;letter-spacing:-.035em;color:#fff;white-space:nowrap}
    .manualKeys{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
    .manualKeys button{width:100%;height:54px;min-height:54px;padding:0;font-size:24px;border-radius:12px}
    .manualKeys .back{font-size:21px}
    .manualActions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
    .manualActions button{width:100%;height:52px;min-height:52px;padding:0 8px;border-radius:12px;font-size:16px}
    .manualActions .calc{background:#fff;color:#050608;font-size:17px;font-weight:850}
    .manualClose{width:100%;margin-top:7px;height:44px;min-height:44px;border-radius:12px;font-size:14px}
    @media (max-height:700px){
      .manualPadWrap{padding:10px}.manualDisplay{height:54px;font-size:31px}.manualResult{min-height:54px;margin:5px 2px 7px}.manualResultPln{font-size:38px}.manualKeys button{height:48px;min-height:48px}.manualActions button{height:46px;min-height:46px}.manualClose{height:40px;min-height:40px}
    }
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
      <h2 style="margin:0 0 10px">Cena w CZK</h2>
      <input id="manualValuePad" class="manualDisplay" type="text" inputmode="none" readonly aria-label="Cena w CZK" value="">
      <div id="manualPadResult" class="manualResult"><span class="manualResultHint">Wpisz cenę</span></div>
      <div class="manualKeys" id="manualKeys">
        <button type="button" data-key="1">1</button><button type="button" data-key="2">2</button><button type="button" data-key="3">3</button>
        <button type="button" data-key="4">4</button><button type="button" data-key="5">5</button><button type="button" data-key="6">6</button>
        <button type="button" data-key="7">7</button><button type="button" data-key="8">8</button><button type="button" data-key="9">9</button>
        <button type="button" data-key=",">,</button><button type="button" data-key="0">0</button><button type="button" data-key="back" class="back">⌫</button>
      </div>
      <div class="manualActions" id="manualActions">
        <button type="button" data-key="clear">Wyczyść</button>
        <button type="button" data-key="calc" class="calc">Przelicz</button>
      </div>
      <button id="manualPadClose" class="manualClose" type="button">Zamknij</button>
    </div>`;

  const display=document.getElementById('manualValuePad');
  const result=document.getElementById('manualPadResult');
  const keys=document.getElementById('manualKeys');
  const actions=document.getElementById('manualActions');
  const close=document.getElementById('manualPadClose');
  let buffer='',replaceOnNext=false;
  const fmt=n=>new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  const render=()=>{display.value=buffer};
  const hint=text=>{result.innerHTML=`<span class="manualResultHint">${text}</span>`};
  const clearForNext=()=>{if(replaceOnNext){buffer='';replaceOnNext=false;hint('Wpisz kolejną cenę')}};

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
    if(!(n>0)){hint('Wpisz prawidłową cenę');return}
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
    replaceOnNext=true;
  }

  function handleKey(k){
    if(k==='back'){clearForNext();buffer=buffer.slice(0,-1);render();return}
    if(k==='clear'){buffer='';replaceOnNext=false;hint('Wpisz cenę');render();return}
    if(k==='calc'){calculate();return}
    append(k);
  }

  keys.addEventListener('click',e=>{const b=e.target.closest('button[data-key]');if(b)handleKey(b.dataset.key)});
  actions.addEventListener('click',e=>{const b=e.target.closest('button[data-key]');if(b)handleKey(b.dataset.key)});

  openBtn.onclick=()=>{
    buffer='';replaceOnNext=false;render();hint('Wpisz cenę');
    if(!dlg.open)dlg.showModal();
  };
  close.onclick=()=>dlg.close();
  display.addEventListener('focus',()=>display.blur());
})();
