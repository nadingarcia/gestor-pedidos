// src/utils/nexBotNotify.js
// Wrapper autocontido — resolve o token correto do gestor
// e replica apenas o necessário do nexbot.js para evitar
// acoplamento com o painel administrativo.

const BOT_URL = "https://lizanimiranda.com.br"

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
export async function notifyOrderStatus(pedido, novoStatus) {
  try {
    const statusBackend = STATUS_MAP[novoStatus]
    if (!statusBackend) return                          // status não notificável

    let telefone = pedido?.cliente?.telefone
    if (!telefone) return                               // sem telefone, silencioso

    telefone = telefone.replace(/\D/g, '')
    if (!telefone.startsWith('55')) telefone = '55' + telefone

    // Gestor usa nexfood_token; painel usa authToken — tenta os dois
    const token = localStorage.getItem('nexfood_token')
                || localStorage.getItem('authToken')
    if (!token) return

    const res = await fetch(`${BOT_URL}/restaurant/order-status`, {
      method: 'POST',
      headers: {
        'Content-Type':               'application/json',
        'Authorization':              `Bearer ${token}`,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        telefoneCliente: telefone,
        nomeCliente:     pedido?.cliente?.nome || pedido?.cliente?.name || '',
        numeroPedido:    pedido.numeroPedido   || pedido._id?.slice(-6).toUpperCase(),
        status:          statusBackend,
        tipoEntrega:     pedido?.tipoEntrega   || 'DELIVERY',
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.warn(`[NexBot] Erro ${res.status}:`, err)
      return
    }

    console.log(`[NexBot] ✅ ${novoStatus} → ${telefone}`)
  } catch (err) {
    // Nunca deixa erro de WhatsApp quebrar o fluxo do pedido
    console.warn('[NexBot] Falha silenciosa:', err.message)
  }
}