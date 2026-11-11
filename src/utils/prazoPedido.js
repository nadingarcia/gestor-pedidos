import { isDelivery } from './orderType.js'

// Prazo de cada pedido no quadro. Na entrega vale o que a loja promete ao cliente em Minha Loja
// (`tempoEntrega`, o mesmo "30–50 min" do app): o pedido atrasa quando passa do máximo prometido.
// Retirada não tem prazo cadastrado.
export const PRAZO_ENTREGA_PADRAO = 50 // o app mostra "30–50 min" quando a loja não cadastrou
export const PRAZO_RETIRADA = 15
const ATENCAO_MIN = 10

/** Máximo que a loja promete para a entrega, em minutos; null se não cadastrou. */
export function prazoEntregaDaLoja(tempoEntrega) {
  const maximo = Number(tempoEntrega?.maximo)
  const minimo = Number(tempoEntrega?.minimo)
  const prazo = Math.max(maximo > 0 ? maximo : 0, minimo > 0 ? minimo : 0)
  return prazo > 0 ? Math.round(prazo) : null
}

export function prazoDoPedido(pedido, prazoEntrega) {
  return isDelivery(pedido) ? (prazoEntrega || PRAZO_ENTREGA_PADRAO) : PRAZO_RETIRADA
}

/** Tudo em minutos inteiros: o quadro só muda na virada do minuto. */
export function situacaoDoPrazo(criadoEm, prazoMin, agora = Date.now()) {
  const passados = Math.max(0, Math.floor((agora - new Date(criadoEm).getTime()) / 60000)) || 0
  const restam = Math.max(0, prazoMin - passados)
  const atrasado = passados >= prazoMin
  return {
    passados,
    restam,
    atrasado,
    atraso: atrasado ? passados - prazoMin : 0,
    atencao: !atrasado && restam <= ATENCAO_MIN,
  }
}
