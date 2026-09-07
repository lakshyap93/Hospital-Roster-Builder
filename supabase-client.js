/**
 * Supabase Centralized Client Initializer
 * Reads credentials dynamically from window.__ENV__ (configured in config.js / .env)
 * and initializes a unified client instance.
 */

(function () {
  'use strict';

  function initSupabase() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('[Supabase] Supabase JS library failed to load. Please check internet/CDN connection.');
      return null;
    }

    const env = window.__ENV__ || window.SUPABASE_CONFIG || {};
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || env.SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your-project-id') || supabaseKey.includes('your_anon_key_here')) {
      const msg = '[Supabase] Missing or incomplete Supabase configuration. Please create config.js from config.example.js with your Supabase URL and Publishable Anon Key.';
      console.error(msg);
      
      // If we are in the browser, show a visible alert/banner if body is ready
      window.addEventListener('DOMContentLoaded', () => {
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:#fff;padding:12px 20px;text-align:center;font-family:sans-serif;font-weight:600;font-size:14px;z-index:999999;box-shadow:0 4px 6px rgba(0,0,0,0.2);';
        banner.textContent = '⚠️ Supabase configuration missing. Please setup config.js with valid credentials.';
        document.body.prepend(banner);
      });
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
