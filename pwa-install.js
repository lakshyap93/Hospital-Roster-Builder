/**
 * PWA Installation & Service Worker Manager
 * Supports Android Chrome, Edge, Desktop Chrome, Samsung Internet, and iOS Safari
 */
(() => {
  let deferredPrompt = window.__pwaDeferredPrompt || null;

  // Capture beforeinstallprompt as early as possible
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the install prompt in the one place where the install control lives.
    if (!document.getElementById('loginForm')) return;
    event.preventDefault();
    deferredPrompt = event;
    window.__pwaDeferredPrompt = event;
    console.log('[PWA] beforeinstallprompt captured successfully');
    showInstallButtons();
  });

  // App successfully installed
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__pwaDeferredPrompt = null;
    hideInstallButtons();
    console.log('[PWA] Application installed successfully');
  });

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://');

  const isIOS = () =>
    /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()) &&
    !window.MSStream;

  const isAndroid = () =>
    /android/.test(window.navigator.userAgent.toLowerCase());

  function getAllInstallButtons() {
    return document.querySelectorAll('#installAppBtn');
  }

  function showInstallButtons() {
    if (!document.getElementById('loginForm')) {
      hideInstallButtons();
      return;
    }
    if (isStandalone()) {
      hideInstallButtons();
      return;
    }
    getAllInstallButtons().forEach(btn => {
      btn.hidden = false;
      btn.removeAttribute('hidden');
      btn.style.removeProperty('display');
    });
  }

  function hideInstallButtons() {
    getAllInstallButtons().forEach(btn => {
      btn.hidden = true;
      btn.setAttribute('hidden', '');
      btn.style.display = 'none';
    });
  }

  // Show customized install instruction modal based on browser/platform
  function showInstallModal(platform) {
    const existing = document.getElementById('pwa-install-modal');
    if (existing) existing.remove();

    let title = 'Install Hospital Roster';
    let instructionsHtml = '';

    if (platform === 'ios') {
      title = 'Install on iPhone / iPad';
      instructionsHtml = `
        <ol style="font-size: 13.5px; line-height: 1.7; margin: 0 0 16px; padding-left: 20px; color: #ecfdf5;">
          <li>Tap the <strong>Share</strong> button in Safari (<span style="font-size:16px;">⎋</span> or box with arrow pointing up).</li>
          <li>Scroll down and tap <strong>'Add to Home Screen'</strong>.</li>
          <li>Tap <strong>'Add'</strong> in the top-right corner.</li>
        </ol>
      `;
    } else if (platform === 'android') {
      title = 'Install on Android';
      instructionsHtml = `
        <ol style="font-size: 13.5px; line-height: 1.7; margin: 0 0 16px; padding-left: 20px; color: #ecfdf5;">
          <li>Tap the <strong>Menu</strong> icon in Chrome (three dots <strong>⋮</strong> in top-right).</li>
          <li>Tap <strong>'Install app'</strong> or <strong>'Add to Home screen'</strong>.</li>
          <li>Tap <strong>'Install'</strong> to complete setup.</li>
        </ol>
      `;
    } else {
      title = 'Install on Desktop';
      instructionsHtml = `
        <ol style="font-size: 13.5px; line-height: 1.7; margin: 0 0 16px; padding-left: 20px; color: #ecfdf5;">
          <li>Look for the <strong>Install</strong> icon (<span style="font-size:15px;">⊕</span> or computer symbol) on the right side of the address bar.</li>
          <li>Or click the browser menu (<strong>⋮</strong> or <strong>…</strong>) and choose <strong>'Install Hospital Roster Builder'</strong>.</li>
          <li>Click <strong>'Install'</strong> to launch as a standalone desktop app.</li>
        </ol>
      `;
    }

    const modal = document.createElement('div');
    modal.id = 'pwa-install-modal';
    modal.innerHTML = `
      <style>
        @keyframes pwaBackdropFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pwaModalSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      </style>
      <div style="
        position: fixed; inset: 0; background: rgba(0, 0, 0, 0.68); z-index: 100000;
        display: flex; align-items: center; justify-content: center; padding: 16px;
        backdrop-filter: blur(6px); animation: pwaBackdropFade 0.2s ease-out;
      ">
        <div style="
          background: #02120e; border: 1px solid rgba(16, 185, 129, 0.35);
          border-radius: 18px; padding: 24px 22px; max-width: 420px; width: 100%;
          color: #ffffff; box-shadow: 0 20px 40px rgba(0,0,0,0.65), 0 0 25px rgba(4, 120, 87, 0.2);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          position: relative; animation: pwaModalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        ">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="/icon-192.png" alt="App Icon" style="width: 40px; height: 40px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">
              <div>
                <strong style="font-size: 16px; font-weight: 700; color: #ffffff; display: block; line-height: 1.2;">${title}</strong>
                <span style="font-size: 12px; color: #6ee7b7;">Fast offline access & standalone mode</span>
              </div>
            </div>
            <button id="closePwaModalBtn" type="button" aria-label="Close" style="
              background: rgba(255,255,255,0.08); border: none; color: #a7f3d0; font-size: 20px;
              cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: flex;
              align-items: center; justify-content: center; transition: background 0.15s;
            ">&times;</button>
          </div>
          <p style="font-size: 13.5px; line-height: 1.5; color: #d1fae5; margin: 0 0 12px;">
            Install Hospital Roster Builder for instant one-tap access directly from your home screen or desktop:
          </p>
          ${instructionsHtml}
          <button id="dismissPwaModalBtn" type="button" style="
            width: 100%; background: #047857; color: #ffffff; border: none; padding: 11px;
            border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer;
            box-shadow: 0 4px 12px rgba(4, 120, 87, 0.4); transition: background 0.15s;
          ">Got It</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#closePwaModalBtn').onclick = close;
    modal.querySelector('#dismissPwaModalBtn').onclick = close;
    modal.firstElementChild.onclick = (e) => { if (e.target === modal.firstElementChild) close(); };
  }

  // Main install trigger
  window.installPWA = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          hideInstallButtons();
        }
      } catch (err) {
        console.warn('[PWA] Prompt call failed:', err);
      }
      deferredPrompt = null;
      window.__pwaDeferredPrompt = null;
    } else if (isIOS()) {
      showInstallModal('ios');
    } else if (isAndroid()) {
      showInstallModal('android');
    } else {
      showInstallModal('desktop');
    }
  };

  // Delegated Click Listener
  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#installAppBtn');
    if (!btn) return;
    event.preventDefault();
    await window.installPWA();
  });

  // Evaluate button visibility
  function init() {
    if (isStandalone()) {
      hideInstallButtons();
    } else {
      showInstallButtons();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('pageshow', init);

  // Register Service Worker reliably
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        reg.onupdatefound = () => {
          const installingWorker = reg.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New version available.');
              }
            };
          }
        };
      })
      .catch(err => console.warn('[PWA] ServiceWorker registration failed:', err));
  }

  if (document.readyState === 'complete') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
})();
