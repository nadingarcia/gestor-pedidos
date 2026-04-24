const STORAGE_TOKEN         = 'nexfood_token';
const STORAGE_REFRESH_TOKEN = 'nexfood_refresh_token';

let refreshPromise = null;

async function tryRefreshToken() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const refreshToken = localStorage.getItem(STORAGE_REFRESH_TOKEN)
                              || sessionStorage.getItem(STORAGE_REFRESH_TOKEN);
            if (!refreshToken) return null;

            const res = await fetch('https://nexfood.vercel.app/api/refresh-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });

            if (!res.ok) return null;

            const data = await res.json();

            // Mantém a mesma storage onde estava (localStorage ou sessionStorage)
            const store = localStorage.getItem(STORAGE_TOKEN) ? localStorage : sessionStorage;
            store.setItem(STORAGE_TOKEN,         data.token);
            store.setItem(STORAGE_REFRESH_TOKEN, data.refreshToken);

            return data.token;
        } catch {
            return null;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

function redirectToLogin() {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_REFRESH_TOKEN);
    sessionStorage.removeItem(STORAGE_TOKEN);
    sessionStorage.removeItem(STORAGE_REFRESH_TOKEN);
    window.location.href = '/login';
}

export async function apiFetch(url, options = {}) {
    const token = localStorage.getItem(STORAGE_TOKEN)
               || sessionStorage.getItem(STORAGE_TOKEN);

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        const newToken = await tryRefreshToken();

        if (!newToken) {
            redirectToLogin();
            return new Response(JSON.stringify({ message: 'Sessão expirada.' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        response = await fetch(url, {
            ...options,
            headers: { ...headers, Authorization: `Bearer ${newToken}` },
        });

        if (response.status === 401) {
            redirectToLogin();
            return new Response(JSON.stringify({ message: 'Sessão expirada.' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    return response;
}