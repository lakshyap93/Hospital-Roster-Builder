/**
 * env-router.js
 * Detects local vs. production (Vercel) environment.
 * On Vercel: clean routes (/login, /staff …) work via server rewrites.
 * Locally (file:// or localhost): rewrites aren't available, so this
 * script patches every internal <a> href from a clean route to the
 * equivalent .html file, and exposes a navigate() helper used by JS
 * redirects in auth-guard.js, auth.js and create-password.js.
 */

(function () {
  const host = location.hostname;
  const isLocal = (host === 'localhost' || host === '127.0.0.1' || host === '' || location.protocol === 'file:');
  window._isLocalDev = isLocal;

  // Map of clean route → .html file (used for local link patching)
  const ROUTE_MAP = {
    '/':                'index.html',
    '/login':           'login.html',
    '/staff':           'staff.html',
    '/roster':          'roster.html',
    '/history':         'history.html',
    '/about':           'about.html',
    '/create-password': 'create-password.html',
  };

  /**
   * navigate(cleanRoute)
   * Use this everywhere in JS instead of raw location.replace().
   * Automatically resolves to the correct URL for the current env.
   *   navigate('/login')  →  location.replace('login.html')  locally
   *                       →  location.replace('/login')       on Vercel
   *
   * Also supports optional query strings: navigate('/login?next=%2F')
   */
  window.navigate = function (cleanRoute) {
    if (!isLocal) {
      location.replace(cleanRoute);
      return;
    }
    // Split off any query string before looking up the file
    const [path, qs] = cleanRoute.split('?');
    // Safety: if path already ends in .html, use it directly
    if (path.endsWith('.html')) {
      location.replace(path.replace(/^\//, '') + (qs ? '?' + qs : ''));
      return;
    }
    const file = ROUTE_MAP[path] || (path.replace(/^\//, '') + '.html');
    location.replace(file + (qs ? '?' + qs : ''));
  };

  // Patch anchor hrefs once DOM is ready (local only)
  if (isLocal) {
    function patchLinks() {
      document.querySelectorAll('a[href]').forEach(function (a) {
        const href = a.getAttribute('href');
        if (ROUTE_MAP[href]) {
          a.setAttribute('href', ROUTE_MAP[href]);
        }
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', patchLinks);
    } else {
      patchLinks();
    }
  }
})();
