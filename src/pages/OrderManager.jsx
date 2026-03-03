import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import electronAPI from '@utils/electronBridge'
import { useOrderClustering } from '@hooks/useOrderClustering'
import { ClusterFloatingCard } from '../components/ClusterFloatingCard'

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

const renderPedidoToHTML = (pedido) => {
  const nomeRestaurante = localStorage.getItem('nomeRestaurante') || 'Restaurante'
  const enderecoRestaurante = localStorage.getItem('enderecoRestaurante') || ''

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
          <span class="item-price">${formatCurrency(totalItem)}</span>
        </div>
        ${complementosHtml}
        ${obsHtml}
      </div>
    `
  }).join('')

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { margin: 0; size: 72mm auto; }
          html, body { height: auto !important; overflow: hidden; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 70mm;
            margin: 0;
            padding: 4px 6px 2px 6px;
            color: #000;
            font-size: 12px;
            line-height: 1.5;
            -webkit-font-smoothing: none;
            display: inline-block;
          }
          .text-center { text-align: center; }
          .title { font-size: 16px; font-weight: 900; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 1px; }
          .restaurant-address { font-size: 11px; font-weight: 700; color: #000; margin-bottom: 6px; }
          .subtitle { font-size: 12px; font-weight: 800; color: #000; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
          .info-group { margin-bottom: 8px; }
          .info-label { font-size: 11px; text-transform: uppercase; font-weight: 900; color: #000; border-bottom: 1px solid #000; margin-bottom: 3px; }
          .info-value { font-size: 13px; font-weight: 800; color: #000; }
          .info-sub { font-size: 12px; font-weight: 700; color: #000; }
          .divider-bold { border-top: 2px solid #000; margin: 8px 0; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }

          .item-row { margin-bottom: 8px; }
          .item-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
          }
          .qty { font-weight: 900; margin-right: 5px; font-size: 13px; min-width: 22px; color: #000; }
          .name { font-weight: 800; flex: 1; font-size: 12px; word-break: break-word; color: #000; }
          .item-price {
            font-weight: 900;
            font-size: 12px;
            color: #000;
            text-align: right;
            white-space: nowrap;
            margin-left: 4px;
            min-width: 52px;
          }
          .complementos { margin-left: 27px; font-size: 11px; font-weight: 800; color: #000; }
          .obs { margin-left: 27px; margin-top: 3px; font-weight: 900; font-size: 11px; border-left: 3px solid #000; padding-left: 4px; color: #000; }

          .totals-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; font-weight: 800; color: #000; }
          .total-big { font-size: 17px; font-weight: 900; margin-top: 5px; color: #000; }
          .payment-box { border: 2px solid #000; padding: 5px; margin-top: 8px; text-align: center; font-weight: 900; font-size: 13px; color: #000; }
          .footer { margin-top: 8px; margin-bottom: 0; text-align: center; font-size: 11px; font-weight: 800; color: #000; border-top: 2px dashed #000; padding-top: 6px; padding-bottom: 4px; }          .fiel { font-size: 11px; font-weight: 900; color: #000; margin-top: 2px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">${nomeRestaurante}</div>
          ${enderecoRestaurante ? `<div class="restaurant-address">${enderecoRestaurante}</div>` : ''}
          <div class="subtitle">
            ${formatDate(pedido.createdAt)} — ${formatTime(pedido.createdAt)}<br/>
            PEDIDO #${pedido._id.slice(-4).toUpperCase()}
          </div>
        </div>

        <div class="info-group">
          <div class="info-label">Cliente</div>
          <div class="info-value">${pedido.cliente?.nome || 'Consumidor'}</div>
          ${pedido.cliente?.telefone ? `<div class="info-sub">Tel: ${pedido.cliente.telefone}</div>` : ''}
          ${pedido.cliente?.totalPedidos > 0 ? `<div class="fiel">★ Cliente Fiel (${pedido.cliente.totalPedidos}º pedido)</div>` : ''}
        </div>

        ${pedido.tipo === 'Delivery' && pedido.enderecoEntrega ? `
          <div class="info-group">
            <div class="info-label">Entrega</div>
            <div class="info-value">
              ${pedido.enderecoEntrega.rua}, ${pedido.enderecoEntrega.numero}
            </div>
            <div class="info-sub">${pedido.enderecoEntrega.bairro} — ${pedido.enderecoEntrega.cidade}</div>
            ${pedido.enderecoEntrega.complemento ? `<div class="info-sub">Comp: ${pedido.enderecoEntrega.complemento}</div>` : ''}
          </div>
        ` : `<div class="payment-box">★ RETIRADA NO BALCÃO ★</div>`}

        <div class="divider-bold"></div>
        ${itensHtml}
        <div class="divider-bold"></div>

        <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(pedido.subtotal)}</span></div>
        ${pedido.desconto > 0 ? `<div class="totals-row"><span>Desconto</span><span>- ${formatCurrency(pedido.desconto)}</span></div>` : ''}
        <div class="totals-row total-big"><span>TOTAL</span><span>${formatCurrency(pedido.total)}</span></div>

        <div class="divider"></div>
        <div class="info-label">Pagamento</div>
        <div class="info-value">${pedido.formaPagamento?.replace(/_/g, ' ').toUpperCase()}</div>
        ${pedido.trocoPara ? `<div class="info-sub">Troco para: ${formatCurrency(pedido.trocoPara)}</div>` : ''}

        <div class="footer">
          ${nomeRestaurante} • Obrigado pela preferência!
          NEXFOOD - Tecnologia para Delivery
          NEX07 • CNPJ 63.805.056/0001-33
        </div>
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
  const [finishedColumnCollapsed, setFinishedColumnCollapsed] = useState(false)
  const [visibleClusters, setVisibleClusters] = useState([])
    
  // --- ESTADOS PARA BUSCA E FILTROS ---
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({
    tipo: 'todos',
    pagamento: 'todos',
    valorMin: '',
    valorMax: '',
    apenasAgrupados: false,
    apenasUrgentes: false,
    apenasRecorrentes: false,
  })
  const [showFilters, setShowFilters] = useState(false)
  
  const processedOrderIds = useRef(new Set())
  const navigate = useNavigate()

  const clearAuthAndRedirect = () => {
    ['nexfood_token', 'nexfood_user'
    ].forEach(key => localStorage.removeItem(key))
    sessionStorage.removeItem('nexfood_token')
    sessionStorage.removeItem('nexfood_user')
    navigate('/login')
  }

  const [settings, setSettings] = useState({
    impressoraAutomatica: localStorage.getItem('impressoraAutomatica') || '',
    aceitarAutomatico: localStorage.getItem('aceitarAutomatico') !== 'false',
    notificacoesPush: localStorage.getItem('notificacoesPush') === 'true',
    somNotificacao: localStorage.getItem('somNotificacao') !== 'false',
    tempoRefresh: Math.max(10, Math.min(30, parseInt(localStorage.getItem('tempoRefresh')) || 10)),
    agruparPorDistancia: localStorage.getItem('agruparPorDistancia') === 'true',
    raioCluster: parseFloat(localStorage.getItem('raioCluster')) || 2,
    enderecoRestaurante: localStorage.getItem('enderecoRestaurante') || 'Av. Paulista, 1578, São Paulo, SP',
    tempoJanela: parseInt(localStorage.getItem('tempoJanela')) || 30, // Default 30 min
    capacidadeEntrega: parseInt(localStorage.getItem('capacidadeEntrega')) || 4, // Default 4 pedidos
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
    return
  }

  // Navegador: aguarda o load completo antes de imprimir
  const w = window.open('', '_blank', 'width=380,height=700')
  if (!w) {
    alert('Pop-up bloqueado! Permita pop-ups para este site.')
    return
  }

  w.document.open()
  w.document.write(html)
  w.document.close()

  // Usa onload em vez de setTimeout para garantir que o conteúdo carregou
  w.onload = () => {
    setTimeout(() => {
      w.focus()
      w.print()
      // Fecha após imprimir (opcional)
      w.onafterprint = () => w.close()
    }, 200)
  }

  // Fallback caso onload não dispare (alguns browsers)
  setTimeout(() => {
    if (!w.closed) {
      w.focus()
      w.print()
    }
  }, 1500)
}

  const apiUpdateStatus = async (id, status) => {
    const token = localStorage.getItem('nexfood_token')
    const res = await fetch(`https://nexfood.vercel.app/api/pedidos/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ status })
    })
    if (res.status === 401 || res.status === 403) return clearAuthAndRedirect()
  }

  const fetchPedidos = useCallback(async () => {
    try {
      const token = localStorage.getItem('nexfood_token') || sessionStorage.getItem('nexfood_token')
      if (!token) return navigate('/login')

      const res = await fetch('https://nexfood.vercel.app/api/pedidos/dia', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 401 || res.status === 403) return clearAuthAndRedirect()
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

  // Hook atualizado com os novos parâmetros de inteligência
  const clusteredActive = useOrderClustering(
    activeOrders, 
    settings.agruparPorDistancia, 
    settings.raioCluster,
    settings.tempoJanela,      // Novo: Janela de tempo
    settings.capacidadeEntrega 
  )

  // Recombina
  const pedidosComClusters = useMemo(() => 
    [...clusteredActive, ...finishedOrders], 
  [clusteredActive, finishedOrders])

  // --- BUSCA E FILTROS ---
  const pedidosFiltrados = useMemo(() => {
    let resultado = pedidosComClusters

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

    if (filters.tipo !== 'todos') {
      resultado = resultado.filter(p => p.tipo === filters.tipo)
    }

    if (filters.pagamento !== 'todos') {
      resultado = resultado.filter(p => p.formaPagamento?.includes(filters.pagamento))
    }

    if (filters.valorMin) {
      resultado = resultado.filter(p => p.total >= parseFloat(filters.valorMin))
    }
    if (filters.valorMax) {
      resultado = resultado.filter(p => p.total <= parseFloat(filters.valorMax))
    }

    if (filters.apenasAgrupados) {
      resultado = resultado.filter(p => p.clusterId && p.clusterSize > 1)
    }

    if (filters.apenasUrgentes) {
      resultado = resultado.filter(p => {
        const { isUrgent } = getTimeElapsed(p.createdAt)
        return isUrgent
      })
    }

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

  // Avançar cluster inteiro
  const advanceCluster = async (clusterId) => {
    const clusterOrders = pedidosComClusters.filter(p => p.clusterId === clusterId)
    
    for (const pedido of clusterOrders) {
      await advanceStatus(pedido)
    }
    
    await fetchPedidos()
    
    const stillActive = pedidosComClusters.some(p => 
      p.clusterId === clusterId && 
      p.status !== 'Entregue' && 
      p.status !== 'Cancelado'
    )
    
    if (!stillActive) {
      setVisibleClusters(prev => prev.filter(id => id !== clusterId))
    }
  }

  const toggleClusterPin = (clusterId) => {
    setVisibleClusters(prev => 
      prev.includes(clusterId)
        ? prev.filter(id => id !== clusterId)
        : [...prev, clusterId]
    )
  }

  const uniqueClusters = useMemo(() => {
    const clusterMap = new Map()
    pedidosComClusters.forEach(p => {
      if (p.clusterId && p.clusterSize > 1 && p.status !== 'Entregue' && p.status !== 'Cancelado') {
        if (!clusterMap.has(p.clusterId)) {
          clusterMap.set(p.clusterId, {
            clusterId: p.clusterId,
            clusterColor: p.clusterColor,
            clusterSize: p.clusterSize
          })
        }
      }
    })
    return Array.from(clusterMap.values())
  }, [pedidosComClusters])

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
      
      {/* Header */}
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
          
          <div className={`grid gap-4 h-full transition-all ${
            settings.aceitarAutomatico 
              ? finishedColumnCollapsed
                ? 'grid-cols-[1fr_1fr_80px]'
                : 'grid-cols-[1fr_1fr_1fr]'
              : finishedColumnCollapsed
                ? 'grid-cols-[280px_1fr_1fr_80px]'
                : 'grid-cols-[280px_1fr_1fr_280px]'
          }`}>
            
            {!settings.aceitarAutomatico && (
              <KanbanColumn 
                title="Novos Pedidos" 
                count={columns.pendente.length} 
                color="purple" 
                icon="bell"
                columnWidth="narrow"
              >
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
                    visibleClusters={visibleClusters}
                    toggleClusterPin={toggleClusterPin}
                    columnWidth="narrow"
                  />
                ))}
              </KanbanColumn>
            )}

            <KanbanColumn 
              title="Em Preparação" 
              count={columns.preparo.length} 
              color="orange" 
              icon="fire"
              columnWidth="wide"
            >
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
                  visibleClusters={visibleClusters}
                  toggleClusterPin={toggleClusterPin}
                  columnWidth="wide"
                  restaurantAddress={settings.enderecoRestaurante}
                  pedidos={pedidosComClusters}
                />
              ))}
            </KanbanColumn>

            <KanbanColumn 
              title="Em Entrega" 
              count={columns.entrega.length} 
              color="blue" 
              icon="shipping-fast"
              columnWidth="wide"
            >
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
                  visibleClusters={visibleClusters}
                  toggleClusterPin={toggleClusterPin}
                  columnWidth="wide"
                  restaurantAddress={settings.enderecoRestaurante}
                  pedidos={pedidosComClusters}
                />
              ))}
            </KanbanColumn>

            <KanbanColumn 
              title="Finalizados" 
              count={columns.concluido.length} 
              color="emerald" 
              icon="check-circle"
              isCollapsible={true}
              isCollapsed={finishedColumnCollapsed}
              onToggleCollapse={() => setFinishedColumnCollapsed(!finishedColumnCollapsed)}
              columnWidth={finishedColumnCollapsed ? 'collapsed' : 'narrow'}
            >
              {columns.concluido.map(p => (
                <OrderCard 
                  key={p._id} 
                  pedido={p} 
                  onClick={() => setSelectedOrder(p)}
                  onPrint={() => handlePrint(p)}
                  isDone 
                  color="emerald"
                  searchQuery={searchQuery}
                  visibleClusters={visibleClusters}
                  toggleClusterPin={toggleClusterPin}
                  columnWidth="narrow"
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

                       {/* Controle 1: Capacidade da Bag */}
                    <div className="p-4 rounded-lg bg-white border-2 border-blue-100">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <span className="text-sm font-bold text-gray-900 block flex items-center gap-2">
                            <i className="fas fa-shopping-bag text-blue-500"></i>
                            Capacidade da Entrega
                          </span>
                          <span className="text-[10px] text-gray-500">Quantos pedidos o motoboy leva?</span>
                        </div>
                        <span className="text-sm font-black text-blue-700 bg-blue-100 px-2 py-1 rounded border border-blue-200">
                          {settings.capacidadeEntrega} un.
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="2" 
                        max="8" 
                        step="1" 
                        value={settings.capacidadeEntrega} 
                        onChange={(e) => saveSettings({...settings, capacidadeEntrega: parseInt(e.target.value)})}
                        className="w-full h-2 bg-gradient-to-r from-blue-200 to-blue-400 rounded-lg appearance-none cursor-pointer slider-blue"
                      />
                      <div className="flex justify-between text-[10px] text-gray-400 mt-2 font-medium">
                        <span>2 (Mínimo)</span>
                        <span>8 (Mochila Cheia)</span>
                      </div>
                    </div>

                    {/* Controle 2: Janela de Tempo */}
                    <div className="p-4 rounded-lg bg-white border-2 border-blue-100">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <span className="text-sm font-bold text-gray-900 block flex items-center gap-2">
                            <i className="fas fa-hourglass-half text-blue-500"></i>
                            Janela de Agrupamento
                          </span>
                          <span className="text-[10px] text-gray-500">Espera máx. do 1º pedido</span>
                        </div>
                        <span className="text-sm font-black text-blue-700 bg-blue-100 px-2 py-1 rounded border border-blue-200">
                          {settings.tempoJanela} min
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="10" 
                        max="60" 
                        step="5" 
                        value={settings.tempoJanela} 
                        onChange={(e) => saveSettings({...settings, tempoJanela: parseInt(e.target.value)})}
                        className="w-full h-2 bg-gradient-to-r from-blue-200 to-blue-400 rounded-lg appearance-none cursor-pointer slider-blue"
                      />
                      <div className="flex justify-between text-[10px] text-gray-400 mt-2 font-medium">
                        <span>10min (Rápido)</span>
                        <span>60min (Econômico)</span>
                      </div>
                      <p className="mt-2 text-[10px] text-orange-600 bg-orange-50 p-2 rounded border border-orange-100">
                        <i className="fas fa-exclamation-circle mr-1"></i>
                        Pedidos antigos não esperarão mais que {settings.tempoJanela} min para sair, garantindo que a comida chegue quente.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                        Endereço do Restaurante
                      </label>
                      <input
                        type="text"
                        value={settings.enderecoRestaurante}
                        onChange={(e) => saveSettings({...settings, enderecoRestaurante: e.target.value})}
                        placeholder="Ex: Av. Paulista, 1578, São Paulo, SP"
                        className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                      />
                      <p className="text-[10px] text-gray-500">
                        Usado como ponto de partida nas rotas
                      </p>
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
                              <span>Clique em <strong>"Criar Rota"</strong> para abrir no Google Maps</span>
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
          pedidos={pedidosComClusters}
          onNavigate={setSelectedOrder}
          restaurantAddress={settings.enderecoRestaurante}
        />
      )}

      {/* Clusters Flutuantes */}
      {uniqueClusters
        .filter(c => visibleClusters.includes(c.clusterId))
        .map(cluster => (
          <ClusterFloatingCard
            key={cluster.clusterId}
            cluster={cluster}
            pedidos={pedidosComClusters}
            onAdvanceCluster={() => advanceCluster(cluster.clusterId)}
            onOrderClick={setSelectedOrder}
            onClose={() => toggleClusterPin(cluster.clusterId)}
          />
        ))
      }
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

function KanbanColumn({ title, count, children, color, icon, isCollapsible, isCollapsed, onToggleCollapse, columnWidth = 'normal' }) {
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
    <div className={`flex flex-col h-full rounded-xl bg-gray-100/50 border border-gray-200 overflow-hidden shadow-sm transition-all ${
      isCollapsed ? 'max-w-[80px]' : ''
    }`}>
      <div 
        className={`px-4 py-3 border-b-2 bg-white flex justify-between items-center ${colorThemes[color].split(' ')[0]} ${
          isCollapsible ? 'cursor-pointer hover:bg-gray-50' : ''
        }`}
        onClick={isCollapsible ? onToggleCollapse : undefined}
      >
        <div className={`font-bold flex items-center gap-2 ${textColors[color]}`}>
          <div className={`p-1.5 rounded-md bg-opacity-10 ${colorThemes[color].replace('border-', 'bg-')}`}>
            <i className={`fas fa-${icon}`} aria-hidden="true"></i>
          </div>
          {!isCollapsed && <span className="uppercase tracking-tight text-sm">{title}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-gray-800 px-2.5 py-0.5 rounded-md text-xs font-bold text-white">
            {count}
          </span>
          {isCollapsible && (
            <i className={`fas fa-chevron-${isCollapsed ? 'right' : 'left'} text-xs`}></i>
          )}
        </div>
      </div>
      
      {!isCollapsed && (
        <div className="flex-1 p-3 overflow-y-auto overflow-x-hidden custom-scrollbar">
          {children.length > 0 ? (
            <div className={`flex flex-row flex-wrap gap-3 ${
              columnWidth === 'narrow' ? '' : columnWidth === 'wide' ? '' : ''
            }`}>
              {children}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-40">
              <i className={`fas fa-${icon} text-3xl mb-2`} aria-hidden="true"></i>
              <span className="text-sm font-medium">Vazio</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OrderCard({ 
  pedido, 
  onClick, 
  onAdvance, 
  onPrint, 
  isDone, 
  color, 
  isLoading, 
  searchQuery, 
  visibleClusters, 
  toggleClusterPin,
  columnWidth = 'normal',
  restaurantAddress,
  pedidos 
}) {
  const colorThemes = {
    purple: 'border-l-4 border-l-[#7f22fe]',
    orange: 'border-l-4 border-l-orange-500',
    blue: 'border-l-4 border-l-blue-500',
    emerald: 'border-l-4 border-l-emerald-500 opacity-60 grayscale-[0.5]',
  }

  const { minutes, isUrgent } = getTimeElapsed(pedido.createdAt)

  const highlightText = (text) => {
    if (!searchQuery || !text) return text
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'))
    return parts.map((part, i) => 
      part.toLowerCase() === searchQuery.toLowerCase() 
        ? <mark key={i} className="bg-yellow-200 px-1 rounded">{part}</mark>
        : part
    )
  }

  // Função para criar rota no Google Maps
  const createRoute = (e) => {
    e.stopPropagation()
    
    if (!pedido.clusterId || !pedidos) return
    
    const clusterOrders = pedidos
      .filter(p => p.clusterId === pedido.clusterId && p.enderecoEntrega)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    
    if (clusterOrders.length === 0) return
    
    const origin = restaurantAddress || 'Av. Paulista, 1578, São Paulo, SP'
    
    const waypoints = clusterOrders.map(p => {
      const addr = p.enderecoEntrega
      return `${addr.rua}, ${addr.numero}, ${addr.bairro}, ${addr.cidade}`
    }).join('|')
    
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(clusterOrders[clusterOrders.length - 1].enderecoEntrega.rua + ', ' + clusterOrders[clusterOrders.length - 1].enderecoEntrega.numero)}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`
    
    window.open(mapsUrl, '_blank')
  }

  // Layout para coluna estreita (1 card por linha)
  const isNarrowColumn = columnWidth === 'narrow'

  return (
    <div 
      onClick={onClick} 
      className={`relative bg-white p-3 rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer border group ${colorThemes[color]} ${
        isUrgent && !isDone ? 'ring-1 ring-red-400' : ''
      } ${isNarrowColumn ? 'w-full' : 'max-w-[280px] flex-1'}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Cabeçalho: ID, Hora, Preço e Badge de Tempo (reorganizado) */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs font-black text-gray-900">
            #{highlightText(pedido._id.slice(-4).toUpperCase())}
          </span>
          <span className="text-[10px] text-gray-500">{formatTime(pedido.createdAt)}</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Badge de tempo ANTES do preço, sem sobreposição */}
          {isUrgent && !isDone && (
            <div className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-md flex items-center gap-1">
              <i className="fas fa-clock"></i>
              {minutes}min
            </div>
          )}
          <span className="text-sm font-black text-gray-900 whitespace-nowrap">{formatCurrency(pedido.total)}</span>
        </div>
      </div>

      {/* Cliente */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 shrink-0">
          <i className="fas fa-user text-[10px]"></i>
        </div>
        <p className="text-xs font-bold text-gray-900 truncate flex-1">
          {highlightText(pedido.cliente?.nome || 'Consumidor')}
        </p>
        {pedido.cliente?.totalPedidos > 1 && (
          <span className="text-[9px] text-emerald-600 font-bold">★{pedido.cliente.totalPedidos}</span>
        )}
      </div>

      {/* Badge de Cluster COM BOTÃO "CRIAR ROTA" */}
      {pedido.clusterId && pedido.clusterSize > 1 && (
        <div className={`mb-2 p-2 rounded ${pedido.clusterColor.bg} ${pedido.clusterColor.border} border`}>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 flex-1">
              <div className={`w-5 h-5 rounded-full ${pedido.clusterColor.badge} flex items-center justify-center text-white font-bold text-[9px]`}>
                {pedido.clusterSize}
              </div>
              <p className={`text-[10px] font-bold ${pedido.clusterColor.text}`}>
                Rota Compartilhada
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleClusterPin(pedido.clusterId)
              }}
              className={`w-5 h-5 rounded flex items-center justify-center text-xs transition-all ${
                visibleClusters.includes(pedido.clusterId)
                  ? `${pedido.clusterColor.badge} text-white`
                  : 'bg-white hover:bg-gray-100'
              }`}
              title="Fixar cluster"
            >
              <i className="fas fa-thumbtack"></i>
            </button>
          </div>
        </div>
      )}

      {/* Itens (resumido) */}
      <div className="text-[11px] mb-2 space-y-1">
        {pedido.itens.slice(0, 2).map((item, idx) => (
          <div key={idx} className="flex items-start gap-1">
            <span className="font-black text-gray-900 min-w-[18px]">{item.quantidade}x</span>
            <span className="text-gray-700 font-semibold truncate flex-1">{item.nome}</span>
          </div>
        ))}
        {pedido.itens.length > 2 && (
          <p className="text-[9px] text-gray-500 font-medium">+{pedido.itens.length - 2} itens</p>
        )}
      </div>

      {/* Ações */}
      {!isDone && (
        <div className="flex gap-1.5">
          <button 
            onClick={(e) => { e.stopPropagation(); onPrint(); }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 text-xs"
            title="Imprimir"
          >
            <i className="fas fa-print"></i>
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onAdvance() }}
            disabled={isLoading}
            className={`flex-1 py-1.5 rounded text-[10px] font-black text-white shadow-sm transition-all ${
              isLoading ? 'bg-gray-400' : 'bg-gray-900 hover:bg-black'
            }`}
          >
            {isLoading ? 'PROC...' : 'AVANÇAR'}
          </button>
        </div>
      )}
    </div>
  )
}

function OrderModal({ pedido, onClose, onPrint, onAdvance, isLoading, pedidos, onNavigate, restaurantAddress }) {
  const [currentPedido, setCurrentPedido] = useState(pedido)

  // Atualizar quando pedido externo mudar
  useEffect(() => {
    setCurrentPedido(pedido)
  }, [pedido])

  const handleWhatsApp = () => {
    if (!currentPedido.cliente?.telefone) return
    const phone = currentPedido.cliente.telefone.replace(/\D/g, '')
    const fullPhone = phone.length <= 11 ? `55${phone}` : phone
    const msg = `Olá ${currentPedido.cliente.nome}, tudo bem? Aqui é do NexFood. Estamos entrando em contato sobre seu pedido #${currentPedido._id.slice(-4).toUpperCase()}.`
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const openGoogleMaps = () => {
    if (!currentPedido.enderecoEntrega) return
    const { rua, numero, bairro, cidade } = currentPedido.enderecoEntrega
    const address = `${rua}, ${numero}, ${bairro}, ${cidade}`
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank')
  }

  // Criar rota do cluster
  const createClusterRoute = () => {
  if (!currentPedido?.clusterId || !pedidos?.length) return

  const clusterOrders = pedidos
    .filter(p => p.clusterId === currentPedido.clusterId && p.enderecoEntrega)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  if (clusterOrders.length === 0) return

  const origin = restaurantAddress || 'Av. Paulista, 1578, São Paulo, SP'

  const destinationAddress = clusterOrders[clusterOrders.length - 1].enderecoEntrega
  const destination = `${destinationAddress.rua}, ${destinationAddress.numero}, ${destinationAddress.bairro}, ${destinationAddress.cidade}`

  const waypoints = clusterOrders
    .slice(0, -1) // 👈 remove o último
    .map(p => {
      const addr = p.enderecoEntrega
      return `${addr.rua}, ${addr.numero}, ${addr.bairro}, ${addr.cidade}`
    })
    .join('|')

  const mapsUrl =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '') +
    `&travelmode=driving`

  window.open(mapsUrl, '_blank')
}


  // Navegar para pedido próximo
  const navigateToOrder = (orderId) => {
    const nextPedido = pedidos.find(p => p._id === orderId)
    if (nextPedido) {
      setCurrentPedido(nextPedido)
      onNavigate(nextPedido)
    }
  }

  // Navegação prev/next no cluster
  const clusterOrders = pedidos?.filter(p => p.clusterId === currentPedido.clusterId) || []
  const currentIndexInCluster = clusterOrders.findIndex(p => p._id === currentPedido._id)
  const hasPrev = currentIndexInCluster > 0
  const hasNext = currentIndexInCluster < clusterOrders.length - 1

  const goToPrev = () => {
    if (hasPrev) {
      const prevPedido = clusterOrders[currentIndexInCluster - 1]
      setCurrentPedido(prevPedido)
      onNavigate(prevPedido)
    }
  }

  const goToNext = () => {
    if (hasNext) {
      const nextPedido = clusterOrders[currentIndexInCluster + 1]
      setCurrentPedido(nextPedido)
      onNavigate(nextPedido)
    }
  }

  const { minutes } = getTimeElapsed(currentPedido.createdAt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header com navegação INTRA-GRUPO */}
        <div className="bg-gray-50 px-6 py-5 border-b">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#7f22fe] flex items-center justify-center">
                <i className="fas fa-receipt text-white"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                  Pedido #{currentPedido._id.slice(-4).toUpperCase()}
                  {minutes > 0 && <span className="text-sm font-normal text-gray-600">({minutes}min)</span>}
                </h2>
                <span className="text-xs px-3 py-1 rounded-full bg-purple-100 text-[#7f22fe] font-medium">
                  {currentPedido.status}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200">
              <i className="fas fa-times"></i>
            </button>
          </div>

          {/* NAVEGAÇÃO PREV/NEXT DENTRO DO GRUPO */}
          {currentPedido.clusterId && clusterOrders.length > 1 && (
            <div className="flex items-center gap-3 mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <button
                onClick={goToPrev}
                disabled={!hasPrev}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  hasPrev
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <i className="fas fa-chevron-left"></i>
                Anterior
              </button>
              
              <div className="flex-1 text-center">
                <p className="text-xs font-bold text-blue-900">
                  Pedido {currentIndexInCluster + 1} de {clusterOrders.length}
                </p>
                <p className="text-[10px] text-blue-700">do mesmo grupo</p>
              </div>
              
              <button
                onClick={goToNext}
                disabled={!hasNext}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  hasNext
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Próximo
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">
          {/* WhatsApp */}
          {currentPedido.cliente?.telefone && (
            <button 
              onClick={handleWhatsApp}
              className="w-full flex items-center justify-center gap-2 py-3 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg font-bold"
            >
              <i className="fab fa-whatsapp text-xl"></i>
              <span>Conversar com {currentPedido.cliente.nome.split(' ')[0]} ({currentPedido.cliente.telefone})</span>
            </button>
          )}

          {/* Itens */}
          <div className="space-y-3">
            {currentPedido.itens.map((item, idx) => (
              <div key={idx} className="bg-gray-50 border rounded-lg p-4">
                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-lg bg-[#7f22fe] flex items-center justify-center font-bold text-white">
                    {item.quantidade}x
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-gray-900 font-semibold">{item.nome}</p>
                      <p className="text-gray-900 font-bold">{formatCurrency(item.precoUnitario * item.quantidade)}</p>
                    </div>
                    {item.complementos?.length > 0 && (
                      <p className="text-sm text-gray-600">+ {item.complementos.join(', ')}</p>
                    )}
                    {item.obs && (
                      <div className="inline-flex items-center gap-2 text-xs bg-yellow-100 text-yellow-800 px-3 py-1.5 rounded-lg mt-2">
                        <i className="fas fa-sticky-note"></i>
                        {item.obs}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Entrega + Pagamento */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-5">
              <h3 className="font-bold text-blue-900 uppercase text-xs mb-4 flex items-center gap-2">
                <i className="fas fa-map-marker-alt"></i> Entrega
              </h3>
              {currentPedido.enderecoEntrega ? (
                <>
                  <p className="text-gray-900 font-semibold text-sm">{currentPedido.enderecoEntrega.rua}, {currentPedido.enderecoEntrega.numero}</p>
                  <p className="text-gray-600 text-xs mb-3">{currentPedido.enderecoEntrega.bairro} - {currentPedido.enderecoEntrega.cidade}</p>
                  <div className="space-y-2">
                    <button
                      onClick={openGoogleMaps}
                      className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-bold"
                    >
                      <i className="fas fa-map-marked-alt mr-2"></i>Ver no Mapa
                    </button>
                    
                    {/* BOTÃO CRIAR ROTA no modal */}
                    {currentPedido.clusterId && clusterOrders.length > 1 && (
                      <button
                        onClick={createClusterRoute}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                      >
                        <i className="fas fa-route mr-2"></i>Criar Rota ({clusterOrders.length} pedidos)
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-gray-700 bg-white p-3 rounded">
                  <i className="fas fa-store"></i>
                  <span className="font-medium">Retirada no Balcão</span>
                </div>
              )}

              {/* Lista compacta de pedidos do grupo */}
              {currentPedido.clusterId && currentPedido.clusterDistances?.length > 0 && (
                <div className="mt-4 bg-white rounded-lg p-4 border border-blue-200">
                  <p className="text-xs font-bold text-blue-900 mb-3 flex items-center gap-2">
                    <i className="fas fa-route"></i>Outros Pedidos da Rota:
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {currentPedido.clusterDistances.map((nearby, idx) => (
                      <button
                        key={idx}
                        onClick={() => navigateToOrder(nearby.orderId)}
                        className="w-full flex items-center justify-between p-2 rounded bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all text-left"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">
                            {idx + 1}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-blue-900">#{nearby.orderNumber}</p>
                            <p className="text-[10px] text-gray-600 truncate max-w-[150px]">{nearby.address}</p>
                          </div>
                        </div>
                        <span className="text-xs font-bold bg-blue-500 text-white px-2 py-1 rounded">
                          {nearby.distance.toFixed(1)}km
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-5">
              <h3 className="font-bold text-emerald-900 uppercase text-xs mb-4 flex items-center gap-2">
                <i className="fas fa-wallet"></i> Pagamento
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span className="font-semibold">{formatCurrency(currentPedido.subtotal)}</span>
                </div>
                {currentPedido.desconto > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Desconto</span>
                    <span className="font-semibold">-{formatCurrency(currentPedido.desconto)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-900 font-bold text-xl pt-3 border-t border-emerald-200">
                  <span>Total</span>
                  <span className="text-[#7f22fe]">{formatCurrency(currentPedido.total)}</span>
                </div>
                <div className="flex items-center justify-center gap-3 p-3 rounded-lg bg-white border border-emerald-200">
                  <span className="text-xs uppercase font-bold">{currentPedido.formaPagamento?.replace(/_/g, ' ')}</span>
                  <span className={`text-xs font-bold px-2 py-1 rounded ${
                    currentPedido.statusPagamento === 'aprovado' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {currentPedido.statusPagamento?.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 p-6 border-t flex gap-4">
          <button onClick={() => onPrint(currentPedido)} className="flex-1 py-4 rounded-lg bg-white hover:bg-gray-100 border-2 border-gray-300 font-bold">
            <i className="fas fa-print mr-2"></i>Imprimir
          </button>
          {currentPedido.status !== 'Entregue' && (
            <button 
              onClick={() => { onAdvance(currentPedido); onClose(); }} 
              disabled={isLoading}
              className="flex-[2] py-4 rounded-lg font-bold text-white bg-[#7f22fe] hover:bg-[#6b1de0]"
            >
              <i className="fas fa-arrow-right mr-2"></i>Avançar Etapa
            </button>
          )}
        </div>
      </div>
    </div>
  )
}