/**
 * Supabase Centralized Client Initializer
 * Reads credentials dynamically from window.__ENV__ (configured in config.js / .env)
 * and initializes a unified client instance.
 */

(function () {
  'use strict';

  function isPrivilegedKey(key) {
    if (/^sb_secret_/i.test(key)) return true;
    try {
      const payload = key.split('.')[1];
      if (!payload) return false;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)));
      return claims.role === 'service_role';
    } catch (_) {
      return false;
    }
  }

  function showUnavailableNotice() {
    window.addEventListener('DOMContentLoaded', () => {
      if (window.showAppDialog) {
        window.showAppDialog('The application connection is not ready. Please contact the administrator.', { title: 'Connection unavailable' });
      }
    }, { once: true });
  }

  function initSupabase() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('[Supabase] Supabase JS library failed to load. Please check internet/CDN connection.');
      return null;
    }

    const env = window.__ENV__ || window.SUPABASE_CONFIG || {};
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || env.SUPABASE_PUBLISHABLE_KEY;

    let parsedUrl;
    try { parsedUrl = new URL(supabaseUrl); } catch (_) {}
    const localHttp = parsedUrl && parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname);
    const urlIsSecure = parsedUrl && (parsedUrl.protocol === 'https:' || localHttp);
    if (!supabaseUrl || !supabaseKey || !urlIsSecure || supabaseUrl.includes('your-project-id') || supabaseKey.includes('your_anon_key_here') || isPrivilegedKey(supabaseKey)) {
      const msg = 'Application connection setup is incomplete.';
      console.error(msg);
      showUnavailableNotice();
      return null;
    }

    // Initialize Supabase Client
    const client = window.supabase.createClient(supabaseUrl, supabaseKey);

    // Export shared references for compatibility across modules
    window.supabaseClient = client;
    window.db = client;
    window.authClient = client;
    window.guardClient = client;

    return client;
  }

  const client = initSupabase();

  // Export helper
  window.getSupabaseClient = function () {
    return window.supabaseClient || client;
  };
})();
