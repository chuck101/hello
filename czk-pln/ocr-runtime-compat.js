(()=>{
  'use strict';
  const api=window.PriceScannerTestAPI;
  if(!api||typeof api.chooseCandidate!=='function')return;

  // Live camera UX: one confident hit should be enough to show the price.
  if(api.cfg){
    api.cfg.stability=1;
    try{localStorage.setItem('scan_stability','1')}catch{}
  }

  const previous=api.chooseCandidate.bind(api);
  api.chooseCandidate=data=>{
    const c=previous(data);
    if(c?.kind==='left-cents'){
      c.runtimeKind='left-cents';
      c.kind='decimal';
    }
    return c;
  };

  // Test mode currently asks the same worker for several variants in sequence.
  // Once one variant yields a complete price, avoid repeating expensive OCR twice.
  if(typeof api.getWorker==='function'){
    const originalGet=api.getWorker.bind(api);
    let invalidate=()=>{};
    api.getWorker=async()=>{
      const worker=await originalGet();
      if(worker.__priceFastCache)return worker;
      worker.__priceFastCache=true;
      const originalRecognize=worker.recognize.bind(worker);
      let cached=null,uses=0;
      invalidate=()=>{cached=null;uses=0};
      worker.recognize=async(...args)=>{
        if(document.body.classList.contains('ocrTest')&&cached&&uses>0){uses--;return cached}
        const result=await originalRecognize(...args);
        if(document.body.classList.contains('ocrTest')&&result?.data){
          const c=api.chooseCandidate(result.data);
          if(c&&['decimal','split'].includes(c.kind)&&Number.isFinite(Number(c.n))){cached=result;uses=2}
        }
        return result;
      };
      return worker;
    };
    document.addEventListener('pointerdown',e=>{if(e.target?.closest?.('#testStage,#testPrev,#testNext'))invalidate()},true);
    document.addEventListener('wheel',e=>{if(e.target?.closest?.('#testStage'))invalidate()},{capture:true,passive:true});
  }
})();
