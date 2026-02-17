import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import electronAPI from '@utils/electronBridge'
import { useOrderClustering } from '@hooks/useOrderClustering'

// --- Utilitários de Formatação ---
const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)

const formatTime = (dateStr) => {
  if (!dateStr) return '--:--'
  const date = new Date(dateStr)
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

// Tempo decorrido desde criação
const getTimeElapsed = (dateStr) => {
  if (!dateStr) return { minutes: 0, isUrgent: false }
  const now = new Date()
  const created = new Date(dateStr)
  const minutes = Math.floor((now - created) / 60000)
  return { minutes, isUrgent: minutes > 30 }
}

// Fuzzy search simples
const fuzzyMatch = (text, query) => {
  if (!query) return true
  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()
  let queryIndex = 0
  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) queryIndex++
  }
  return queryIndex === queryLower.length
}

// --- Gerador de Cupom Fiscal (80mm/58mm Otimizado) ---
const renderPedidoToHTML = (pedido) => {
  const itensHtml = pedido.itens.map(item => {
    const totalItem = item.precoUnitario * item.quantidade
    const complementosHtml = item.complementos?.length 
      ? `<div class="complementos">+ ${item.complementos.join('<br/>+ ')}</div>` 
      : ''
    const obsHtml = item.obs 
      ? `<div class="obs"><strong>OBS:</strong> ${item.obs}</div>` 
      : ''

    return `
      <div class="item-row">
        <div class="item-header">
          <span class="qty">${item.quantidade}x</span>
          <span class="name">${item.nome}</span>
        </div>
        ${complementosHtml}
        ${obsHtml}
        <div class="item-price">${formatCurrency(totalItem)}</div>
      </div>
    `
  }).join('')

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { margin: 0; padding: 0; }
          body { font-family: 'Roboto', sans-serif; width: 300px; margin: 0; padding: 10px; color: #000; font-size: 12px; line-height: 1.3; }
          .text-center { text-align: center; }
          .title { font-size: 16px; font-weight: 900; margin-bottom: 5px; text-transform: uppercase; }
          .subtitle { font-size: 12px; margin-bottom: 10px; border-bottom: 2px dashed #000; padding-bottom: 10px; }
          .info-group { margin-bottom: 8px; }
          .info-label { font-size: 10px; text-transform: uppercase; font-weight: bold; }
          .divider-bold { border-top: 2px solid #000; margin: 10px 0; }
          .divider { border-top: 1px dashed #000; margin: 10px 0; }
          .item-row { margin-bottom: 8px; }
          .item-header { display: flex; align-items: flex-start; }
          .qty { font-weight: 900; margin-right: 5px; font-size: 14px; min-width: 20px; }
          .name { font-weight: 700; flex: 1; font-size: 13px; }
          .complementos { margin-left: 25px; font-size: 11px; color: #333; }
          .obs { margin-left: 25px; margin-top: 2px; font-weight: bold; background: #eee; padding: 2px; display: inline-block; }
          .item-price { text-align: right; font-weight: bold; }
          .totals-row { display: flex; justify-between: space-between; margin-bottom: 2px; }
          .total-big { font-size: 18px; font-weight: 900; margin-top: 5px; }
          .payment-box { border: 2px solid #000; padding: 5px; margin-top: 10px; text-align: center; font-weight: bold; font-size: 14px; }
          .footer { margin-top: 15px; text-align: center; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">NexFood Delivery</div>
          <div class="subtitle">
            ${formatDate(pedido.createdAt)} - ${formatTime(pedido.createdAt)}<br/>
            PEDIDO #${pedido._id.slice(-4).toUpperCase()}
          </div>
        </div>

        <div class="info-group">
          <div class="info-label">Cliente</div>
          <div style="font-weight:bold; font-size: 13px;">${pedido.cliente?.nome || 'Consumidor'}</div> 
          ${pedido.cliente?.telefone ? `<div>Tel: ${pedido.cliente.telefone}</div>` : ''}
          ${pedido.cliente?.totalPedidos > 0 ? `<div style="font-size:10px; margin-top:2px;">★ Cliente fiel (${pedido.cliente.totalPedidos}º pedido)</div>` : ''}
        </div>

        ${pedido.tipo === 'Delivery' && pedido.enderecoEntrega ? `
          <div class="info-group">
            <div class="info-label">Entrega</div>
            <div style="font-size: 13px; font-weight: bold;">
              ${pedido.enderecoEntrega.rua}, ${pedido.enderecoEntrega.numero}
            </div>
            <div>${pedido.enderecoEntrega.bairro} - ${pedido.enderecoEntrega.cidade}</div>
            ${pedido.enderecoEntrega.complemento ? `<div>Comp: ${pedido.enderecoEntrega.complemento}</div>` : ''}
          </div>
        ` : `<div class="payment-box">RETIRADA NO BALCÃO</div>`}

        <div class="divider-bold"></div>
        ${itensHtml}
        <div class="divider-bold"></div>

        <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(pedido.subtotal)}</span></div>
        ${pedido.desconto > 0 ? `<div class="totals-row"><span>Desconto</span><span>- ${formatCurrency(pedido.desconto)}</span></div>` : ''}
        <div class="totals-row total-big"><span>TOTAL</span><span>${formatCurrency(pedido.total)}</span></div>

        <div class="divider"></div>
        <div class="info-label">Pagamento</div>
        <div style="font-weight:bold; text-transform:uppercase;">${pedido.formaPagamento?.replace(/_/g, ' ')}</div>
        ${pedido.trocoPara ? `<div>Troco para: ${formatCurrency(pedido.trocoPara)}</div>` : ''}

        <div class="footer">NEXFOOD - Tecnologia para Delivery<br/>NEX07 • CNPJ 63.805.056/0001-33</div>
      </body>
    </html>
  `
}

export default function OrderManager() {

  const [pedidosPendentes, setPedidosPendentes] = useState([])
  const [pedidosRecusados, setPedidosRecusados] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [printers, setPrinters] = useState([])
  const [loadingOrderId, setLoadingOrderId] = useState(null)
  const [isFullScreen, setIsFullScreen] = useState(false)
  
  // --- NOVOS ESTADOS PARA BUSCA E FILTROS ---
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({
    tipo: 'todos', // todos, Delivery, Balcão
    pagamento: 'todos', // todos, pix, dinheiro, cartao, etc
    valorMin: '',
    valorMax: '',
    apenasAgrupados: false,
    apenasUrgentes: false, // pedidos com >30min
    apenasRecorrentes: false, // clientes com 2+ pedidos
  })
  const [showFilters, setShowFilters] = useState(false)
  
  const processedOrderIds = useRef(new Set())
  const navigate = useNavigate()

  const [settings, setSettings] = useState({
    impressoraAutomatica: localStorage.getItem('impressoraAutomatica') || '',
    aceitarAutomatico: localStorage.getItem('aceitarAutomatico') !== 'false',
    notificacoesPush: localStorage.getItem('notificacoesPush') === 'true',
    somNotificacao: localStorage.getItem('somNotificacao') !== 'false',
    tempoRefresh: Math.max(10, Math.min(30, parseInt(localStorage.getItem('tempoRefresh')) || 10)),
    agruparPorDistancia: localStorage.getItem('agruparPorDistancia') === 'true',
    raioCluster: parseFloat(localStorage.getItem('raioCluster')) || 2,
  })

  // --- Monitorar estado de tela cheia ---
  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement)
    }
    
    document.addEventListener('fullscreenchange', handleFullScreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange)
  }, [])

  // --- Carregar Impressoras ---
  useEffect(() => {
    const loadPrinters = async () => {
      if (!electronAPI?.isElectron?.()) return
      const res = await electronAPI.getPrinters()
      if (res?.success && Array.isArray(res.printers)) {
        setPrinters(res.printers)
        if (res.printers.length > 0 && !settings.impressoraAutomatica) {
          saveSettings({ ...settings, impressoraAutomatica: res.printers[0].name })
        }
      }
    }
    loadPrinters()
  }, [])

  const saveSettings = (newSettings) => {
    Object.keys(newSettings).forEach(key => {
      const value = newSettings[key]
      localStorage.setItem(key, value === null || value === undefined ? '' : String(value))
    })
    setSettings(newSettings)
  }

  const playNotificationSound = () => {
    if (!settings.somNotificacao) return
    const audio = new Audio('https://nexfood.vercel.app/sounds/notification.mp3')
    audio.play().catch(e => console.error('Erro áudio:', e))
  }

  const sendPushNotification = (title, body) => {
    if (!settings.notificacoesPush) return

    if (electronAPI?.isElectron?.()) {
      electronAPI.sendNotification(title, body)
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/logo.png' })
    }
  }

  const handlePrint = async (pedido) => {
    const html = renderPedidoToHTML(pedido)
    if (electronAPI?.isElectron?.() && settings.impressoraAutomatica) {
      await electronAPI.printOrder(settings.impressoraAutomatica, html)
    } else {
      const w = window.open('', '_blank', 'width=350,height=600')
      w.document.write(html)
      w.document.close()
      setTimeout(() => w.print(), 500)
    }
  }

  const apiUpdateStatus = async (id, status) => {
    const token = localStorage.getItem('nexfood_token')
    await fetch(`https://nexfood.vercel.app/api/pedidos/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ status })
    })
  }

  const fetchPedidos = useCallback(async () => {
    try {
      const token = localStorage.getItem('nexfood_token') || sessionStorage.getItem('nexfood_token')
      if (!token) return navigate('/login')

      const res = await fetch('https://nexfood.vercel.app/api/pedidos/dia', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 401) return navigate('/login')
      const data = await res.json()
      
      const sorted = Array.isArray(data) ? data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : []
      
      const pedidosConfirmados = []
      const aguardandoPagamento = []
      const pagamentosRecusados = []

      sorted.forEach(p => {
        const isPixOnline = p.formaPagamento?.includes('pix') || p.formaPagamento === 'online_pix'
        const isPendente = p.statusPagamento === 'pendente'
        const isRecusado = p.statusPagamento === 'recusado'

        if (isPixOnline && isPendente) {
          aguardandoPagamento.push(p)
        } else if (isPixOnline && isRecusado) {
          pagamentosRecusados.push(p)
        } else {
          pedidosConfirmados.push(p)
        }
      })
      
      setPedidosPendentes(aguardandoPagamento)
      setPedidosRecusados(pagamentosRecusados)

      if (settings.aceitarAutomatico) {
        const novos = pedidosConfirmados.filter(p => p.status === 'Recebido')
        
        for (const pedido of novos) {
          if (processedOrderIds.current.has(pedido._id)) continue

          console.log('Aceitando automático:', pedido._id)
          processedOrderIds.current.add(pedido._id)
          
          playNotificationSound()
          sendPushNotification('Novo Pedido Aceito!', `Pedido #${pedido._id.slice(-4)} enviado para cozinha.`)
          
          await apiUpdateStatus(pedido._id, 'Em preparação')
          if (settings.impressoraAutomatica) handlePrint(pedido)
          
          pedido.status = 'Em preparação' 
        }
      } else {
        const novosPendentes = pedidosConfirmados.filter(p => p.status === 'Recebido' && !processedOrderIds.current.has(p._id))
        if (novosPendentes.length > 0) {
          novosPendentes.forEach(p => processedOrderIds.current.add(p._id))
          playNotificationSound()
          sendPushNotification('Novo Pedido!', 'Você tem novos pedidos aprovados.')
        }
      }

      setPedidos(pedidosConfirmados)
    } catch (error) {
      console.error('Erro fetch:', error)
    } finally {
      setLoading(false)
    }
  }, [settings.aceitarAutomatico, settings.impressoraAutomatica])

  useEffect(() => {
    fetchPedidos()
    const interval = setInterval(fetchPedidos, settings.tempoRefresh * 1000)
    return () => clearInterval(interval)
  }, [fetchPedidos, settings.tempoRefresh])

  const advanceStatus = async (pedido) => {
    let nextStatus = ''
    if (pedido.status === 'Recebido') nextStatus = 'Em preparação'
    else if (pedido.status === 'Em preparação') nextStatus = 'Saiu para entrega'
    else if (pedido.status === 'Saiu para entrega') nextStatus = 'Entregue'

    if (!nextStatus) return

    setLoadingOrderId(pedido._id)

    try {
      await apiUpdateStatus(pedido._id, nextStatus)
      if (nextStatus === 'Em preparação' && settings.impressoraAutomatica) {
        handlePrint(pedido)
      }
      await fetchPedidos()
    } catch (err) {
      console.error('Erro ao avançar status', err)
    } finally {
      setLoadingOrderId(null)
    }
  }

  const handleToggleNotification = () => {
    const newState = !settings.notificacoesPush
    saveSettings({ ...settings, notificacoesPush: newState })
    
    if (newState) {
      if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission().then(permission => {
            if(permission === 'granted') sendPushNotification('Notificações Ativadas', 'Tudo pronto para receber pedidos!')
        })
      } else {
        sendPushNotification('Notificações Ativadas', 'Tudo pronto para receber pedidos!')
      }
    }
  }

  const activeOrders = useMemo(() => 
    pedidos.filter(p => p.status !== 'Entregue' && p.status !== 'Cancelado' && p.status !== 'Saiu para entrega'), 
  [pedidos])

  const finishedOrders = useMemo(() => 
    pedidos.filter(p => ['Saiu para entrega', 'Entregue', 'Cancelado'].includes(p.status)), 
  [pedidos])

  // Aplica o hook APENAS nos pedidos ativos (não entregues)
  const clusteredActive = useOrderClustering(activeOrders, settings.agruparPorDistancia, settings.raioCluster)

  // Recombina tudo para a interface continuar funcionando igual
  const pedidosComClusters = useMemo(() => 
    [...clusteredActive, ...finishedOrders], 
  [clusteredActive, finishedOrders])

  // --- BUSCA E FILTROS INTELIGENTES ---
  const pedidosFiltrados = useMemo(() => {
    let resultado = pedidosComClusters

    // Busca fuzzy
    if (searchQuery.trim()) {
      const query = searchQuery.trim()
      resultado = resultado.filter(p => {
        const searchText = [
          p._id.slice(-4).toUpperCase(),
          p.cliente?.nome || '',
          p.cliente?.telefone || '',
          p.enderecoEntrega?.rua || '',
          p.enderecoEntrega?.bairro || '',
          ...p.itens.map(i => i.nome)
        ].join(' ')
        
        return fuzzyMatch(searchText, query)
      })
    }

    // Filtro por tipo
    if (filters.tipo !== 'todos') {
      resultado = resultado.filter(p => p.tipo === filters.tipo)
    }

    // Filtro por pagamento
    if (filters.pagamento !== 'todos') {
      resultado = resultado.filter(p => p.formaPagamento?.includes(filters.pagamento))
    }

    // Filtro por valor
    if (filters.valorMin) {
      resultado = resultado.filter(p => p.total >= parseFloat(filters.valorMin))
    }
    if (filters.valorMax) {
      resultado = resultado.filter(p => p.total <= parseFloat(filters.valorMax))
    }

    // Apenas agrupados
    if (filters.apenasAgrupados) {
      resultado = resultado.filter(p => p.clusterId && p.clusterSize > 1)
    }

    // Apenas urgentes
    if (filters.apenasUrgentes) {
      resultado = resultado.filter(p => {
        const { isUrgent } = getTimeElapsed(p.createdAt)
        return isUrgent
      })
    }

    // Apenas recorrentes
    if (filters.apenasRecorrentes) {
      resultado = resultado.filter(p => p.cliente?.totalPedidos >= 2)
    }

    return resultado
  }, [pedidosComClusters, searchQuery, filters])

  const columns = useMemo(() => ({
    pendente: pedidosFiltrados.filter(p => !p.status || p.status === 'Recebido'),
    preparo: pedidosFiltrados.filter(p => p.status === 'Em preparação'),
    entrega: pedidosFiltrados.filter(p => ['Saiu para entrega', 'Saiu para Entrega'].includes(p.status)),
    concluido: pedidosFiltrados.filter(p => p.status === 'Entregue'),
  }), [pedidosFiltrados])

  const totalDia = columns.concluido.reduce((acc, curr) => acc + (curr.total || 0), 0)

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.log(err))
    } else {
      document.exitFullscreen()
    }
  }

  // Limpar filtros
  const clearFilters = () => {
    setSearchQuery('')
    setFilters({
      tipo: 'todos',
      pagamento: 'todos',
      valorMin: '',
      valorMax: '',
      apenasAgrupados: false,
      apenasUrgentes: false,
      apenasRecorrentes: false,
    })
  }

  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (searchQuery.trim()) count++
    if (filters.tipo !== 'todos') count++
    if (filters.pagamento !== 'todos') count++
    if (filters.valorMin || filters.valorMax) count++
    if (filters.apenasAgrupados) count++
    if (filters.apenasUrgentes) count++
    if (filters.apenasRecorrentes) count++
    return count
  }, [searchQuery, filters])

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      
      {/* Header Melhorado */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="w-full px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#7f22fe] flex items-center justify-center shadow-sm">
              <i className="fas fa-bolt text-white text-lg"></i>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">Gestor de Pedidos</h1>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                <span className="text-gray-500 font-medium">Loja Aberta</span>
              </div>
            </div>
          </div>

          {/* BARRA DE BUSCA */}
          <div className="flex-1 max-w-md hidden lg:block">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por ID, cliente, telefone, endereço..."
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:outline-none focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 transition-all"
                aria-label="Buscar pedidos"
              />
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Limpar busca"
                >
                  <i className="fas fa-times text-sm"></i>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Badge de Filtros Ativos */}
            {activeFiltersCount > 0 && (
              <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-[#7f22fe]/10 border border-[#7f22fe]/30 rounded-lg">
                <i className="fas fa-filter text-[#7f22fe] text-sm"></i>
                <span className="text-xs font-bold text-[#7f22fe]">{activeFiltersCount} filtro{activeFiltersCount > 1 ? 's' : ''}</span>
                <button
                  onClick={clearFilters}
                  className="ml-1 text-[#7f22fe] hover:text-[#6b1de0]"
                  aria-label="Limpar filtros"
                >
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>
            )}

            {/* Alerta PIX Recusado */}
            {pedidosRecusados.length > 0 && (
              <button
                onClick={() => setSelectedOrder(pedidosRecusados[0])}
                className="hidden md:flex items-center gap-2 px-3 py-2 bg-red-50 border-2 border-red-300 rounded-lg text-red-700 hover:bg-red-100 transition-colors animate-pulse"
                aria-label={`${pedidosRecusados.length} pagamento${pedidosRecusados.length > 1 ? 's' : ''} recusado${pedidosRecusados.length > 1 ? 's' : ''}`}
              >
                <i className="fas fa-exclamation-triangle"></i>
                <span className="text-xs font-bold">{pedidosRecusados.length} Pix Recusado</span>
              </button>
            )}

            {/* Alerta PIX Pendente */}
            {pedidosPendentes.length > 0 && (
              <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
                <i className="fas fa-clock"></i>
                <span className="text-xs font-bold">{pedidosPendentes.length} Pix Pendente</span>
              </div>
            )}

            <div className="hidden lg:flex flex-col items-end px-4 border-r border-gray-200 mr-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Faturamento (Entregues)</span>
              <span className="text-xl font-bold text-emerald-600">{formatCurrency(totalDia)}</span>
            </div>
            
            {/* Botão de Filtros */}
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={`w-10 h-10 rounded-lg transition-all border ${
                showFilters || activeFiltersCount > 0
                  ? 'bg-[#7f22fe] text-white border-[#7f22fe] shadow-md' 
                  : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600'
              }`}
              aria-label="Filtros avançados"
              aria-expanded={showFilters}
            >
              <i className="fas fa-sliders-h text-sm"></i>
            </button>

            <button 
              onClick={toggleFullScreen}
              className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 transition-colors"
              title={isFullScreen ? "Sair da Tela Cheia" : "Tela Cheia"}
              aria-label={isFullScreen ? "Sair da tela cheia" : "Ativar tela cheia"}
            >
              <i className={`fas ${isFullScreen ? 'fa-compress' : 'fa-expand'} text-sm`}></i>
            </button>

            <button 
              onClick={fetchPedidos} 
              className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 transition-colors active:scale-95"
              title="Atualizar"
              aria-label="Atualizar pedidos"
            >
              <i className="fas fa-sync-alt text-sm"></i>
            </button>

            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`w-10 h-10 rounded-lg transition-all active:scale-95 border ${
                showSettings 
                  ? 'bg-[#7f22fe] text-white border-[#7f22fe] shadow-md' 
                  : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600'
              }`}
              aria-label="Configurações"
              aria-expanded={showSettings}
            >
              <i className="fas fa-cog text-sm"></i>
            </button>
          </div>
        </div>

        {/* Busca Mobile */}
        <div className="lg:hidden px-4 pb-3">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar pedidos..."
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:outline-none focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20"
              aria-label="Buscar pedidos"
            />
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-label="Limpar busca"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-81px)] lg:h-[calc(100vh-81px)]">
        {/* Kanban Board */}
        <main className={`flex-1 p-6 overflow-x-auto overflow-y-hidden transition-all duration-300 bg-gray-50 ${showSettings || showFilters ? 'mr-96' : ''}`}>
          
          <div className={`grid gap-4 h-full min-w-[1000px] lg:min-w-0 transition-all ${
            settings.aceitarAutomatico 
              ? 'grid-cols-1 md:grid-cols-3'
              : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
          }`}>
            
            {!settings.aceitarAutomatico && (
              <KanbanColumn title="Novos Pedidos" count={columns.pendente.length} color="purple" icon="bell">
                {columns.pendente.map(p => (
                  <OrderCard 
                    key={p._id} 
                    pedido={p} 
                    onClick={() => setSelectedOrder(p)} 
                    onAdvance={() => advanceStatus(p)} 
                    onPrint={() => handlePrint(p)}
                    color="purple"
                    isLoading={loadingOrderId === p._id}
                    searchQuery={searchQuery}
                  />
                ))}
              </KanbanColumn>
            )}

            <KanbanColumn title="Em Preparação" count={columns.preparo.length} color="orange" icon="fire">
              {columns.preparo.map(p => (
                <OrderCard 
                  key={p._id} 
                  pedido={p} 
                  onClick={() => setSelectedOrder(p)} 
                  onAdvance={() => advanceStatus(p)} 
                  onPrint={() => handlePrint(p)}
                  color="orange"
                  isLoading={loadingOrderId === p._id}
                  searchQuery={searchQuery}
                />
              ))}
            </KanbanColumn>

            <KanbanColumn title="Em Entrega" count={columns.entrega.length} color="blue" icon="shipping-fast">
              {columns.entrega.map(p => (
                <OrderCard 
                  key={p._id} 
                  pedido={p} 
                  onClick={() => setSelectedOrder(p)} 
                  onAdvance={() => advanceStatus(p)}
                  onPrint={() => handlePrint(p)}
                  color="blue"
                  isLoading={loadingOrderId === p._id}
                  searchQuery={searchQuery}
                />
              ))}
            </KanbanColumn>

            <KanbanColumn title="Finalizados" count={columns.concluido.length} color="emerald" icon="check-circle">
              {columns.concluido.map(p => (
                <OrderCard 
                  key={p._id} 
                  pedido={p} 
                  onClick={() => setSelectedOrder(p)}
                  onPrint={() => handlePrint(p)}
                  isDone 
                  color="emerald"
                  searchQuery={searchQuery}
                />
              ))}
            </KanbanColumn>

          </div>
        </main>

        {/* Sidebar Filtros */}
        <aside 
          className={`fixed top-[81px] lg:top-[81px] right-0 h-[calc(100vh-81px)] lg:h-[calc(100vh-81px)] w-96 bg-white border-l border-gray-200 shadow-xl transition-all duration-300 z-40 overflow-y-auto ${
            showFilters && !showSettings ? 'translate-x-0' : 'translate-x-full'
          }`}
          aria-hidden={!showFilters}
        >
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <i className="fas fa-sliders-h text-[#7f22fe]"></i>
                Filtros Avançados
              </h3>
              {activeFiltersCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-red-600 hover:text-red-700 font-bold"
                  aria-label="Limpar todos os filtros"
                >
                  Limpar Tudo
                </button>
              )}
            </div>

            {/* Tipo de Pedido */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                Tipo de Pedido
              </label>
              <select
                value={filters.tipo}
                onChange={(e) => setFilters({...filters, tipo: e.target.value})}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                aria-label="Filtrar por tipo de pedido"
              >
                <option value="todos">Todos os tipos</option>
                <option value="Delivery">Delivery</option>
                <option value="Balcão">Balcão</option>
              </select>
            </div>

            {/* Forma de Pagamento */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                Forma de Pagamento
              </label>
              <select
                value={filters.pagamento}
                onChange={(e) => setFilters({...filters, pagamento: e.target.value})}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                aria-label="Filtrar por forma de pagamento"
              >
                <option value="todos">Todas as formas</option>
                <option value="pix">PIX</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="cartao">Cartão</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
              </select>
            </div>

            {/* Faixa de Valor */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                Faixa de Valor
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  placeholder="Min R$"
                  value={filters.valorMin}
                  onChange={(e) => setFilters({...filters, valorMin: e.target.value})}
                  className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                  aria-label="Valor mínimo"
                />
                <input
                  type="number"
                  placeholder="Máx R$"
                  value={filters.valorMax}
                  onChange={(e) => setFilters({...filters, valorMax: e.target.value})}
                  className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                  aria-label="Valor máximo"
                />
              </div>
            </div>

            {/* Filtros Booleanos */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              <FilterCheckbox
                checked={filters.apenasAgrupados}
                onChange={(val) => setFilters({...filters, apenasAgrupados: val})}
                label="Apenas Pedidos Agrupados"
                icon="route"
                description="Mostrar só pedidos próximos entre si"
              />

              <FilterCheckbox
                checked={filters.apenasUrgentes}
                onChange={(val) => setFilters({...filters, apenasUrgentes: val})}
                label="Apenas Pedidos Urgentes"
                icon="clock"
                description="Pedidos com mais de 30 minutos"
              />

              <FilterCheckbox
                checked={filters.apenasRecorrentes}
                onChange={(val) => setFilters({...filters, apenasRecorrentes: val})}
                label="Apenas Clientes Recorrentes"
                icon="star"
                description="Clientes com 2+ pedidos"
              />
            </div>

            {/* Estatísticas de Filtros */}
            <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
              <p className="text-xs font-bold text-gray-700 mb-2">Resultados:</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total:</span>
                  <span className="font-bold">{pedidosFiltrados.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Original:</span>
                  <span className="font-bold text-gray-400">{pedidosComClusters.length}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Sidebar Configurações */}
        <aside 
          className={`fixed top-[81px] lg:top-[81px] right-0 h-[calc(100vh-81px)] lg:h-[calc(100vh-81px)] w-96 bg-white border-l border-gray-200 shadow-xl transition-all duration-300 z-40 overflow-y-auto ${
            showSettings && !showFilters ? 'translate-x-0' : 'translate-x-full'
          }`}
          aria-hidden={!showSettings}
        >
          <div className="p-6 space-y-8">
            
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <i className="fas fa-print"></i> Impressão
              </h3>
              <div className="space-y-3">
                <select
                  value={settings.impressoraAutomatica}
                  onChange={(e) => saveSettings({...settings, impressoraAutomatica: e.target.value})}
                  className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-300 text-gray-900 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none transition-all"
                  aria-label="Selecionar impressora"
                >
                  <option value="">Manual (Sem impressão auto)</option>
                  {printers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                
                <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200 hover:border-gray-300 transition-colors">
                  <span className="text-sm text-gray-900 font-medium">Aceitar Automaticamente</span>
                  <Switch 
                    checked={settings.aceitarAutomatico} 
                    onChange={() => saveSettings({...settings, aceitarAutomatico: !settings.aceitarAutomatico})} 
                    ariaLabel="Aceitar pedidos automaticamente"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <i className="fas fa-sliders-h"></i> Sistema
              </h3>
              
              <div className="space-y-4">
                <div className="p-5 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="flex justify-between mb-3">
                    <span className="text-sm font-semibold text-gray-900">Atualização Automática</span>
                    <span className="text-xs font-bold text-[#7f22fe] bg-purple-50 px-3 py-1 rounded-full border border-purple-200">
                      {settings.tempoRefresh}s
                    </span>
                  </div>
                  <input 
                    type="range" min="10" max="30" step="10" 
                    value={settings.tempoRefresh} 
                    onChange={(e) => saveSettings({...settings, tempoRefresh: parseInt(e.target.value)})}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-purple"
                    aria-label="Tempo de atualização automática"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500 mt-2 font-medium">
                    <span>10s Rápido</span>
                    <span>30s Lento</span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200 hover:border-gray-300 transition-colors">
                  <div className="flex flex-col">
                    <span className="text-sm text-gray-900 font-medium">Notificações Push</span>
                    <span className="text-[10px] text-gray-500">Teste ao ativar</span>
                  </div>
                  <Switch 
                    checked={settings.notificacoesPush} 
                    onChange={handleToggleNotification} 
                    ariaLabel="Ativar notificações push"
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200 hover:border-gray-300 transition-colors">
                  <span className="text-sm text-gray-900 font-medium">Efeito Sonoro</span>
                  <Switch 
                    checked={settings.somNotificacao} 
                    onChange={() => saveSettings({...settings, somNotificacao: !settings.somNotificacao})} 
                    ariaLabel="Ativar efeito sonoro"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <i className="fas fa-route"></i> Otimização de Entregas
              </h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200 hover:border-blue-300 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm text-gray-900 font-bold">Agrupar por Distância</span>
                      <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">BETA</span>
                    </div>
                    <p className="text-[10px] text-gray-600 leading-relaxed">
                      Destaca pedidos próximos para otimizar rotas
                    </p>
                  </div>
                  <Switch 
                    checked={settings.agruparPorDistancia} 
                    onChange={() => saveSettings({...settings, agruparPorDistancia: !settings.agruparPorDistancia})} 
                    ariaLabel="Ativar agrupamento por distância"
                  />
                </div>

                {settings.agruparPorDistancia && (
                  <>
                    <div className="p-5 rounded-lg bg-white border-2 border-blue-200">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <span className="text-sm font-bold text-gray-900 block">Raio de Proximidade</span>
                          <span className="text-[10px] text-gray-500">Até quantos km considera próximo?</span>
                        </div>
                        <span className="text-lg font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-lg border-2 border-blue-300">
                          {settings.raioCluster}km
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="0.5" 
                        max="10" 
                        step="0.5" 
                        value={settings.raioCluster} 
                        onChange={(e) => saveSettings({...settings, raioCluster: parseFloat(e.target.value)})}
                        className="w-full h-2 bg-gradient-to-r from-blue-200 to-blue-400 rounded-lg appearance-none cursor-pointer slider-blue"
                        aria-label="Raio de proximidade em quilômetros"
                      />
                      <div className="flex justify-between text-[10px] text-gray-500 mt-2 font-medium">
                        <span>0.5km Restrito</span>
                        <span>10km Amplo</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="flex items-start gap-3">
                        <i className="fas fa-lightbulb text-blue-500 mt-0.5 text-lg"></i>
                        <div className="text-xs text-blue-900">
                          <p className="font-bold mb-2">Como funciona:</p>
                          <ul className="space-y-1.5 text-[11px] leading-relaxed">
                            <li className="flex items-start gap-2">
                              <i className="fas fa-check text-blue-500 mt-0.5 text-[10px]"></i>
                              <span>Cada grupo recebe uma <strong>cor única</strong></span>
                            </li>
                            <li className="flex items-start gap-2">
                              <i className="fas fa-check text-blue-500 mt-0.5 text-[10px]"></i>
                              <span>Veja a <strong>distância exata</strong> entre pedidos</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <i className="fas fa-check text-blue-500 mt-0.5 text-[10px]"></i>
                              <span>Otimize entregas agrupando rotas</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>

            <div className="pt-6 border-t border-gray-200">
              <div className="p-6 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-center mb-4">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-md">
                    <i className="fas fa-bolt text-2xl text-white"></i>
                  </div>
                  <h4 className="font-bold text-gray-900 text-lg mb-1">NEX<i className='fas fa-bolt'></i>FOOD</h4>
                  <p className="text-xs text-gray-500">by Nadin Garcia</p>
                </div>
                
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between p-2 rounded bg-white border border-gray-100">
                    <span className="text-gray-600">Licença:</span>
                    <span className="text-emerald-600 font-bold">NEX07</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-white border border-gray-100">
                    <span className="text-gray-600">CNPJ:</span>
                    <span className="text-gray-900 font-medium">63.805.056/0001-33</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-white border border-gray-100">
                    <span className="text-gray-600">Pedidos Hoje:</span>
                    <span className="text-gray-900 font-bold">{pedidos.length}</span>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => { 
                  localStorage.removeItem('nexfood_token')
                  localStorage.removeItem('nexfood_user')
                  sessionStorage.removeItem('nexfood_token')
                  sessionStorage.removeItem('nexfood_user')
                  navigate('/login') 
                }} 
                className="mt-6 w-full py-3 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 hover:text-red-700 font-bold transition-all uppercase tracking-wider text-sm"
              >
                <i className="fas fa-sign-out-alt mr-2"></i>
                Encerrar Sessão
              </button>
            </div>

          </div>
        </aside>
      </div>

      {selectedOrder && (
        <OrderModal 
          pedido={selectedOrder} 
          onClose={() => setSelectedOrder(null)} 
          onPrint={() => handlePrint(selectedOrder)}
          onAdvance={() => advanceStatus(selectedOrder)}
          isLoading={loadingOrderId === selectedOrder._id}
        />
      )}
    </div>
  )
}

// --- Componentes ---

function Switch({ checked, onChange, ariaLabel }) {
  return (
    <button 
      onClick={onChange} 
      className={`relative w-12 h-6 rounded-full transition-colors ${
        checked ? 'bg-[#7f22fe]' : 'bg-gray-300'
      }`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
        checked ? 'translate-x-6' : ''
      }`}/>
    </button>
  )
}

function FilterCheckbox({ checked, onChange, label, icon, description }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
        checked 
          ? 'bg-[#7f22fe]/10 border-[#7f22fe]' 
          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
      }`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
    >
      <div className="flex items-start gap-3">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
          checked 
            ? 'bg-[#7f22fe] border-[#7f22fe]' 
            : 'bg-white border-gray-300'
        }`}>
          {checked && <i className="fas fa-check text-white text-xs"></i>}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <i className={`fas fa-${icon} text-sm ${checked ? 'text-[#7f22fe]' : 'text-gray-500'}`}></i>
            <span className={`text-sm font-bold ${checked ? 'text-[#7f22fe]' : 'text-gray-900'}`}>
              {label}
            </span>
          </div>
          <p className="text-xs text-gray-600">{description}</p>
        </div>
      </div>
    </button>
  )
}

function KanbanColumn({ title, count, children, color, icon }) {
  const colorThemes = {
    purple: 'border-[#7f22fe] bg-purple-50',
    orange: 'border-orange-500 bg-orange-50',
    blue: 'border-blue-500 bg-blue-50',
    emerald: 'border-emerald-500 bg-emerald-50',
  }
  
  const textColors = {
    purple: 'text-[#7f22fe]',
    orange: 'text-orange-600',
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
  }
  
  return (
    <div className="flex flex-col h-full rounded-xl bg-gray-100/50 border border-gray-200 overflow-hidden shadow-sm">
      <div className={`px-4 py-3 border-b-2 bg-white flex justify-between items-center ${colorThemes[color].split(' ')[0]}`}>
        <div className={`font-bold flex items-center gap-2 ${textColors[color]}`}>
          <div className={`p-1.5 rounded-md bg-opacity-10 ${colorThemes[color].replace('border-', 'bg-')}`}>
             <i className={`fas fa-${icon}`} aria-hidden="true"></i>
          </div>
          <span className="uppercase tracking-tight text-sm">{title}</span>
        </div>
        <span className="bg-gray-800 px-2.5 py-0.5 rounded-md text-xs font-bold text-white" aria-label={`${count} pedidos`}>
          {count}
        </span>
      </div>
      
      <div className="flex-1 p-3 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {children.length > 0 ? (
          <div className="flex flex-col gap-3">
            {children}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center opacity-40">
            <i className={`fas fa-${icon} text-3xl mb-2`} aria-hidden="true"></i>
            <span className="text-sm font-medium">Vazio</span>
          </div>
        )}
      </div>
    </div>
  )
}

function OrderCard({ pedido, onClick, onAdvance, onPrint, isDone, color, isLoading, searchQuery }) {
  const colorThemes = {
    purple: 'border-l-4 border-l-[#7f22fe]',
    orange: 'border-l-4 border-l-orange-500',
    blue: 'border-l-4 border-l-blue-500',
    emerald: 'border-l-4 border-l-emerald-500 opacity-60 grayscale-[0.5]',
  }

  const { minutes, isUrgent } = getTimeElapsed(pedido.createdAt)

  // Highlight text baseado em busca
  const highlightText = (text) => {
    if (!searchQuery || !text) return text
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'))
    return parts.map((part, i) => 
      part.toLowerCase() === searchQuery.toLowerCase() 
        ? <mark key={i} className="bg-yellow-200 px-1 rounded">{part}</mark>
        : part
    )
  }

  return (
    <div 
      onClick={onClick} 
      className={`relative bg-white p-4 rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer border border-gray-200 group ${colorThemes[color]} w-full ${isUrgent && !isDone ? 'ring-red-400 ring-offset-2' : ''}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      aria-label={`Pedido ${pedido._id.slice(-4).toUpperCase()}, ${pedido.cliente?.nome || 'Consumidor'}, ${formatCurrency(pedido.total)}`}
    >
      {/* Badge de Urgência */}
      {isUrgent && !isDone && (
        <div className="absolute -top-2 -left-2 bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-full shadow-lg flex items-center gap-1 animate-pulse z-10">
          <i className="fas fa-exclamation-triangle"></i>
          <span>{minutes}min</span>
        </div>
      )}

      {/* Cabeçalho do Card */}
      <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
        <div>
          <span className="text-sm font-black text-gray-900 block">
             #{highlightText(pedido._id.slice(-4).toUpperCase())}
          </span>
          <span className="text-xs text-gray-600 font-semibold">
            {formatTime(pedido.createdAt)} {minutes > 0 && <span className="text-[10px] text-gray-500">({minutes}min)</span>}
          </span>
        </div>
        <div className="text-right">
           <span className="text-base font-black text-gray-900 block">{formatCurrency(pedido.total)}</span>
           <span className="text-xs uppercase font-bold text-gray-600">{pedido.tipo}</span>
        </div>
      </div>

      {/* Badge de Cluster com CORES */}
      {pedido.clusterId && pedido.clusterSize > 1 && (
        <div className={`mb-3 border-2 rounded-lg p-2.5 ${pedido.clusterColor.bg} ${pedido.clusterColor.border}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-7 h-7 rounded-full ${pedido.clusterColor.badge} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
              {pedido.clusterSize}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold ${pedido.clusterColor.text} leading-tight`}>
                Rota Compartilhada
              </p>
              <p className={`text-[10px] ${pedido.clusterColor.icon} font-medium`}>
                {pedido.clusterSize} pedidos próximos
              </p>
            </div>
            <i className={`fas fa-route ${pedido.clusterColor.icon} text-sm`} aria-hidden="true"></i>
          </div>
          
          {/* Lista de pedidos próximos */}
          <div className="space-y-1 pt-2 border-t border-current opacity-30">
            {pedido.clusterDistances.slice(0, 2).map((nearby, idx) => (
              <div key={idx} className={`flex items-center gap-2 text-[10px] ${pedido.clusterColor.text}`}>
                <i className="fas fa-arrow-right text-[8px]" aria-hidden="true"></i>
                <span className="font-bold">#{nearby.orderNumber}</span>
                <span className="opacity-75">→ {nearby.distance.toFixed(1)}km</span>
              </div>
            ))}
            {pedido.clusterDistances.length > 2 && (
              <div className={`text-[9px] ${pedido.clusterColor.text} opacity-60 font-medium pl-4`}>
                +{pedido.clusterDistances.length - 2} mais...
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 bg-gray-50 p-2 rounded border border-gray-100">
        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
          <i className="fas fa-user text-xs" aria-hidden="true"></i>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {highlightText(pedido.cliente?.nome || 'Consumidor')}
          </p>
          {pedido.cliente?.totalPedidos > 1 && (
            <p className="text-[10px] text-emerald-600 font-bold leading-none">
              ★ {pedido.cliente.totalPedidos}º Pedido
            </p>
          )}
        </div>
      </div>

      {/* Lista de Itens */}
      <div className="space-y-2 mb-4 min-h-[80px]">
        {pedido.itens.map((item, idx) => (
          <div key={idx} className="text-sm leading-relaxed">
            <div className="flex items-start gap-1">
              <span className="font-black text-gray-900 min-w-[24px]">{item.quantidade}x</span>
              <span className="text-gray-800 font-semibold flex-1">{highlightText(item.nome)}</span>
            </div>
            
            {item.complementos?.length > 0 && (
              <p className="text-xs text-gray-600 ml-6 mt-1 leading-snug font-medium">
                + {item.complementos.join(', ')}
              </p>
            )}
            
            {item.obs && (
              <div className="text-xs bg-yellow-100 text-yellow-900 px-2 py-1 rounded mt-1 ml-6 font-bold border border-yellow-300 inline-block">
                ⚠️ {item.obs}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Rodapé com Ação Rápida */}
      {!isDone && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
          <button 
            onClick={(e) => { e.stopPropagation(); onPrint(pedido); }}
            className="p-2 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title="Imprimir Rápido"
            aria-label="Imprimir pedido"
          >
             <i className="fas fa-print text-sm" aria-hidden="true"></i>
          </button>
          
          <button 
            onClick={(e) => { e.stopPropagation(); onAdvance() }}
            disabled={isLoading}
            className={`flex-1 py-2.5 rounded-lg text-sm font-black text-white shadow-sm flex items-center justify-center gap-2 transition-all ${
              isLoading 
                ? 'bg-gray-400 cursor-wait' 
                : 'bg-gray-900 hover:bg-black active:scale-95'
            }`}
            aria-label="Avançar para próxima etapa"
          >
            {isLoading ? (
              <>
                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                <span>PROCESSANDO...</span>
              </>
            ) : (
              <>
                <span>AVANÇAR</span>
                <i className="fas fa-chevron-right text-xs" aria-hidden="true"></i>
              </>
            )}
          </button>
        </div>
      )}
      
      {/* Ícone de expandir */}
      <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full w-6 h-6 flex items-center justify-center shadow-md border border-gray-200">
         <i className="fas fa-expand-alt text-gray-500 text-xs" aria-hidden="true"></i>
      </div>
    </div>
  )
}

function OrderModal({ pedido, onClose, onPrint, onAdvance, isLoading }) {
   const handleWhatsApp = () => {
    if (!pedido.cliente?.telefone) return
    const phone = pedido.cliente.telefone.replace(/\D/g, '')
    const fullPhone = phone.length <= 11 ? `55${phone}` : phone
    
    const msg = `Olá ${pedido.cliente.nome}, tudo bem? Aqui é do NexFood. Estamos entrando em contato sobre seu pedido #${pedido._id.slice(-4).toUpperCase()}.`
    
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`, '_blank')
  }
  
  const isPixRecusado = (pedido.formaPagamento === 'pix' || pedido.formaPagamento === 'online_pix') 
                         && pedido.statusPagamento === 'recusado'

  const { minutes } = getTimeElapsed(pedido.createdAt)

  // Função para abrir no Google Maps
  const openGoogleMaps = () => {
    if (!pedido.enderecoEntrega) return
    
    const { rua, numero, bairro, cidade } = pedido.enderecoEntrega
    const address = `${rua}, ${numero}, ${bairro}, ${cidade}`
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    
    window.open(url, '_blank')
  }

  const openClusterRoute = () => {
    if (!pedido.clusterId || !pedido.clusterDistances.length) return
    
    // 1. Tenta pegar o endereço do restaurante salvo no localStorage (se existir)
    // 2. Caso contrário, usa um endereço FIXO (Edite a string abaixo com o endereço real do seu restaurante)
    const user = JSON.parse(localStorage.getItem('nexfood_user') || '{}')
    const restauranteEndereco = user.endereco || "Av. Paulista, 1000, São Paulo - SP" // <--- EDITE AQUI SEU ENDEREÇO PADRÃO

    // Criar waypoints para rota (paradas intermediárias)
    const waypoints = pedido.clusterDistances
      .map(nearby => nearby.address)
      .join('|')
    
    // O destino final é o endereço deste pedido atual
    const destination = `${pedido.enderecoEntrega.rua}, ${pedido.enderecoEntrega.numero}, ${pedido.enderecoEntrega.cidade}`

    // Monta a URL: Origem (Restaurante) -> Paradas (Outros pedidos) -> Destino (Pedido atual)
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(restauranteEndereco)}&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`
    
    window.open(url, '_blank')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      <div className="relative w-full max-w-3xl bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gray-50 px-6 py-5 flex items-center justify-between border-b border-gray-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-[#7f22fe] flex items-center justify-center shadow-sm">
              <i className="fas fa-receipt text-white" aria-hidden="true"></i>
            </div>
            <div>
              <h2 id="modal-title" className="text-xl font-bold text-gray-900 flex items-center gap-3">
                Pedido #{pedido._id.slice(-4).toUpperCase()}
                {minutes > 0 && (
                  <span className="text-sm font-normal text-gray-600">({minutes} minutos atrás)</span>
                )}
              </h2>
              <span className="text-xs px-3 py-1 rounded-full bg-purple-100 text-[#7f22fe] border border-purple-200 font-medium inline-block mt-1">
                {pedido.status}
              </span>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Fechar modal"
          >
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">

            {/* Alerta PIX Recusado */}
            {isPixRecusado && (
              <div className="rounded-xl bg-red-50 border-2 border-red-400 p-6" role="alert">
                <div className="flex items-start gap-4 text-red-900">
                  <div className="w-14 h-14 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
                    <i className="fas fa-ban text-2xl text-white" aria-hidden="true"></i>
                  </div>
                  <div className="flex-1">
                    <p className="font-black text-lg mb-2">⚠️ Pagamento Recusado</p>
                    <p className="text-sm leading-relaxed mb-3">
                      O pagamento PIX foi recusado. Este pedido <strong>não deve ser preparado</strong>.
                    </p>
                    <div className="bg-white rounded-lg p-3 border border-red-200">
                      <p className="text-xs font-bold mb-1">AÇÕES SUGERIDAS:</p>
                      <ul className="text-xs space-y-1 ml-4 list-disc">
                        <li>Entre em contato com o cliente pelo telefone</li>
                        <li>Ofereça nova tentativa de pagamento</li>
                        <li>Considere converter para dinheiro/cartão na entrega</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {pedido.cliente?.telefone && (
              <button 
                onClick={handleWhatsApp}
                className="w-full mb-2 flex items-center justify-center gap-2 py-3 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg transition-colors font-bold"
                aria-label={`Conversar com ${pedido.cliente.nome} no WhatsApp`}
              >
                <i className="fab fa-whatsapp text-xl" aria-hidden="true"></i>
                <span>Conversar com {pedido.cliente.nome.split(' ')[0]} ({pedido.cliente.telefone})</span>
              </button>
            )}

            {/* Itens */}
            <div className="space-y-3">
              {pedido.itens.map((item, idx) => (
                <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-4 hover:bg-gray-100 transition-colors">
                  <div className="flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-lg bg-[#7f22fe] flex items-center justify-center font-bold text-white shadow-sm shrink-0">
                      {item.quantidade}x
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-gray-900 font-semibold text-base">{item.nome}</p>
                        <p className="text-gray-900 font-bold text-base">{formatCurrency(item.precoUnitario * item.quantidade)}</p>
                      </div>
                      {item.complementos?.length > 0 && (
                        <p className="text-sm text-gray-600 mb-2">+ {item.complementos.join(', ')}</p>
                      )}
                      {item.obs && (
                        <div className="inline-flex items-center gap-2 text-xs bg-yellow-100 text-yellow-800 px-3 py-1.5 rounded-lg border border-yellow-200 font-medium">
                          <i className="fas fa-sticky-note" aria-hidden="true"></i>
                          {item.obs}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-5">
                <h3 className="font-bold text-blue-900 uppercase text-xs mb-4 flex items-center gap-2">
                  <i className="fas fa-map-marker-alt" aria-hidden="true"></i> Entrega
                </h3>
                <div className="space-y-2 text-sm">
                  {pedido.enderecoEntrega ? (
                    <>
                      <p className="text-gray-900 font-semibold">{pedido.enderecoEntrega.rua}, {pedido.enderecoEntrega.numero}</p>
                      <p className="text-gray-600 text-xs">{pedido.enderecoEntrega.bairro} - {pedido.enderecoEntrega.cidade}
                        {pedido.enderecoEntrega.complemento && ` - ${pedido.enderecoEntrega.complemento}`}
                      </p>
                      
                      {/* Botões de Mapa */}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={openGoogleMaps}
                          className="flex-1 py-2 px-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
                          aria-label="Abrir endereço no Google Maps"
                        >
                          <i className="fas fa-map-marked-alt" aria-hidden="true"></i>
                          Ver no Mapa
                        </button>
                        
                        {pedido.clusterId && pedido.clusterDistances.length > 0 && (
                          <button
                            onClick={openClusterRoute}
                            className="flex-1 py-2 px-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
                            aria-label="Abrir rota otimizada no Google Maps"
                          >
                            <i className="fas fa-route" aria-hidden="true"></i>
                            Rota Otimizada
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-700 bg-white p-3 rounded border border-blue-200">
                      <i className="fas fa-store" aria-hidden="true"></i>
                      <span className="font-medium">Retirada no Balcão</span>
                    </div>
                  )}
                </div>
                
                {/* Detalhes do Cluster na Modal */}
                {pedido.clusterId && pedido.clusterSize > 1 && (
                  <div className={`mt-4 ${pedido.clusterColor.bg} ${pedido.clusterColor.border}`}>
                    <div className={`bg-white rounded-lg p-4 border ${pedido.clusterColor.border}`}>
                      <p className={`text-xs font-bold ${pedido.clusterColor.text} mb-3 flex items-center gap-2`}>
                        <i className="fas fa-map-marked-alt" aria-hidden="true"></i>
                        Pedidos na Mesma Rota:
                      </p>
                      <div className="space-y-2">
                        {pedido.clusterDistances.map((nearby, idx) => (
                          <div key={idx} className={`flex items-center justify-between p-2 rounded ${pedido.clusterColor.bg} border ${pedido.clusterColor.border}`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-6 h-6 rounded-full ${pedido.clusterColor.badge} text-white text-xs font-bold flex items-center justify-center`}>
                                {idx + 1}
                              </div>
                              <div>
                                <p className={`text-xs font-bold ${pedido.clusterColor.text}`}>
                                  Pedido #{nearby.orderNumber}
                                </p>
                                <p className={`text-[10px] ${pedido.clusterColor.icon} truncate max-w-[200px]`}>
                                  {nearby.address}
                                </p>
                              </div>
                            </div>
                            <div className={`text-right`}>
                              <p className={`text-xs font-black ${pedido.clusterColor.badge} text-white px-2 py-1 rounded`}>
                                {nearby.distance.toFixed(1)} km
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-5">
                <h3 className="font-bold text-emerald-900 uppercase text-xs mb-4 flex items-center gap-2">
                  <i className="fas fa-wallet" aria-hidden="true"></i> Pagamento
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between text-gray-700">
                    <span>Subtotal</span>
                    <span className="font-semibold">{formatCurrency(pedido.subtotal)}</span>
                  </div>
                  {pedido.desconto > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Desconto</span>
                      <span className="font-semibold">-{formatCurrency(pedido.desconto)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-900 font-bold text-xl pt-3 border-t border-emerald-200">
                    <span>Total</span>
                    <span className="text-[#7f22fe]">
                      {formatCurrency(pedido.total)}
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-3 mt-4 p-3 rounded-lg bg-white border border-emerald-200">
                    <span className="text-xs uppercase font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded border border-gray-300">
                      {pedido.formaPagamento?.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      pedido.statusPagamento === 'aprovado' 
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' 
                        : pedido.statusPagamento === 'recusado'
                        ? 'bg-red-100 text-red-700 border border-red-300'
                        : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                    }`}>
                      {pedido.statusPagamento?.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 p-6 border-t border-gray-200 flex gap-4">
          <button 
            onClick={onPrint} 
            className="flex-1 py-4 rounded-lg bg-white hover:bg-gray-100 border-2 border-gray-300 text-gray-700 font-bold transition-colors"
            aria-label="Imprimir pedido"
          >
            <i className="fas fa-print mr-2" aria-hidden="true"></i>
            <span>Imprimir</span>
          </button>
          
          {pedido.status !== 'Entregue' && pedido.status !== 'Cancelado' && !isPixRecusado && (
            <button 
              onClick={() => { onAdvance(); onClose(); }} 
              disabled={isLoading}
              className={`flex-[2] py-4 rounded-lg font-bold transition-all text-white shadow-md ${
                isLoading 
                  ? 'bg-gray-400 cursor-wait' 
                  : 'bg-[#7f22fe] hover:bg-[#6b1de0]'
              }`}
              aria-label="Avançar para próxima etapa"
            >
              {isLoading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-arrow-right mr-2" aria-hidden="true"></i>
                  <span>Avançar Etapa</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}