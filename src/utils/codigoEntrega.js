// Código do entregador: 4 números tirados do id do pedido, impressos na comanda.
// O motoboy digita no app o código das sacolas que vai levar.
// É o mesmo cálculo no servidor (nexfood/lib/utils), no painel (nexfood/public/js/utils)
// e no gestor (gestor-pedidos/src/utils): mudou num, mude nos três.
// FNV-1a do id: pedidos seguidos não têm códigos vizinhos (o final do id do Mongo é um
// contador), então errar um dígito quase nunca cai em outro pedido aberto.
export function codigoEntrega(id) {
  const texto = String(id || '')
  if (!texto) return ''
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return String((h >>> 0) % 10000).padStart(4, '0')
}
