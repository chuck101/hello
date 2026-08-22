const CACHE='czk-pln-v3-offline';
const PRECACHE=__PRECACHE__;

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(
    caches.match(event.request).then(cached=>{
      if(cached) return cached;
      return fetch(event.request).then(response=>{
        if(response && (response.ok || response.type==='opaque')){
          caches.open(CACHE).then(cache=>cache.put(event.request,response.clone())).catch(()=>{});
        }
        return response;
      });
    })
  );
});
