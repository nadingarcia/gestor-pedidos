import { useState, useEffect, useMemo } from 'react'
import electronAPI from '@utils/electronBridge'

const formatTime = (dateStr) => {
  if (!dateStr) return '--:--'
  return new Date(dateStr).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const getMinutes = (dateStr) => {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

const getOrderNumber = (p) =>
  p?.numeroPedido || p?._id?.slice(-4).toUpperCase() || '----'

const cleanName = (name = '') => name.replace(/\s*\(padrão\)/gi, '').trim()

export default function KitchenDisplay() {
  const [orders, setOrders] = useState([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    electronAPI.onKitchenOrders((incoming) => setOrders(incoming || []))
    return () => electronAPI.offKitchenOrders()
  }, [])

  const sortedOrders = useMemo(() => {
    return [...orders].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }, [orders])

  const oldestOrder = sortedOrders[0]
  const pendingCount = sortedOrders.length

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col select-none">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-lg shadow-[#7f22fe]/30">
            <i className="fas fa-bolt text-white text-xl"></i>
          </div>
          <div>
            <p className="text-lg font-black tracking-tight leading-tight">Cozinha</p>
            <p className="text-xs text-gray-400">
              {oldestOrder ? `Mais antigo: #${getOrderNumber(oldestOrder)}` : 'Sem pedidos no momento'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-gray-400 text-sm">
            {new Date().toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="ml-2 text-sm font-black bg-orange-500 px-3 py-1.5 rounded-full text-white">
            {pendingCount} em preparo
          </span>
        </div>
      </header>

      {/* Grid */}
      <main className="flex-1 p-5 overflow-y-auto">
        {sortedOrders.length === 0 ? (
          <div className="h-full min-h-[60vh] flex flex-col items-center justify-center gap-4 opacity-30">
            <i className="fas fa-fire text-6xl text-orange-400"></i>
            <p className="text-xl font-medium">Aguardando pedidos...</p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {sortedOrders.map((pedido) => {
              const mins = Math.floor((now - new Date(pedido.createdAt)) / 60000)
              const isUrgent = mins >= 30
              const isWarning = mins >= 20 && mins < 30
              const isRecent = mins < 10

              const cardStyle = isUrgent
                ? 'bg-red-950/70 border-red-500 shadow-red-500/10'
                : isWarning
                ? 'bg-yellow-950/55 border-yellow-500 shadow-yellow-500/10'
                : 'bg-gray-900 border-gray-700 shadow-black/20'

              const timeBadgeStyle = isUrgent
                ? 'bg-red-500 text-white'
                : isWarning
                ? 'bg-yellow-500 text-yellow-950'
                : isRecent
                ? 'bg-emerald-500 text-emerald-950'
                : 'bg-gray-700 text-gray-200'

              return (
                <div
                  key={pedido._id}
                  className={`rounded-2xl p-4 border-2 flex flex-col gap-4 transition-all duration-200 ${cardStyle}`}
                >
                  {/* Cabeçalho do card */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl font-black tracking-tight">
                          #{getOrderNumber(pedido)}
                        </span>

                        {isUrgent && (
                          <span className="text-[10px] font-black uppercase tracking-widest bg-red-500 text-white px-2 py-1 rounded-full">
                            urgente
                          </span>
                        )}

                        {isWarning && !isUrgent && (
                          <span className="text-[10px] font-black uppercase tracking-widest bg-yellow-500 text-yellow-950 px-2 py-1 rounded-full">
                            atenção
                          </span>
                        )}
                      </div>

                      <p className="text-gray-400 text-sm mt-1">
                        {pedido.cliente?.nome || 'Consumidor'} · {formatTime(pedido.createdAt)}
                      </p>
                    </div>

                    <span
                      className={`text-lg font-black px-3 py-1.5 rounded-xl tabular-nums min-w-[58px] text-center ${timeBadgeStyle}`}
                    >
                      {mins}m
                    </span>
                  </div>

                  {/* Tipo */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        pedido.tipo === 'Delivery'
                          ? 'bg-blue-900 text-blue-300'
                          : 'bg-orange-900 text-orange-300'
                      }`}
                    >
                      <i
                        className={`fas ${
                          pedido.tipo === 'Delivery' ? 'fa-motorcycle' : 'fa-store'
                        } mr-1`}
                      ></i>
                      {pedido.tipo}
                    </span>

                    <span className="text-xs text-gray-400">
                      {pedido.itens?.length || 0} item(ns)
                    </span>
                  </div>

                  {/* Itens */}
                  <div className="space-y-3 border-t border-gray-800 pt-3">
                    {(pedido.itens || []).map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl bg-black/20 border border-white/5 px-3 py-3"
                      >
                        <div className="flex gap-3 items-start">
                          <span className="text-sm font-black text-orange-400 min-w-[38px] bg-orange-500/10 border border-orange-500/20 rounded-lg px-2 py-1 text-center">
                            {item.quantidade}x
                          </span>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-bold leading-tight break-words">
                                {cleanName(item.nome)}
                              </p>
                            </div>

                            {item.complementos?.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.quantidade > 1 && (
                                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                                    cada unidade:
                                  </p>
                                )}
                                <p className="text-sm text-gray-400">
                                  + {item.complementos.join(', ')}
                                </p>
                              </div>
                            )}

                            {item.obs && (
                              <p className="text-xs text-yellow-300 mt-2 bg-yellow-950/70 border border-yellow-500/20 px-2.5 py-2 rounded-lg">
                                <i className="fas fa-triangle-exclamation mr-1"></i>
                                {item.obs}
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