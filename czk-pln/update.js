(()=>{
  'use strict';

  const installedVersion = window.APP_VERSION || 'nieznana';
  const versionEl = document.getElementById('appVersion');
  const statusEl = document.getElementById('updateStatus');
  const updateBtn = document.getElementById('updateBtn');
  if (!versionEl || !statusEl || !updateBtn) return;

  let reloading = false;
  let checking = false;
  versionEl.textContent = `Wersja: ${installedVersion}`;

  function setState(text, disabled=false, statusText=null) {
    updateBtn.textContent = text;
    updateBtn.disabled = disabled;
    if (statusText !== null) statusEl.textContent = statusText;
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

  async function activateUpdate(latestVersion) {
    if (!('serviceWorker' in navigator)) {
      setState('Aktualizuj', false, 'Brak obsługi service workera');
      return;
    }
    setState('Pobieram…', true, `Dostępna wersja ${latestVersion}`);
    const registration = await navigator.serviceWorker.getRegistration('./') ||
      await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    await registration.update();
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    setState('Instaluję…', true, `Aktualizacja do ${latestVersion}`);
  }

  async function checkForUpdate(manual=false) {
    if (checking) return;
    checking = true;
    if (manual) setState('Sprawdzam…', true, 'Łączenie z serwerem…');
    try {
      const latest = await fetchLatestVersion();
      if (latest === installedVersion) {
        setState('Aktualizuj', false, 'Masz najnowszą wersję');
        return;
      }
      await activateUpdate(latest);
    } catch (error) {
      console.warn('Sprawdzanie aktualizacji:', error);
      setState('Aktualizuj', false, 'Brak internetu lub serwer niedostępny');
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

  updateBtn.addEventListener('click', () => checkForUpdate(true));
  setTimeout(() => checkForUpdate(false), 1200);
})();
