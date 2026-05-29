export const TIPO_PEDIDO_TODOS = 'todos'
export const TIPO_PEDIDO_DELIVERY = 'Delivery'
export const TIPO_PEDIDO_BALCAO = 'Balcao'

const stripAccents = (value = '') =>
  String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export const normalizeTipoPedido = (tipo) => {
  const normalized = stripAccents(tipo).trim().toLowerCase()

  if (normalized === 'delivery') return TIPO_PEDIDO_DELIVERY
  if (normalized === 'balcao') return TIPO_PEDIDO_BALCAO

  return tipo || ''
}

export const isDelivery = (pedidoOrTipo) => {
  const tipo =
    typeof pedidoOrTipo === 'object' ? pedidoOrTipo?.tipo : pedidoOrTipo

  return normalizeTipoPedido(tipo) === TIPO_PEDIDO_DELIVERY
}

export const getTipoPedidoLabel = (tipo) => {
  const normalized = normalizeTipoPedido(tipo)

  if (normalized === TIPO_PEDIDO_DELIVERY) return 'Delivery'
  if (normalized === TIPO_PEDIDO_BALCAO) return 'Balcão'

  return tipo || 'Balcão'
}
