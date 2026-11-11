// Frases prontas para o caixa responder, pelo Gestor, um alarme do NexBot. O texto vai para o cliente
// pelo WhatsApp da loja. A frase só avisa: cancelar, trocar endereço e alterar seguem sendo feitos por
// quem atende. Não há frase "Cancelado": cancelar o pedido já avisa o cliente.
const FRASES = [
  {
    quando: /cancelar/i,
    frases: [
      { rotulo: 'Já saiu, não dá mais', texto: (n) => `Oi! Seu pedido${n} já saiu para entrega, então não conseguimos mais cancelar. 🙏` },
      { rotulo: 'Já está em preparo', texto: (n) => `Oi! Seu pedido${n} já está sendo preparado, então não conseguimos mais cancelar. 🙏` },
    ],
  },
  {
    quando: /endere[cç]o/i,
    frases: [
      { rotulo: 'Endereço trocado', texto: (n) => `Pronto! Trocamos o endereço do pedido${n}. ✅` },
      { rotulo: 'Já saiu, o entregador liga', texto: (n) => `Seu pedido${n} já saiu com o endereço anterior. O entregador vai te ligar para combinar a entrega.` },
    ],
  },
  {
    quando: /pagou/i,
    frases: [
      { rotulo: 'Pagamento confirmado', texto: (n) => `Confirmamos o pagamento do pedido${n}. Obrigado! ✅` },
      { rotulo: 'Não achamos o pagamento', texto: (n) => `Não encontramos o pagamento do pedido${n}. Pode mandar o comprovante por aqui?` },
    ],
  },
  {
    quando: /alterar/i,
    frases: [
      { rotulo: 'Pedido alterado', texto: (n) => `Pronto! Alteramos o pedido${n} como você pediu. ✅` },
      { rotulo: 'Já está em preparo', texto: (n) => `Seu pedido${n} já está sendo preparado, então não conseguimos mais alterar. 🙏` },
    ],
  },
]

export const MAX_RESPOSTA = 500

/** Frases para o recado do alarme ("cliente quer cancelar"); lista vazia se o recado for outro. */
export function frasesDoRecado(recado, numero = null) {
  const grupo = FRASES.find((g) => g.quando.test(recado || ''))
  if (!grupo) return []
  const n = numero ? ` #${numero}` : ''
  return grupo.frases.map((f) => ({ rotulo: f.rotulo, texto: f.texto(n) }))
}
