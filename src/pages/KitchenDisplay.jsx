import { useState, useEffect, useMemo, useCallback } from 'react'
import electronAPI from '@utils/electronBridge'
import { getTipoPedidoLabel, isDelivery } from '@utils/orderType'

const KITCHEN_PREFS_KEY = 'nexfood_kitchen_display_prefs'
const KITCHEN_READY_KEY = 'nexfood_kitchen_ready_items'

const TYPE_CONFIG = {
  delivery: {
    label: 'Delivery',
    icon: 'fa-motorcycle',
    badge: 'bg-blue-900 text-blue-300 border-blue-700/50',
    section: 'border-blue-500/40',
  },
  balcao: {
    label: 'Balcão',
    icon: 'fa-store',
    badge: 'bg-orange-900 text-orange-300 border-orange-700/50',
    section: 'border-orange-500/40',
  },
  retirada: {
    label: 'Retirada',
    icon: 'fa-bag-shopping',
    badge: 'bg-emerald-900 text-emerald-300 border-emerald-700/50',
    section: 'border-emerald-500/40',
  },
}

const formatTime = (dateStr) => {
  if (!dateStr) return '--:--'
  return new Date(dateStr).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}


const getOrderNumber = (p) =>
  p?.numeroPedido || p?._id?.slice(-4).toUpperCase() || '----'

const cleanName = (name = '') => name.replace(/\s*\(padrão\)/gi, '').trim()

const stripAccents = (value = '') =>
  String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const normalizeText = (value = '') => stripAccents(value).trim().toLowerCase()

const getItemObs = (item = {}) =>
  item.obs || item.observacao || item.observacoes || item.observation || ''

const getItemKey = (pedido, idx) => `${pedido._id}:${idx}`

const getKitchenType = (pedido) => {
  if (isDelivery(pedido)) return 'delivery'

  const raw = normalizeText(
    [pedido?.tipo, pedido?.tipoEntrega, pedido?.entrega, pedido?.origem]
      .filter(Boolean)
      .join(' ')
  )

  if (raw.includes('retirada') || raw.includes('retira') || raw.includes('takeaway')) {
    return 'retirada'
  }

  return 'balcao'
}

const readJsonStorage = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export default function KitchenDisplay() {
  const [orders, setOrders] = useState([])
  const [now, setNow] = useState(Date.now())
  const [prefs, setPrefs] = useState(() =>
    readJsonStorage(KITCHEN_PREFS_KEY, {
      kitchenOnly: true,
      showBatch: true,
      largeText: false,
    })
  )
  const [readyItems, setReadyItems] = useState(() =>
    readJsonStorage(KITCHEN_READY_KEY, {})
  )

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    electronAPI.onKitchenOrders((incoming) => setOrders(incoming || []))
    return () => electronAPI.offKitchenOrders()
  }, [])

  useEffect(() => {
    localStorage.setItem(KITCHEN_PREFS_KEY, JSON.stringify(prefs))
  }, [prefs])

  useEffect(() => {
    localStorage.setItem(KITCHEN_READY_KEY, JSON.stringify(readyItems))
  }, [readyItems])

  useEffect(() => {
    const validKeys = new Set()
    orders.forEach((pedido) => {
      ;(pedido.itens || []).forEach((_, idx) => validKeys.add(getItemKey(pedido, idx)))
    })

    setReadyItems((prev) => {
      const next = {}
      Object.entries(prev).forEach(([key, value]) => {
        if (validKeys.has(key) && value) next[key] = true
      })
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [orders])

  const toggleReady = useCallback((pedido, idx) => {
    const key = getItemKey(pedido, idx)
    setReadyItems((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const sortedOrders = useMemo(() => {
    return [...orders].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }, [orders])

  const ordersByType = useMemo(() => {
    const grouped = { delivery: [], balcao: [], retirada: [] }
    sortedOrders.forEach((pedido) => grouped[getKitchenType(pedido)].push(pedido))
    return grouped
  }, [sortedOrders])

  const batchProducts = useMemo(() => {
    const map = new Map()

    sortedOrders.forEach((pedido) => {
      ;(pedido.itens || []).forEach((item, idx) => {
        if (readyItems[getItemKey(pedido, idx)]) return

        const name = cleanName(item.nome || 'Item sem nome')
        const key = normalizeText(name)
        const current = map.get(key) || {
          name,
          quantity: 0,
          orders: [],
          observations: 0,
        }

        current.quantity += Number(item.quantidade) || 1
        current.orders.push(getOrderNumber(pedido))
        if (getItemObs(item)) current.observations += 1
        map.set(key, current)
      })
    })

    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity)
  }, [sortedOrders, readyItems])

  const oldestOrder = sortedOrders[0]
  const pendingCount = sortedOrders.length
  const totalItems = sortedOrders.reduce((acc, pedido) => acc + (pedido.itens?.length || 0), 0)
  const readyCount = sortedOrders.reduce(
    (acc, pedido) =>
      acc + (pedido.itens || []).filter((_, idx) => readyItems[getItemKey(pedido, idx)]).length,
    0
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col select-none">
      <header className="sticky top-0 z-20 border-b border-gray-800 bg-gray-950/95 backdrop-blur shrink-0">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-lg shadow-[#7f22fe]/30 shrink-0">
              <i className="fas fa-bolt text-white text-xl" aria-hidden="true"></i>
            </div>
            <div className="min-w-0">
              <p className="text-lg font-black tracking-tight leading-tight">Cozinha</p>
              <p className="text-xs text-gray-400 truncate">
                {oldestOrder ? `Mais antigo: #${getOrderNumber(oldestOrder)}` : 'Sem pedidos no momento'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setPrefs((prev) => ({ ...prev, showBatch: !prev.showBatch }))}
              className={`h-9 px-3 rounded-lg border text-xs font-black transition-colors ${
                prefs.showBatch
                  ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                  : 'bg-gray-900 border-gray-700 text-gray-400'
              }`}
              title="Mostrar ou ocultar produção em lote"
            >
              <i className="fas fa-layer-group mr-1.5" aria-hidden="true"></i>
              Lote
            </button>
            <button
              type="button"
              onClick={() => setPrefs((prev) => ({ ...prev, kitchenOnly: !prev.kitchenOnly }))}
              className={`h-9 px-3 rounded-lg border text-xs font-black transition-colors ${
                prefs.kitchenOnly
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-gray-900 border-gray-700 text-gray-400'
              }`}
              title="Modo somente cozinha: oculta informações comerciais"
            >
              <i className="fas fa-utensils mr-1.5" aria-hidden="true"></i>
              Somente cozinha
            </button>
            <button
              type="button"
              onClick={() => setPrefs((prev) => ({ ...prev, largeText: !prev.largeText }))}
              className={`h-9 px-3 rounded-lg border text-xs font-black transition-colors ${
                prefs.largeText
                  ? 'bg-blue-500/20 border-blue-400 text-blue-200'
                  : 'bg-gray-900 border-gray-700 text-gray-400'
              }`}
              title="Aumenta o texto dos cards para leitura à distância"
              aria-pressed={prefs.largeText}
            >
              <i className="fas fa-text-height mr-1.5" aria-hidden="true"></i>
              Fonte Grande
            </button>
            <span className="hidden sm:inline-flex items-center gap-2 text-gray-400 text-sm">
              <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
              {new Date(now).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-sm font-black bg-orange-500 px-3 py-1.5 rounded-full text-white">
              {pendingCount} em preparo
            </span>
            <span className="text-sm font-black bg-gray-800 px-3 py-1.5 rounded-full text-gray-200">
              {readyCount}/{totalItems} itens
            </span>
          </div>
        </div>

        {prefs.showBatch && batchProducts.length > 0 && (
          <div className="border-t border-gray-800 px-6 py-3 bg-black/20">
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-400 shrink-0">
                Produção em lote
              </span>
              {batchProducts.slice(0, 12).map((product) => (
                <div
                  key={product.name}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 shrink-0"
                >
                  <span className="text-lg font-black text-orange-300 tabular-nums">
                    {product.quantity}x
                  </span>
                  <span className="text-sm font-bold text-white max-w-[180px] truncate">
                    {product.name}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    #{product.orders.slice(0, 4).join(' #')}
                  </span>
                  {product.observations > 0 && (
                    <span className="text-[10px] font-black text-yellow-300 bg-yellow-950/70 border border-yellow-500/30 px-1.5 py-0.5 rounded">
                      obs {product.observations}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 p-5 overflow-y-auto">
        {sortedOrders.length === 0 ? (
          <div className="h-full min-h-[60vh] flex flex-col items-center justify-center gap-4 opacity-30">
            <i className="fas fa-fire text-6xl text-orange-400" aria-hidden="true"></i>
            <p className="text-xl font-medium">Aguardando pedidos...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(TYPE_CONFIG).map(([type, config]) => {
              const typeOrders = ordersByType[type]
              if (!typeOrders.length) return null

              return (
                <section key={type} className={`border-l-4 pl-4 ${config.section}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-black ${config.badge}`}>
                      <i className={`fas ${config.icon}`} aria-hidden="true"></i>
                      {config.label}
                    </span>
                    <span className="text-xs font-bold text-gray-500">
                      {typeOrders.length} pedido{typeOrders.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  <div
                    className={`grid gap-4 grid-cols-1 md:grid-cols-2 ${
                      prefs.largeText ? 'xl:grid-cols-2 2xl:grid-cols-3' : 'xl:grid-cols-3 2xl:grid-cols-4'
                    }`}
                  >
                    {typeOrders.map((pedido) => (
                      <KitchenOrderCard
                        key={pedido._id}
                        pedido={pedido}
                        now={now}
                        typeConfig={config}
                        kitchenOnly={prefs.kitchenOnly}
                        largeText={prefs.largeText}
                        readyItems={readyItems}
                        onToggleReady={toggleReady}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function KitchenOrderCard({ pedido, now, typeConfig, kitchenOnly, largeText, readyItems, onToggleReady }) {
  const mins = Math.floor((now - new Date(pedido.createdAt)) / 60000)
  const isUrgent = mins >= 30
  const isWarning = mins >= 20 && mins < 30
  const isRecent = mins < 10
  const items = pedido.itens || []
  const readyCount = items.filter((_, idx) => readyItems[getItemKey(pedido, idx)]).length
  const allReady = items.length > 0 && readyCount === items.length

  const cardStyle = allReady
    ? 'bg-emerald-950/40 border-emerald-500/70 shadow-emerald-500/10'
    : isUrgent
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
    <article className={`rounded-2xl p-4 border-2 flex flex-col gap-4 transition-all duration-200 ${cardStyle}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-black tracking-tight ${largeText ? 'text-4xl' : 'text-2xl'}`}>
              #{getOrderNumber(pedido)}
            </span>
            {allReady && (
              <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-500 text-emerald-950 px-2 py-1 rounded-full">
                pronto
              </span>
            )}
            {isUrgent && !allReady && (
              <span className="text-[10px] font-black uppercase tracking-widest bg-red-500 text-white px-2 py-1 rounded-full">
                urgente
              </span>
            )}
            {isWarning && !isUrgent && !allReady && (
              <span className="text-[10px] font-black uppercase tracking-widest bg-yellow-500 text-yellow-950 px-2 py-1 rounded-full">
                atenção
              </span>
            )}
          </div>
          <p className={`text-gray-400 mt-1 truncate ${largeText ? 'text-base' : 'text-sm'}`}>
            {kitchenOnly ? formatTime(pedido.createdAt) : `${pedido.cliente?.nome || 'Consumidor'} · ${formatTime(pedido.createdAt)}`}
          </p>
        </div>

        <span
          className={`font-black rounded-xl tabular-nums text-center ${timeBadgeStyle} ${
            largeText ? 'text-2xl px-4 py-2 min-w-[72px]' : 'text-lg px-3 py-1.5 min-w-[58px]'
          }`}
        >
          {mins}m
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`font-bold px-2.5 py-1 rounded-full border ${typeConfig.badge} ${largeText ? 'text-sm' : 'text-xs'}`}>
          <i className={`fas ${typeConfig.icon} mr-1`} aria-hidden="true"></i>
          {typeConfig.label || getTipoPedidoLabel(pedido.tipo)}
        </span>
        <span className={`text-gray-400 ${largeText ? 'text-sm' : 'text-xs'}`}>
          {readyCount}/{items.length} item(ns) prontos
        </span>
      </div>

      <div className="space-y-3 border-t border-gray-800 pt-3">
        {items.map((item, idx) => {
          const itemReady = !!readyItems[getItemKey(pedido, idx)]
          const obs = getItemObs(item)

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onToggleReady(pedido, idx)}
              className={`w-full text-left rounded-xl border px-3 py-3 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400/60 ${
                itemReady
                  ? 'bg-emerald-950/30 border-emerald-500/40 opacity-70'
                  : 'bg-black/20 border-white/5 hover:border-emerald-400/40'
              }`}
              title="Clique ou pressione Enter para marcar este item como pronto"
            >
              {obs && (
                <div className={`mb-2 text-yellow-200 bg-yellow-950/80 border border-yellow-400/30 px-3 py-2 rounded-lg font-bold ${largeText ? 'text-lg' : 'text-sm'}`}>
                  <i className="fas fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>
                  {obs}
                </div>
              )}

              <div className="flex gap-3 items-start">
                <span
                  className={`font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-lg text-center ${
                    largeText ? 'text-xl min-w-[52px] px-2.5 py-1.5' : 'text-sm min-w-[38px] px-2 py-1'
                  }`}
                >
                  {item.quantidade}x
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-bold leading-tight break-words ${itemReady ? 'line-through text-gray-400' : 'text-white'} ${largeText ? 'text-xl' : 'text-sm'}`}>
                      {cleanName(item.nome)}
                    </p>
                    <span className={`shrink-0 font-black px-2 py-1 rounded-full ${itemReady ? 'bg-emerald-500 text-emerald-950' : 'bg-gray-800 text-gray-400'} ${largeText ? 'text-xs' : 'text-[10px]'}`}>
                      {itemReady ? 'pronto' : 'marcar pronto'}
                    </span>
                  </div>

                  {item.complementos?.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {item.quantidade > 1 && (
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                          cada unidade:
                        </p>
                      )}
                      <p className={`${itemReady ? 'text-gray-500 line-through' : 'text-gray-400'} ${largeText ? 'text-base' : 'text-sm'}`}>
                        + {item.complementos.join(', ')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </article>
  )
}
