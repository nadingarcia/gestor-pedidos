// src/hooks/useNexBotStatus.jsx
// Poll leve (30s) — só leitura de status, sem QR, sem connect/disconnect.
// Projetado para o funcionário saber se as notificações estão ativas.

import { useState, useEffect } from 'react'
import { apiFetch } from '@utils/apiFetch' // <-- Importe o seu novo apiFetch

const BOT_URL      = "https://nexbot.nexfood.app"
const POLL_INTERVAL = 30_000  // 30s — suficiente para feedback visual

/**
 * @returns {'online' | 'offline' | 'checking'}
 */
export function useNexBotStatus() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    // Verificação rápida só para evitar requisição inútil se não houver NENHUM token
    const hasToken = localStorage.getItem('nexfood_token') 
                  || sessionStorage.getItem('nexfood_token')
                  || localStorage.getItem('nexfood_refresh_token')
                  || sessionStorage.getItem('nexfood_refresh_token');

    if (!hasToken) { setStatus('offline'); return }

    let cancelled = false

    const check = async () => {
      try {
        // Usando o novo apiFetch, ele injeta o Bearer token e faz o refresh se necessário
        const r = await apiFetch(`${BOT_URL}/restaurant/status`, {
          headers: {
            'ngrok-skip-browser-warning': 'true',
          },
          signal: AbortSignal.timeout(5000),  // não trava a UI
        })
        
        if (cancelled) return
        if (!r.ok) { setStatus('offline'); return }

        const d = await r.json()
        setStatus(d.connected || d.status === 'READY' ? 'online' : 'offline')
      } catch {
        if (!cancelled) setStatus('offline')
      }
    }

    check()
    const id = setInterval(check, POLL_INTERVAL)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return status
}
