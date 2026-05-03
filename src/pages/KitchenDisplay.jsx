import { useState, useEffect } from 'react'
import electronAPI from '@utils/electronBridge'

const formatTime = (dateStr) => {
  if (!dateStr) return '--:--'
  return new Date(dateStr).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit',
  })
}

const getMinutes = (dateStr) => {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr)) / 60000)
}

const getOrderNumber = (p) =>
  p?.numeroPedido || p?._id?.slice(-4).toUpperCase() || '----'

export default function KitchenDisplay() {
  const [orders, setOrders] = useState([])
  const [now, setNow] = useState(Date.now())

  // Tick global para atualizar os timers
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Escuta pedidos enviados pelo OrderManager
  useEffect(() => {
    electronAPI.onKitchenOrders((incoming) => setOrders(incoming))
    return () => electronAPI.offKitchenOrders()
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col select-none">

      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#7f22fe] flex items-center justify-center">
            <i className="fas fa-bolt text-white text-sm"></i>
          </div>
          <span className="text-lg font-bold tracking-tight">Cozinha</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
          <span className="text-gray-400 text-sm">
            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="ml-4 text-sm font-bold bg-orange-500 px-3 py-1 rounded-full">
            {orders.length} em preparo
          </span>
        </div>
      </header>

      {/* Grid de pedidos */}
      <main className="flex-1 p-6 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 opacity-30">
            <i className="fas fa-fire text-5xl text-orange-400"></i>
            <p className="text-xl font-medium">Aguardando pedidos...</p>
          </div>
        ) : (
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {orders.map((pedido) => {
              const mins = Math.floor((now - new Date(pedido.createdAt)) / 60000)
              const isUrgent = mins > 30
              const isWarning = mins > 20

              return (
                <div
                  key={pedido._id}
                  className={`rounded-xl p-5 border-2 flex flex-col gap-4 transition-all ${
                    isUrgent
                      ? 'bg-red-950 border-red-500'
                      : isWarning
                      ? 'bg-yellow-950 border-yellow-500'
                      : 'bg-gray-900 border-gray-700'
                  }`}
                >
                  {/* Cabeçalho do card */}
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-2xl font-black tracking-tight">
                        #{getOrderNumber(pedido)}
                      </span>
                      <p className="text-gray-400 text-sm mt-0.5">
                        {pedido.cliente?.nome || 'Consumidor'} · {formatTime(pedido.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`text-lg font-black px-3 py-1 rounded-lg tabular-nums ${
                        isUrgent
                          ? 'bg-red-500 text-white'
                          : isWarning
                          ? 'bg-yellow-500 text-yellow-950'
                          : 'bg-gray-700 text-gray-200'
                      }`}
                    >
                      {mins}m
                    </span>
                  </div>

                  {/* Tipo */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      pedido.tipo === 'Delivery'
                        ? 'bg-blue-900 text-blue-300'
                        : 'bg-orange-900 text-orange-300'
                    }`}>
                      <i className={`fas ${pedido.tipo === 'Delivery' ? 'fa-motorcycle' : 'fa-store'} mr-1`}></i>
                      {pedido.tipo}
                    </span>
                  </div>

                  {/* Itens */}
                  <div className="space-y-2 border-t border-gray-700 pt-3">
                    {pedido.itens.map((item, idx) => (
                      <div key={idx}>
                        <div className="flex gap-3 items-start">
                          <span className="text-base font-black text-orange-400 min-w-[28px]">
                            {item.quantidade}x
                          </span>
                          <div className="flex-1">
                            <p className="text-sm font-bold leading-tight">
                              {item.nome.replace(/\s*\(padrão\)/gi, '').trim()}
                            </p>
                            {item.complementos?.length > 0 && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                + {item.complementos.join(', ')}
                              </p>
                            )}
                            {item.obs && (
                              <p className="text-xs text-yellow-400 mt-1 bg-yellow-950 px-2 py-1 rounded">
                                ⚠ {item.obs}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}