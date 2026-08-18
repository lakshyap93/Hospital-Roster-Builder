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
                if (loginMessage) loginMessage.textContent = "Supabase connection is not ready. Please check configuration.";
                return;
            }

            loginButton.disabled = true;
            loginButton.textContent = "Signing in...";
            loginMessage.textContent = "";

            const email = loginEmail.value.trim();
            const password = loginPassword.value;

            const { data, error } = await authClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            console.log("Supabase Response:", { data, error });

            if (error) {
                console.error("Supabase Error:", error);
                loginMessage.textContent = error.message; 
                loginButton.disabled = false;
                loginButton.innerHTML = "Sign In <b>→</b>";
                return;
            }

            const urlParams = new URLSearchParams(window.location.search);
            const next = urlParams.get("next") || "index.html";
            location.replace(next);
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
} else {
    initAuth();
}