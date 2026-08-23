(()=>{
  'use strict';
  const api=window.PriceScannerTestAPI;
  if(!api||typeof api.chooseCandidate!=='function')return;
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
