(async () => {
  const guardClient = window.guardClient || window.supabaseClient || (window.getSupabaseClient ? window.getSupabaseClient() : null);
  if (!guardClient) {
    console.error("Auth Guard: Supabase client not initialized.");
    return;
  }
  const r = await guardClient.auth.getSession();
  if (r.error || !r.data.session) {
    const raw = location.pathname || "/";
    const p = raw.replace(/\.html$/, '') || "/";
    window.navigate("/login?next=" + encodeURIComponent(p));
    return;
  }
  document.documentElement.classList.add("auth-ready");
})();

async function logoutRosterUser() {
  const guardClient = window.guardClient || window.supabaseClient || (window.getSupabaseClient ? window.getSupabaseClient() : null);
  if (guardClient) {
    await guardClient.auth.signOut();
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