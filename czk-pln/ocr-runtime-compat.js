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
})();
