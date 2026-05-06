// ── Pedido fictício para imprimir teste de estilo ─────────────────────────
export const PEDIDO_TESTE_IMPRESSAO = {
  _id: 'test00000000',
  numeroPedido: 'TESTE',
  createdAt: new Date().toISOString(),
  tipo: 'Delivery',
  status: 'Em preparação',
  cliente: { nome: 'Cliente Teste', telefone: '(11) 99999-9999', totalPedidos: 3 },
  enderecoEntrega: {
    rua: 'Av. Paulista', numero: '1578',
    bairro: 'Bela Vista', cidade: 'São Paulo', complemento: 'Apto 42',
  },
  itens: [
    { nome: 'X-Burger Duplo Especial', quantidade: 1, precoUnitario: 32.90,
      complementos: ['Bacon extra', 'Sem cebola'], obs: 'Ponto médio por favor' },
    { nome: 'Batata Frita G', quantidade: 2, precoUnitario: 12.00, complementos: [], obs: '' },
    { nome: 'Refrigerante Lata', quantidade: 1, precoUnitario: 6.00, complementos: [], obs: '' },
  ],
  subtotal: 62.90, desconto: 6.00, total: 56.90,
  formaPagamento: 'pix', statusPagamento: 'aprovado', trocoPara: null,
}