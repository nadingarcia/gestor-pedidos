import { useState, useRef } from 'react'
import Draggable from 'react-draggable'

const formatCurrency = (val) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)

const getOrderNum = (pedido) =>
  pedido?.numeroPedido || pedido?._id?.slice(-4).toUpperCase() || '----'

export function ClusterFloatingCard({ cluster, pedidos, onAdvanceCluster, onOrderClick, onClose }) {
  const [minimized, setMinimized] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const nodeRef = useRef(null)

  const clusterOrders = pedidos.filter((p) => p.clusterId === cluster.clusterId)

  // ⚠️ Early return APÓS todos os hooks (Rules of Hooks)
  if (!clusterOrders.length) return null

  // ── Dados agregados ───────────────────────────────────────────────────────
  const totalValue = clusterOrders.reduce((acc, p) => acc + (p.total || 0), 0)
  const totalItens = clusterOrders.reduce(
    (acc, p) => acc + p.itens.reduce((s, item) => s + item.quantidade, 0),
    0
  )

  // Bairro mais frequente entre os pedidos do cluster
  const bairroPredominante = (() => {
    const contagem = {}
    clusterOrders.forEach((p) => {
      const b = p.enderecoEntrega?.bairro
      if (b) contagem[b] = (contagem[b] || 0) + 1
    })
    return Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Entrega'
  })()

  const horaCriacao = new Date(clusterOrders[0].createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const rotaTitulo = `${bairroPredominante} • ${horaCriacao}`

  return (
    <Draggable
      nodeRef={nodeRef}
      handle=".drag-handle"
      bounds="body"
      position={position}
      onStop={(_, data) => setPosition({ x: data.x, y: data.y })}
    >
      <div
        ref={nodeRef}
        style={{ top: 100, left: 'calc(100vw - 340px)' }}
        className={`fixed z-50 shadow-2xl rounded-xl border-2 bg-white flex flex-col transition-all duration-200 ${
          cluster.clusterColor.border
        } ${minimized ? 'w-auto' : 'w-80 max-h-[500px]'}`}
      >
        {/* ── Header arrastável ─────────────────────────────────────────── */}
        <div
          className={`drag-handle cursor-move select-none p-3 rounded-t-lg flex items-center justify-between ${cluster.clusterColor.bg}`}
        >
          <div className="flex items-center gap-3">
            {/* Contador de pedidos */}
            <div
              className={`flex flex-col items-center justify-center w-10 h-10 rounded-lg ${cluster.clusterColor.badge} text-white shadow-sm shrink-0`}
              aria-hidden="true"
            >
              <span className="text-sm font-black leading-none">{clusterOrders.length}</span>
              <span className="text-[8px] font-medium uppercase">Pedidos</span>
            </div>

            {!minimized && (
              <div>
                <h4 className={`text-sm font-bold leading-tight ${cluster.clusterColor.text}`}>
                  {rotaTitulo}
                </h4>
                <p className="flex items-center gap-2 text-[10px] text-gray-600 font-medium mt-0.5">
                  <span>{totalItens} itens</span>
                  <span className="w-1 h-1 bg-gray-400 rounded-full" aria-hidden="true" />
                  <span>{formatCurrency(totalValue)}</span>
                </p>
              </div>
            )}
          </div>

          {/* Controles */}
          <div className="flex items-center gap-1 ml-2 shrink-0">
            <button
              type="button"
              onClick={() => setMinimized((v) => !v)}
              className="p-1.5 rounded-md hover:bg-white/40 text-gray-700 transition-colors"
              aria-label={minimized ? 'Expandir painel' : 'Minimizar painel'}
              title={minimized ? 'Expandir' : 'Minimizar'}
            >
              <i className={`fas fa-${minimized ? 'expand-alt' : 'minus'} text-xs`} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-red-500 hover:text-white text-gray-700 transition-colors"
              aria-label="Desafixar grupo de rotas"
              title="Desafixar Grupo"
            >
              <i className="fas fa-times text-xs" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* ── Conteúdo ──────────────────────────────────────────────────── */}
        {!minimized && (
          <div className="flex flex-col overflow-hidden bg-white rounded-b-lg">

            {/* Lista de pedidos */}
            <div className="overflow-y-auto p-2 space-y-2 custom-scrollbar flex-1">
              {clusterOrders.map((pedido, idx) => (
                <button
                  key={pedido._id}
                  type="button"
                  onClick={() => onOrderClick(pedido)}
                  className="group relative w-full text-left p-2.5 rounded-lg border border-transparent hover:border-gray-200 hover:shadow-md bg-gray-50 hover:bg-white transition-all duration-200"
                  aria-label={`Ver pedido #${getOrderNum(pedido)} — ${pedido.cliente?.nome}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0 ${cluster.clusterColor.badge}`}
                        aria-hidden="true"
                      >
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-gray-900">
                        #{getOrderNum(pedido)}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        pedido.status === 'Em preparação'
                          ? 'bg-orange-100 text-orange-600'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {pedido.status === 'Em preparação' ? 'Prep' : pedido.status}
                    </span>
                  </div>

                  <div className="pl-7">
                    <p className="text-xs font-semibold text-gray-800 truncate">
                      {pedido.cliente?.nome || 'Consumidor'}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate mt-0.5">
                      {pedido.enderecoEntrega?.rua}, {pedido.enderecoEntrega?.numero}
                    </p>
                  </div>

                  <i
                    className="fas fa-chevron-right absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="p-3 bg-gray-50 border-t border-gray-100 space-y-2">
              <button
                type="button"
                onClick={onAdvanceCluster}
                className={`w-full py-3 rounded-lg font-bold text-white text-sm shadow-md hover:shadow-lg hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${cluster.clusterColor.badge}`}
              >
                <i className="fas fa-motorcycle" aria-hidden="true" />
                Despachar Rota ({clusterOrders.length})
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setPosition({ x: 0, y: 0 })}
                  className="text-[9px] text-gray-400 hover:text-gray-600 underline"
                >
                  Resetar posição da janela
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Draggable>
  )
}