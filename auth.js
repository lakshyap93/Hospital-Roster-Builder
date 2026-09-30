function getAuthClient() {
    return window.authClient || window.supabaseClient || (window.getSupabaseClient ? window.getSupabaseClient() : null);
}

function initAuth() {
    const loginForm = document.getElementById("loginForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const togglePassword = document.getElementById("togglePassword");
    const loginButton = document.getElementById("loginButton");
    const loginMessage = document.getElementById("loginMessage");
    const showDeveloperPhone = document.getElementById("showDeveloperPhone");
    const developerPhoneNumber = document.getElementById("developerPhoneNumber");

    const loginReason = new URLSearchParams(window.location.search).get("reason");
    if (loginMessage && loginReason === "session-expired") {
        loginMessage.textContent = "Your session ended after 6 hours. Please sign in again.";
    } else if (loginMessage && loginReason === "session-ended") {
        loginMessage.textContent = "You have been signed out. Please sign in again.";
    }

    if (showDeveloperPhone && developerPhoneNumber) {
        showDeveloperPhone.addEventListener("click", () => {
            developerPhoneNumber.hidden = false;
            showDeveloperPhone.hidden = true;
            developerPhoneNumber.focus();
        });
    }

    if (togglePassword && loginPassword) {
        togglePassword.addEventListener("click", () => {
            if (loginPassword.type === "password") {
                loginPassword.type = "text";
                togglePassword.textContent = "Hide";
            } else {
                loginPassword.type = "password";
                togglePassword.textContent = "Show";
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            
            const authClient = getAuthClient();
            if (!authClient) {
                if (loginMessage) loginMessage.textContent = "The application connection is not ready. Please contact the administrator.";
                return;
            }

            loginButton.disabled = true;
            loginButton.textContent = "Signing in...";
            loginMessage.textContent = "";

            const email = loginEmail.value.trim();
            const password = loginPassword.value;

            let error;
            try {
                ({ error } = await authClient.auth.signInWithPassword({
                    email: email,
                    password: password
                }));
            } catch (requestError) {
                error = requestError;
            }

            if (error) {
                console.error("Authentication error:", error);
                loginMessage.textContent = String(error.message || "Sign in failed.").replace(/supabase/gi, "server");
                loginButton.disabled = false;
                loginButton.innerHTML = "Sign In <b>→</b>";
                return;
            }

            try { localStorage.setItem("hrb_session_started_at", String(Date.now())); } catch (_) {}

            const urlParams = new URLSearchParams(window.location.search);
            const requestedNext = urlParams.get("next") || "/";
            let next = "/";
            try {
                const target = new URL(requestedNext, window.location.origin);
                const allowedRoutes = ["/", "/staff", "/roster", "/history", "/about"];
                if (target.origin === window.location.origin && allowedRoutes.includes(target.pathname)) {
                    next = target.pathname + target.search + target.hash;
                }
            } catch (_) {
                // Keep the safe dashboard fallback for malformed redirect values.
            }
            if (window.navigate) {
                window.navigate(next);
            } else {
                location.replace(next);
            }
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
} else {
    initAuth();
}

