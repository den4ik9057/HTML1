        async function handleLogin(e) {
            e.preventDefault();
            const login = document.getElementById('login-input').value.trim();
            const password = document.getElementById('login-pass-input').value.trim();
            const errEl = document.getElementById('login-error');
            errEl.style.display = 'none';
            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login, password })
                });
                const data = await res.json();
                if (res.status === 403 && data.isBanned) { showBanModal(data.banReason, data.banUntil); return; }
                if (!res.ok) { errEl.textContent = data.error || "Помилка входу!"; errEl.style.display = 'block'; return; }
                currentUser = data;
                localStorage.setItem('vmereshi_user', JSON.stringify(currentUser));
                document.getElementById('auth-modal').style.display = 'none';
                updateProfileUI();
                loadPosts();
                loadUserData();
                updateNotificationsBadge();
                updateNotifsBadge();
            } catch (err) { errEl.textContent = "Помилка авторизації!"; errEl.style.display = 'block'; }
        }
