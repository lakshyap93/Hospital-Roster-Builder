function getAuthClient() {
    return window.authClient || window.supabaseClient || (window.getSupabaseClient ? window.getSupabaseClient() : null);
}

function initCreatePassword() {
    const authClient = getAuthClient();
    const createPasswordForm = document.getElementById("createPasswordForm");
    const newPassword = document.getElementById("newPassword");
    const confirmPassword = document.getElementById("confirmPassword");
    const submitPasswordButton = document.getElementById("submitPasswordButton");
    const passwordMessage = document.getElementById("passwordMessage");

    if (!authClient) {
        if (passwordMessage) passwordMessage.textContent = "The application connection is not ready. Please contact the administrator.";
        return;
    }

    // Supabase will automatically parse the URL hash or PKCE code and log the user in.
    // We check if a session is established so they can actually set the password.
    authClient.auth.getSession().then(({ data: { session }, error }) => {
        if (error) {
            console.error("Session error:", error);
        }
        if (!session) {
            // Give it a small delay just in case onAuthStateChange is still processing
            setTimeout(() => {
                authClient.auth.getSession().then(({ data: { session } }) => {
                    if (!session) {
                        if (passwordMessage) {
                            passwordMessage.textContent = "Invalid or expired invitation link. Please request a new one.";
                        }
                        if (submitPasswordButton) submitPasswordButton.disabled = true;
                        if (newPassword) newPassword.disabled = true;
                        if (confirmPassword) confirmPassword.disabled = true;
                    }
                });
            }, 1000);
        }
    });

    if (createPasswordForm) {
        createPasswordForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            
            submitPasswordButton.disabled = true;
            submitPasswordButton.textContent = "Saving...";
            passwordMessage.textContent = "";

            const pass1 = newPassword.value;
            const pass2 = confirmPassword.value;

            if (pass1 !== pass2) {
                passwordMessage.textContent = "Passwords do not match.";
                submitPasswordButton.disabled = false;
                submitPasswordButton.innerHTML = "Save Password <b>→</b>";
                return;
            }

            if (pass1.length < 8) {
                passwordMessage.textContent = "Password must be at least 8 characters.";
                submitPasswordButton.disabled = false;
                submitPasswordButton.innerHTML = "Save Password <b>→</b>";
                return;
            }

            let error;
            try {
                ({ error } = await authClient.auth.updateUser({ password: pass1 }));
            } catch (requestError) {
                error = requestError;
            }

            if (error) {
                console.error("Supabase Error:", error);
                passwordMessage.textContent = String(error.message || "Could not save password.").replace(/supabase/gi, "server");
                submitPasswordButton.disabled = false;
                submitPasswordButton.innerHTML = "Save Password <b>→</b>";
                return;
            }

            // End the invitation session; the user must sign in with the new password.
            try { localStorage.removeItem("hrb_session_started_at"); } catch (_) {}
            try { await authClient.auth.signOut({ scope: "local" }); } catch (signOutError) { console.warn("Could not clear the invitation session locally.", signOutError); }
            passwordMessage.textContent = "Password created. Redirecting to sign in...";
            passwordMessage.style.color = "var(--primary-color, #047857)";
            
            setTimeout(() => {
                if (window.navigate) { window.navigate("/login"); } else { window.location.replace("/login"); }
            }, 900);
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCreatePassword);
} else {
    initCreatePassword();
}
