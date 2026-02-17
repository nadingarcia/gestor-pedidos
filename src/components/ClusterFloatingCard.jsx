import { useState, useRef, useEffect } from 'react'
import Draggable from 'react-draggable'

export function ClusterFloatingCard({ cluster, pedidos, onAdvanceCluster, onOrderClick, onClose }) {
  const [minimized, setMinimized] = useState(false)
  // Estado para controlar posição resetada se sair da tela
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const nodeRef = useRef(null) 

  const clusterOrders = pedidos.filter(p => p.clusterId === cluster.clusterId)
  
  if (!clusterOrders.length) return null

  // Dados agregados
  const totalValue = clusterOrders.reduce((acc, p) => acc + (p.total || 0), 0)
  const totalItens = clusterOrders.reduce((acc, p) => acc + p.itens.reduce((i, item) => i + item.quantidade, 0), 0)
  
  // Nome Inteligente da Rota (Ex: Rota Centro - 10:45)
  const bairros = clusterOrders.map(p => p.enderecoEntrega?.bairro).filter(Boolean)
  const bairroPredominante = bairros.sort((a,b) => 
    bairros.filter(v => v === a).length - bairros.filter(v => v === b).length
  ).pop() || 'Entrega'
  
  const horaCriacao = new Date(clusterOrders[0].createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute:'2-digit' })
  const rotaTitulo = `${bairroPredominante} • ${horaCriacao}`

  // Efeito para garantir que ao minimizar não suma
  useEffect(() => {
    if (minimized) {
      // Opcional: Snap to edge logic poderia ir aqui
    }
  }, [minimized])

  const handleResetPosition = (e) => {
    e.stopPropagation()
    setPosition({ x: 0, y: 0 })
  }

  return (
    <Draggable 
      nodeRef={nodeRef}
      handle=".drag-handle"
      bounds="body" // Impede que saia da tela
      position={position}
      onStop={(e, data) => setPosition({ x: data.x, y: data.y })}
    >
      <div 
        ref={nodeRef}
        className={`fixed z-50 transition-all duration-200 shadow-2xl rounded-xl border-2 bg-white flex flex-col ${cluster.clusterColor.border} ${
          minimized ? 'w-auto' : 'w-80 max-h-[500px]'
        }`}
        style={{ 
          // Posição inicial segura (top-right relativo a viewport)
          top: '100px', 
          right: '20px' 
        }}
      >
        {/* --- HEADER ARRASTÁVEL --- */}
        <div 
          className={`drag-handle cursor-move select-none p-3 rounded-t-lg flex items-center justify-between transition-colors ${cluster.clusterColor.bg}`}
        >
          <div className="flex items-center gap-3">
            {/* Badge de Quantidade */}
            <div className={`flex flex-col items-center justify-center w-10 h-10 rounded-lg ${cluster.clusterColor.badge} text-white shadow-sm`}>
              <span className="text-sm font-black leading-none">{clusterOrders.length}</span>
              <span className="text-[8px] font-medium uppercase">Pedidos</span>
            </div>

            {/* Info da Rota (Escondido se minimizado) */}
            {!minimized && (
              <div>
                <h4 className={`text-sm font-bold ${cluster.clusterColor.text} leading-tight`}>
                  {rotaTitulo}
                </h4>
                <div className="flex items-center gap-2 text-[10px] text-gray-600 font-medium mt-0.5">
                  <span>{totalItens} itens</span>
                  <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                  <span>R$ {totalValue.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Controles da Janela */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => setMinimized(!minimized)}
              className="p-1.5 rounded-md hover:bg-white/40 text-gray-700 transition-colors"
              title={minimized ? "Expandir" : "Minimizar"}
            >
              <i className={`fas fa-${minimized ? 'expand-alt' : 'minus'} text-xs`}></i>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-red-500 hover:text-white text-gray-700 transition-colors"
              title="Desafixar Grupo"
            >
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>
        </div>

        {/* --- CONTEÚDO (Só aparece se não minimizado) --- */}
        {!minimized && (
          <div className="flex flex-col overflow-hidden bg-white rounded-b-lg">
            
            {/* Lista de Pedidos com Scroll */}
            <div className="overflow-y-auto p-2 space-y-2 custom-scrollbar flex-1">
              {clusterOrders.map((pedido, idx) => (
                <div 
                  key={pedido._id}
                  onClick={() => onOrderClick(pedido)}
                  className={`group relative p-2.5 rounded-lg border border-transparent hover:border-gray-200 hover:shadow-md bg-gray-50 hover:bg-white cursor-pointer transition-all duration-200`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold text-white ${cluster.clusterColor.badge}`}>
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-gray-900">
                        #{pedido._id.slice(-4).toUpperCase()}
                      </span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      pedido.status === 'Em preparação' ? 'bg-orange-100 text-orange-600' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {pedido.status === 'Em preparação' ? 'Prep' : pedido.status}
                    </span>
                  </div>
                  
                  <div className="pl-7">
                    <p className="text-xs font-semibold text-gray-800 truncate">{pedido.cliente?.nome}</p>
                    <p className="text-[10px] text-gray-500 truncate mt-0.5">
                      {pedido.enderecoEntrega?.rua}, {pedido.enderecoEntrega?.numero}
                    </p>
                  </div>

                  <i className="fas fa-chevron-right absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity text-xs"></i>
                </div>
              ))}
            </div>

            {/* Footer de Ação */}
            <div className="p-3 bg-gray-50 border-t border-gray-100">
              <button
                onClick={onAdvanceCluster}
                className={`w-full py-3 rounded-lg font-bold text-white text-sm shadow-md hover:shadow-lg hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${cluster.clusterColor.badge}`}
              >
                <i className="fas fa-motorcycle"></i>
                Despachar Rota ({clusterOrders.length})
              </button>
              
              <div className="text-center mt-2">
                 <button onClick={(e) => handleResetPosition(e)} className="text-[9px] text-gray-400 hover:text-gray-600 underline">
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