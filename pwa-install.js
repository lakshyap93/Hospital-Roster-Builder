/**
 * PWA Installation & Service Worker Manager
 * Supports Android Chrome, Edge, Desktop Chrome, and iOS Safari
 */
(() => {
  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://');

  const isIOS = () =>
    /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()) &&
    !window.MSStream;

  function getAllInstallButtons() {
    return document.querySelectorAll('#installAppBtn, .install-app-btn, [data-action="install-pwa"]');
  }

  function showInstallButtons() {
    if (isStandalone()) return;
    getAllInstallButtons().forEach(btn => {
      btn.hidden = false;
      btn.style.display = '';
    });
  }

  function hideInstallButtons() {
    getAllInstallButtons().forEach(btn => {
      btn.hidden = true;
    });
  }

  // Handle standard beforeinstallprompt (Chrome, Chromium Edge, Android)
  window.addEventListener('beforeinstallprompt', (event) => {
    if (isStandalone()) return;
    event.preventDefault();
    deferredPrompt = event;
    showInstallButtons();
  });

  // App successfully installed
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallButtons();
    console.log('[PWA] Application installed successfully');
  });

  // Show iOS install instructions
  function showIOSInstallPrompt() {
    const existing = document.getElementById('pwa-ios-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'pwa-ios-modal';
    modal.innerHTML = `
      <div style="
        position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100000;
        display: flex; align-items: flex-end; justify-content: center; padding: 16px;
        backdrop-filter: blur(4px); animation: pwaFadeIn 0.2s ease-out;
      ">
        <div style="
          background: #02120e; border: 1px solid rgba(255,255,255,0.18);
          border-radius: 16px; padding: 22px 20px; max-width: 400px; width: 100%;
          color: #ffffff; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: 'Inter', system-ui, sans-serif;
          position: relative;
        ">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="/icon-192.png" alt="App Icon" style="width: 36px; height: 36px; border-radius: 8px;">
              <strong style="font-size: 15px; font-weight: 700;">Install Hospital Roster</strong>
            </div>
            <button id="closeIosPwaBtn" type="button" style="
              background: transparent; border: none; color: #a7f3d0; font-size: 22px; cursor: pointer; padding: 0 4px;
            ">&times;</button>
          </div>
          <p style="font-size: 13.5px; line-height: 1.5; color: #d1fae5; margin: 0 0 14px;">
            To install this app on your iPhone or iPad:
          </p>
          <ol style="font-size: 13px; line-height: 1.6; margin: 0 0 16px; padding-left: 20px; color: #f0fdf4;">
            <li>Tap the <strong>Share</strong> button in Safari (icon at bottom with an arrow pointing up <span style="font-size:16px;">⎋</span>).</li>
            <li>Scroll down and tap <strong>'Add to Home Screen'</strong>.</li>
            <li>Tap <strong>'Add'</strong> in the top-right corner.</li>
          </ol>
          <button id="dismissIosPwaBtn" type="button" style="
            width: 100%; background: #047857; color: #ffffff; border: none; padding: 10px;
            border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer;
          ">Got It</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#closeIosPwaBtn').onclick = close;
    modal.querySelector('#dismissIosPwaBtn').onclick = close;
    modal.firstElementChild.onclick = (e) => { if (e.target === modal.firstElementChild) close(); };
  }

  // Main install trigger
  window.installPWA = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        hideInstallButtons();
      }
      deferredPrompt = null;
    } else if (isIOS() && !isStandalone()) {
      showIOSInstallPrompt();
    } else if (!isStandalone()) {
      alert("To install, use your browser's menu (⋮) and select 'Install app' or 'Add to Home screen'.");
    }
  };

  // Delegated Click Listener
  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#installAppBtn, .install-app-btn, [data-action="install-pwa"]');
    if (!btn) return;
    event.preventDefault();
    await window.installPWA();
  });

  // Check state on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    if (isStandalone()) {
      hideInstallButtons();
    } else if (deferredPrompt) {
      showInstallButtons();
    } else if (isIOS()) {
      showInstallButtons();
    }
  });

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          // Check for background updates
          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New version available. Reloading cache...');
                }
              };
            }
          };
        })
        .catch(err => console.warn('[PWA] ServiceWorker registration failed:', err));
    });
  }
})();
