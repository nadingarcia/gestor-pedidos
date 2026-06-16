// src/utils/nexBotNotify.js
// Wrapper autocontido — agora utiliza apiFetch para garantir
// que o token seja renovado caso esteja expirado, evitando 
// falhas silenciosas no envio do WhatsApp.

import { apiFetch } from '@utils/apiFetch'; // <-- Importando o apiFetch
import { isDelivery } from '@utils/orderType'

const BOT_URL = "https://nexbot.nexfood.app"

const STATUS_MAP = {
  'Em preparação':     'PREPARING',
  'Pronto':            'READY',
  'Saiu para entrega': 'OUT_DELIVERY',
  'Entregue':          'DELIVERED',
  'Cancelado':         'CANCELLED',
  // 'Recebido' e 'Confirmado' intencionalmente omitidos
}

/**
 * Envia notificação WhatsApp ao cliente via NexBot.
 * Fire-and-forget — nunca quebra o fluxo do pedido.
 *
 * @param {Object} pedido  - objeto completo do pedido
 * @param {string} novoStatus - status em português (ex: 'Em preparação')
 */
export async function notifyOrderStatus(pedido, novoStatus, botStatus = 'offline') {
  try {
    // 🛑 A SUA IDEIA AQUI: Se o bot não estiver online, aborta antes de gastar rede!
    if (botStatus !== 'online') {
      console.log(`[NexBot] 🔇 Offline: Notificação de '${novoStatus}' ignorada.`);
      return; 
    }

    const statusBackend = STATUS_MAP[novoStatus]
    if (!statusBackend) return                          

    let telefone = pedido?.cliente?.telefone
    if (!telefone) return                               

    telefone = telefone.replace(/\D/g, '')
    if (!telefone.startsWith('55')) telefone = '55' + telefone

    const res = await apiFetch(`${BOT_URL}/restaurant/order-status`, {
      method: 'POST',
      headers: {
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        telefoneCliente: telefone,
        nomeCliente:     pedido?.cliente?.nome || '',
        numeroPedido:    pedido.numeroPedido   || pedido._id?.slice(-4).toUpperCase(),
        status:          statusBackend,
        tipoEntrega:     isDelivery(pedido) ? 'DELIVERY' : 'RETIRADA',
        pedidoId:        pedido._id,
        temMotoboy:      pedido?.temMotoboy    || false, // ✅ true quando motoboy atribuído
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.warn(`[NexBot] Erro ${res.status}:`, err)
      return
    }

    console.log(`[NexBot] ✅ ${novoStatus} → ${telefone}`)
  } catch (err) {
    console.warn('[NexBot] Falha silenciosa:', err.message)
  }
}
