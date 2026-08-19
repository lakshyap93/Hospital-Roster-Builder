
(() => {
  let deferredPrompt = null;
  const getBtn = () => document.getElementById('installAppBtn');

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (event) => {
    if (isStandalone()) return;
    event.preventDefault();
    deferredPrompt = event;
    const btn = getBtn();
    if (btn) btn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = getBtn();
    if (btn) btn.hidden = true;
  });

  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#installAppBtn');
    if (!btn || !deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(console.error);
    });
  }
})();
