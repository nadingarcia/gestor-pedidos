import { cabecalhosDoGestor } from './gestorIdentidade'
const STORAGE_TOKEN         = 'nexfood_token';
const STORAGE_REFRESH_TOKEN = 'nexfood_refresh_token';

// ── Servidor principal (VPS) com reserva (Vercel) ───────────────────────────
// A API roda nos dois com o mesmo código e o mesmo banco. O gestor usa o VPS; se ele não responder,
// a mesma chamada vai para a Vercel e o gestor fica nela por 1 minuto antes de tentar o VPS de novo
// (evita esperar o VPS caído a cada 10 s de atualização).
export const API_PRINCIPAL = 'https://api.nexfood.app';
const API_RESERVA          = 'https://painel.nexfood.app';
const PAUSA_PRINCIPAL_MS   = 60 * 1000;

// Respostas do Cloudflare/servidor que dizem que a requisição NÃO foi processada: pode repetir
// qualquer método. 504/524 (tempo esgotado) podem ter sido processados: só repete leitura.
const PRINCIPAL_FORA    = new Set([502, 503, 520, 521, 522, 523, 525, 526, 530]);
const PRINCIPAL_LENTO   = new Set([504, 524]);

let principalFalhouEm = 0;
const ouvintesServidor = new Set();

export const usandoServidorReserva = () => Date.now() - principalFalhouEm < PAUSA_PRINCIPAL_MS;

/** Avisa quando o gestor passa a usar a reserva ou volta ao principal. Retorna a função para parar. */
export function aoMudarServidor(fn) {
    ouvintesServidor.add(fn);
    return () => ouvintesServidor.delete(fn);
}

// Compara com o último estado avisado (e não com o de agora): a pausa de 1 min vence sozinha,
// sem evento, e a volta ao VPS só é percebida na próxima chamada que der certo.
let reservaAvisada = false;

function definirFalhaPrincipal(quando) {
    principalFalhouEm = quando;
    const agora = usandoServidorReserva();
    if (agora !== reservaAvisada) {
        reservaAvisada = agora;
        ouvintesServidor.forEach(fn => fn(agora));
    }
}

/** fetch que tenta o VPS e, se ele estiver fora, repete a mesma chamada na Vercel. */
export async function fetchComReserva(url, init = {}) {
    if (typeof url !== 'string' || !url.startsWith(API_PRINCIPAL)) return fetch(url, init);

    const urlReserva = API_RESERVA + url.slice(API_PRINCIPAL.length);
    if (usandoServidorReserva()) return fetch(urlReserva, init);

    const leitura = ['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase());
    try {
        const res = await fetch(url, init);
        const fora = PRINCIPAL_FORA.has(res.status) || (leitura && PRINCIPAL_LENTO.has(res.status));
        if (!fora) {
            if (reservaAvisada) definirFalhaPrincipal(0);
            return res;
        }
        if (!leitura && PRINCIPAL_LENTO.has(res.status)) return res;
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        // Erro de rede (DNS, conexão recusada…): a chamada não chegou ao VPS.
    }

    console.warn('[api] VPS fora do ar, usando a Vercel por 1 minuto:', url.replace(API_PRINCIPAL, ''));
    definirFalhaPrincipal(Date.now());
    return fetch(urlReserva, init);
}


let refreshPromise = null;

async function tryRefreshToken() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const refreshToken = localStorage.getItem(STORAGE_REFRESH_TOKEN)
                              || sessionStorage.getItem(STORAGE_REFRESH_TOKEN);
            if (!refreshToken) return null;

            const res = await fetchComReserva(`${API_PRINCIPAL}/api/refresh-token`, {
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
    window.location.href = '/#/login';
}

export async function apiFetch(url, options = {}) {
    const token = localStorage.getItem(STORAGE_TOKEN)
               || sessionStorage.getItem(STORAGE_TOKEN);

    const headers = {
        'Content-Type': 'application/json',
        ...cabecalhosDoGestor(),
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    let response = await fetchComReserva(url, { ...options, headers });

    if (response.status === 401) {
        const newToken = await tryRefreshToken();

        if (!newToken) {
            redirectToLogin();
            return new Response(JSON.stringify({ message: 'Sessão expirada.' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        response = await fetchComReserva(url, {
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