// src/hooks/useNexBotStatus.jsx
// Só leitura de status, sem QR, sem connect/disconnect: o funcionário sabe se as notificações estão ativas.
// Com o canal de avisos ligado, o NexBot avisa quando o WhatsApp cai ou volta (aviso `nexbot`) e a
// consulta vira reserva de 5 min, para o caso de o bot cair inteiro e não conseguir avisar.
// Sem o canal, consulta a cada 60 s. Sempre só com a janela à vista.

import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '@utils/apiFetch' // <-- Importe o seu novo apiFetch

const BOT_URL      = "https://nexbot.nexfood.app"
const POLL_SEM_CANAL_MS = 60_000      // minimizado ninguém vê o selo, então não consulta
const POLL_COM_CANAL_MS = 5 * 60_000  // reserva: o aviso do canal chega antes

/**
 * @param {{ canalLigado?: boolean, sinal?: number }} opcoes `sinal` muda a cada aviso `nexbot` do canal
 * @returns {'online' | 'offline' | 'checking'}
 */
export function useNexBotStatus({ canalLigado = false, sinal = 0 } = {}) {
  const [status, setStatus] = useState('checking')
  const conferirRef = useRef(null)

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

    conferirRef.current = check
    // Uma consulta ao abrir, ao voltar para a janela e quando o canal liga ou cai (o intervalo muda junto)
    const intervalo = canalLigado ? POLL_COM_CANAL_MS : POLL_SEM_CANAL_MS
    let id = null
    const ligar = () => {
      clearInterval(id)
      id = null
      if (document.hidden) return
      check()
      id = setInterval(check, intervalo)
    }
    ligar()
    document.addEventListener('visibilitychange', ligar)
    return () => {
      cancelled = true
      conferirRef.current = null
      clearInterval(id)
      document.removeEventListener('visibilitychange', ligar)
    }
  }, [canalLigado])

  // O bot avisou que o WhatsApp caiu ou voltou: confere na hora (escondida, confere ao voltar)
  useEffect(() => {
    if (sinal && !document.hidden) conferirRef.current?.()
  }, [sinal])

  return status
}
