// src/hooks/useNexBotStatus.jsx
// Poll leve (60 s, só com a janela à vista) — só leitura de status, sem QR, sem connect/disconnect.
// Projetado para o funcionário saber se as notificações estão ativas.

import { useState, useEffect } from 'react'
import { apiFetch } from '@utils/apiFetch' // <-- Importe o seu novo apiFetch

const BOT_URL      = "https://nexbot.nexfood.app"
const POLL_INTERVAL = 60_000  // o bot raramente cai; minimizado ninguém vê o selo, então não consulta

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

    // Antes: a cada 30 s o dia todo (2.880 consultas por computador). Agora: 60 s com a janela à vista
    // e uma consulta ao voltar para ela.
    let id = null
    const ligar = () => {
      clearInterval(id)
      id = null
      if (document.hidden) return
      check()
      id = setInterval(check, POLL_INTERVAL)
    }
    ligar()
    document.addEventListener('visibilitychange', ligar)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', ligar)
    }
  }, [])

  return status
}
