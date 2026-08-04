
(() => {
  let deferredPrompt = null;
  const getBtn = () => document.getElementById('installAppBtn');

  window.addEventListener('beforeinstallprompt', (event) => {
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
