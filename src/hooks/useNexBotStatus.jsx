// src/hooks/useNexBotStatus.jsx
// Poll leve (30s) — só leitura de status, sem QR, sem connect/disconnect.
// Projetado para o funcionário saber se as notificações estão ativas.

import { useState, useEffect } from 'react'

const BOT_URL      = "https://lizanimiranda.com.br"
const POLL_INTERVAL = 30_000  // 30s — suficiente para feedback visual

/**
 * @returns {'online' | 'offline' | 'checking'}
 */
export function useNexBotStatus() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    const token = localStorage.getItem('nexfood_token')
                || localStorage.getItem('authToken')
    if (!token) { setStatus('offline'); return }

    let cancelled = false

    const check = async () => {
      try {
        const r = await fetch(`${BOT_URL}/restaurant/status`, {
          headers: {
            'Authorization':              `Bearer ${token}`,
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