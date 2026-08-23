(()=>{
  'use strict';

  const runtimePatch=document.createElement('script');
  runtimePatch.src=`./ocr-runtime-v2.js?v=${encodeURIComponent(window.APP_VERSION||'dev')}`;
  runtimePatch.async=false;
  runtimePatch.onload=()=>{
    const compat=document.createElement('script');
    compat.src=`./ocr-runtime-compat.js?v=${encodeURIComponent(window.APP_VERSION||'dev')}`;
    compat.async=false;
    document.head.appendChild(compat);
  };
  document.head.appendChild(runtimePatch);

  const uiFixes=document.createElement('script');
  uiFixes.src=`./ui-fixes.js?v=${encodeURIComponent(window.APP_VERSION||'dev')}`;
  uiFixes.async=false;
  document.head.appendChild(uiFixes);

  const installedVersion = window.APP_VERSION || 'nieznana';
  const versionEl = document.getElementById('appVersion');
  const statusEl = document.getElementById('updateStatus');
  const updateBtn = document.getElementById('updateBtn');
  if (!versionEl || !statusEl || !updateBtn) return;

  let checking = false;
  let reloading = false;
  versionEl.textContent = `Wersja: ${installedVersion}`;

  function setState(buttonText, disabled=false, statusText=null) {
    updateBtn.textContent = buttonText;
    updateBtn.disabled = disabled;
    if (statusText !== null) statusEl.textContent = statusText;
  }

  async function fetchLatestVersion() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(`./version.json?check=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data.version !== 'string' || !data.version) throw new Error('Brak numeru wersji');
      return data.version;
    } finally {
      clearTimeout(timer);
    }
  }

  function waitForWorker(worker, timeoutMs=30000) {
    return new Promise((resolve, reject) => {
      if (!worker) return reject(new Error('Brak nowego service workera'));
      if (worker.state === 'activated') return resolve();
      const timer = setTimeout(() => reject(new Error('Przekroczono czas instalacji')), timeoutMs);
      const onState = () => {
        statusEl.textContent = `Instalacja: ${worker.state}`;
        if (worker.state === 'activated') {
          clearTimeout(timer);
          worker.removeEventListener('statechange', onState);
          resolve();
        } else if (worker.state === 'redundant') {
          clearTimeout(timer);
          worker.removeEventListener('statechange', onState);
          reject(new Error('Nowy service worker został odrzucony'));
        }
      };
      worker.addEventListener('statechange', onState);
      onState();
    });
  }

  async function installLatest(latestVersion) {
    if (!('serviceWorker' in navigator)) throw new Error('Brak obsługi service workera');

    setState('Pobieram…', true, `Pobieranie wersji ${latestVersion}…`);

    const registration = await navigator.serviceWorker.register(
      `./sw.js?v=${encodeURIComponent(latestVersion)}`,
      { scope: './', updateViaCache: 'none' }
    );

    await registration.update();
    const worker = registration.installing || registration.waiting || registration.active;

    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    await waitForWorker(worker);

    setState('Gotowe ✓', true, `Zainstalowano ${latestVersion}. Uruchamiam…`);

    setTimeout(() => {
      reloading = true;
      location.replace(`./?app=${encodeURIComponent(latestVersion)}`);
    }, 250);
  }

  async function checkForUpdate(manual=false) {
    if (checking) return;
    checking = true;
    if (manual) setState('Sprawdzam…', true, 'Sprawdzam połączenie i wersję…');

    try {
      const latest = await fetchLatestVersion();
      if (latest === installedVersion) {
        setState('Aktualizuj', false, 'Masz najnowszą wersję');
        return;
      }
      setState('Pobierz', false, `Nowa wersja: ${latest}`);
      if (manual) await installLatest(latest);
    } catch (error) {
      console.warn('Aktualizacja PWA:', error);
      setState('Aktualizuj', false, `Błąd aktualizacji: ${error.message || 'brak połączenia'}`);
    } finally {
      checking = false;
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
    });
  }

  updateBtn.addEventListener('click', async () => {
    if (updateBtn.textContent === 'Pobierz') {
      try {
        const latest = await fetchLatestVersion();
        if (latest !== installedVersion) await installLatest(latest);
        else setState('Aktualizuj', false, 'Masz najnowszą wersję');
      } catch (error) {
        setState('Aktualizuj', false, `Błąd aktualizacji: ${error.message || 'brak połączenia'}`);
      }
    } else {
      await checkForUpdate(true);
    }
  });

  setTimeout(() => checkForUpdate(false), 1200);
})();
