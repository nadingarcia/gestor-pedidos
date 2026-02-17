import { useState, useRef } from 'react'
import Draggable from 'react-draggable'

export function ClusterFloatingCard({ cluster, pedidos, onAdvanceCluster, onOrderClick, onClose }) {
  const [minimized, setMinimized] = useState(false)
  const nodeRef = useRef(null) // Elimina warning findDOMNode
  
  const clusterOrders = pedidos.filter(p => p.clusterId === cluster.clusterId)
  const totalValue = clusterOrders.reduce((acc, p) => acc + (p.total || 0), 0)
  
  // Nome automático pelo bairro mais comum
  const bairros = clusterOrders.map(p => p.enderecoEntrega?.bairro).filter(Boolean)
  const bairroMaisComum = bairros.sort((a,b) => 
    bairros.filter(v => v === a).length - bairros.filter(v => v === b).length
  ).pop()
  
  const clusterName = bairroMaisComum || `Cluster ${cluster.clusterId.slice(-4)}`

  return (
    <Draggable 
      handle=".drag-handle" 
      bounds="parent"
      nodeRef={nodeRef}
    >
      <div 
        ref={nodeRef}
        className={`fixed bg-white rounded-xl shadow-2xl border-2 z-50 transition-all duration-300 ${cluster.clusterColor.border} ${
          minimized ? 'w-16 h-16' : 'w-80'
        }`}
        style={{ 
          top: '120px', 
          right: minimized ? '20px' : '400px',
        }}
      >
        {/* Header arrastável */}
        <div 
          className={`drag-handle p-3 cursor-move rounded-t-xl border-b-2 ${cluster.clusterColor.bg} ${cluster.clusterColor.border} flex items-center justify-between`}
        >
          {!minimized ? (
            <>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full ${cluster.clusterColor.badge} text-white flex items-center justify-center font-bold text-sm shadow-sm`}>
                  {clusterOrders.length}
                </div>
                <div>
                  <p className={`font-bold text-sm ${cluster.clusterColor.text}`}>{clusterName}</p>
                  <p className="text-[10px] text-gray-600">R$ {totalValue.toFixed(2)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMinimized(true)}
                  className="w-6 h-6 rounded hover:bg-white/50 flex items-center justify-center text-xs"
                  aria-label="Minimizar"
                >
                  <i className="fas fa-minus"></i>
                </button>
                <button
                  onClick={onClose}
                  className="w-6 h-6 rounded hover:bg-white/50 flex items-center justify-center text-xs"
                  aria-label="Fechar"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setMinimized(false)}
              className={`w-full h-full flex items-center justify-center ${cluster.clusterColor.badge} rounded-lg text-white font-bold text-xl`}
              aria-label="Expandir"
            >
              {clusterOrders.length}
            </button>
          )}
        </div>

        {/* Conteúdo */}
        {!minimized && (
          <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
            {/* Lista de pedidos */}
            <div className="space-y-2">
              {clusterOrders.map(pedido => (
                <button
                  key={pedido._id}
                  onClick={() => onOrderClick(pedido)}
                  className={`w-full p-2 rounded bg-white border ${cluster.clusterColor.border} text-left hover:shadow-sm transition-all`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold">#{pedido._id.slice(-4).toUpperCase()}</span>
                    <span className="text-xs font-semibold">R$ {pedido.total.toFixed(2)}</span>
                  </div>
                  <p className="text-[10px] text-gray-600 truncate">{pedido.cliente?.nome}</p>
                  <p className={`text-[9px] ${cluster.clusterColor.text} font-medium`}>{pedido.status}</p>
                </button>
              ))}
            </div>

            {/* Botão de ação */}
            {clusterOrders.some(p => p.status === 'Em preparação') && (
              <button
                onClick={onAdvanceCluster}
                className={`w-full py-2.5 rounded-lg ${cluster.clusterColor.badge} text-white font-bold text-sm hover:opacity-90 shadow-sm transition-all`}
              >
                <i className="fas fa-shipping-fast mr-2"></i>
                Enviar Cluster para Entrega
              </button>
            )}

            {clusterOrders.every(p => p.status === 'Saiu para entrega' || p.status === 'Saiu para Entrega') && (
              <button
                onClick={onAdvanceCluster}
                className={`w-full py-2.5 rounded-lg ${cluster.clusterColor.badge} text-white font-bold text-sm hover:opacity-90 shadow-sm transition-all`}
              >
                <i className="fas fa-check-circle mr-2"></i>
                Finalizar Cluster
              </button>
            )}
          </div>
        )}
      </div>
    </Draggable>
  )
}