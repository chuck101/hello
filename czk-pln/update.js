(()=>{
  'use strict';

  const installedVersion = window.APP_VERSION || 'nieznana';
  let reloading = false;
  let checking = false;

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;background:#090a0d;border-top:1px solid #23262d;color:#aeb4bd;font-size:12px';

  const version = document.createElement('span');
  version.textContent = `Wersja: ${installedVersion}`;

  const update = document.createElement('button');
  update.type = 'button';
  update.textContent = 'Aktualizuj';
  update.style.cssText = 'min-height:36px;padding:5px 12px;border-radius:10px;font-size:12px';

  bar.append(version, update);
  const footer = document.querySelector('.buttons');
  if (footer) footer.before(bar); else document.body.append(bar);

  function setState(text, disabled=false) {
    update.textContent = text;
    update.disabled = disabled;
  }

  async function fetchLatestVersion() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`./version.json?_=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data.version !== 'string' || !data.version) throw new Error('Brak wersji');
      return data.version;
    } finally {
      clearTimeout(timer);
    }
  }

  async function activateUpdate(latestVersion, manual) {
    if (!('serviceWorker' in navigator)) {
      if (manual) alert('Ta przeglądarka nie obsługuje service workera.');
      return;
    }

    setState('Pobieram…', true);
    const registration = await navigator.serviceWorker.getRegistration('./') ||
      await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });

    await registration.update();

    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }

    // Nowy service worker ma skipWaiting(), więc controllerchange nastąpi po instalacji.
    // Jeżeli przeglądarka z jakiegoś powodu nie przełączy kontrolera od razu,
    // pozostawiamy użytkownikowi czytelny status zamiast zapętlać przeładowania.
    setState(`Nowa ${latestVersion}`, true);
  }

  async function checkForUpdate(manual=false) {
    if (checking) return;
    checking = true;
    if (manual) setState('Sprawdzam…', true);

    try {
      const latest = await fetchLatestVersion();
      if (latest === installedVersion) {
        setState(manual ? 'Aktualna ✓' : 'Aktualizuj', false);
        if (manual) setTimeout(() => setState('Aktualizuj', false), 1800);
        return;
      }
      await activateUpdate(latest, manual);
    } catch (error) {
      console.warn('Sprawdzanie aktualizacji:', error);
      setState(manual ? 'Brak internetu' : 'Aktualizuj', false);
      if (manual) setTimeout(() => setState('Aktualizuj', false), 2200);
    } finally {
      checking = false;
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  update.addEventListener('click', () => checkForUpdate(true));

  // Automatycznie sprawdź realne połączenie z serwerem po uruchomieniu aplikacji.
  // Brak internetu nie wpływa na pracę offline.
  setTimeout(() => checkForUpdate(false), 1200);
})();
