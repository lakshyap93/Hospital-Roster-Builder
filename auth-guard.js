const ROSTER_SESSION_STARTED_KEY = 'hrb_session_started_at';
const ROSTER_SESSION_LIMIT_MS = 6 * 60 * 60 * 1000;
let rosterExpiryTimer = null;
let rosterLogoutInProgress = false;

function getGuardClient() {
  return window.guardClient || window.supabaseClient || (window.getSupabaseClient ? window.getSupabaseClient() : null);
}

function getSafeLoginTarget() {
  const raw = location.pathname || '/';
  return raw.replace(/\.html$/, '') || '/';
}

function navigateToLogin(reason) {
  if (location.pathname === '/login' || location.pathname.endsWith('/login.html')) return;
  const suffix = reason ? '?reason=' + encodeURIComponent(reason) : '?next=' + encodeURIComponent(getSafeLoginTarget());
  window.navigate('/login' + suffix);
}

async function expireRosterSession(reason = 'session-expired') {
  if (rosterLogoutInProgress) return;
  rosterLogoutInProgress = true;
  clearTimeout(rosterExpiryTimer);
  try { localStorage.removeItem(ROSTER_SESSION_STARTED_KEY); } catch (_) {}
  const client = getGuardClient();
  if (client) {
    try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
  }
  navigateToLogin(reason);
}

function armRosterSessionExpiry() {
  clearTimeout(rosterExpiryTimer);
  let startedAt;
  try { startedAt = Number(localStorage.getItem(ROSTER_SESSION_STARTED_KEY)); } catch (_) { startedAt = NaN; }
  const now = Date.now();
  if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now) {
    startedAt = now;
    try { localStorage.setItem(ROSTER_SESSION_STARTED_KEY, String(startedAt)); } catch (_) {}
  }
  const remaining = startedAt + ROSTER_SESSION_LIMIT_MS - now;
  if (remaining <= 0) {
    void expireRosterSession();
    return;
  }
  rosterExpiryTimer = setTimeout(() => void expireRosterSession(), remaining);
}

(async () => {
  const guardClient = getGuardClient();
  if (!guardClient) {
    console.error("Auth Guard: Supabase client not initialized.");
    window.navigate("/login");
    return;
  }
  let r;
  try {
    r = await guardClient.auth.getSession();
  } catch (error) {
    console.error("Auth Guard: Could not check session.", error);
  }
  if (r?.error || !r?.data?.session) {
    navigateToLogin();
    return;
  }
  armRosterSessionExpiry();
  window.addEventListener('storage', (event) => {
    if (event.key !== ROSTER_SESSION_STARTED_KEY) return;
    if (event.newValue == null) {
      void expireRosterSession('session-ended');
      return;
    }
    armRosterSessionExpiry();
  });
  window.addEventListener('focus', armRosterSessionExpiry);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) armRosterSessionExpiry();
  });
  guardClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !rosterLogoutInProgress) {
      clearTimeout(rosterExpiryTimer);
      navigateToLogin('session-ended');
    }
  });
  document.documentElement.classList.add("auth-ready");
})();

async function logoutRosterUser() {
  if (rosterLogoutInProgress) return;
  rosterLogoutInProgress = true;
  clearTimeout(rosterExpiryTimer);
  try { localStorage.removeItem(ROSTER_SESSION_STARTED_KEY); } catch (_) {}
  const guardClient = getGuardClient();
  if (guardClient) {
    try { await guardClient.auth.signOut({ scope: 'local' }); } catch (_) {}
  }
  window.navigate("/login");
}
window.logoutRosterUser = logoutRosterUser;

// Live Date/Time Header Widget
function updateHeaderDateTime() {
  const el = document.getElementById('liveDateTime');
  if (!el) return;
  const now = new Date();
  const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  el.textContent = now.toLocaleDateString('en-US', options).replace(',', '');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    updateHeaderDateTime();
    setInterval(updateHeaderDateTime, 1000);
  });
} else {
  updateHeaderDateTime();
  setInterval(updateHeaderDateTime, 1000);
}

// Sidebar Drawer Controls
function toggleSidebar(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  document.body.classList.toggle('sidebar-open');
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

function openSidebar() {
  document.body.classList.add('sidebar-open');
}

window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.openSidebar = openSidebar;

// Global Escape key and Outside click listener for sidebar drawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  }
});

document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('sidebar-open')) return;
  const drawer = document.getElementById('sidebarDrawer');
  const btn = document.getElementById('menuToggleBtn');
  if (drawer && !drawer.contains(e.target) && (!btn || !btn.contains(e.target))) {
    closeSidebar();
  }
});
