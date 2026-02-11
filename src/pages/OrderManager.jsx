import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import electronAPI from '@utils/electronBridge'

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

  const [pedidosPendentes, setPedidosPendentes] = useState([]) // PIX Pendente
  const [pedidosRecusados, setPedidosRecusados] = useState([]) // PIX Recusado (NOVO)
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [printers, setPrinters] = useState([])
  const [loadingOrderId, setLoadingOrderId] = useState(null) // Estado de loading por pedido
  const [isFullScreen, setIsFullScreen] = useState(false) // Estado de tela cheia
  
  const processedOrderIds = useRef(new Set())
  const navigate = useNavigate()

  const [settings, setSettings] = useState({
    impressoraAutomatica: localStorage.getItem('impressoraAutomatica') || '',
    aceitarAutomatico: localStorage.getItem('aceitarAutomatico') !== 'false',
    notificacoesPush: localStorage.getItem('notificacoesPush') === 'true',
    somNotificacao: localStorage.getItem('somNotificacao') !== 'false',
    tempoRefresh: Math.max(10, Math.min(30, parseInt(localStorage.getItem('tempoRefresh')) || 10))
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
    Object.keys(newSettings).forEach(key => localStorage.setItem(key, newSettings[key]))
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
      
      // --- LÓGICA DE FILTRO DE PAGAMENTO (MELHORADA) ---
      const pedidosConfirmados = []
      const aguardandoPagamento = []
      const pagamentosRecusados = [] // NOVO

      sorted.forEach(p => {
        const isPixOnline = p.formaPagamento?.includes('pix') || p.formaPagamento === 'online_pix'
        const isPendente = p.statusPagamento === 'pendente'
        const isRecusado = p.statusPagamento === 'recusado' // NOVO

        if (isPixOnline && isPendente) {
          aguardandoPagamento.push(p)
        } else if (isPixOnline && isRecusado) {
          pagamentosRecusados.push(p) // NOVO - Separa recusados
        } else {
          pedidosConfirmados.push(p)
        }
      })
      
      setPedidosPendentes(aguardandoPagamento)
      setPedidosRecusados(pagamentosRecusados) // NOVO
      
      // --- FIM LÓGICA FILTRO ---

      // Aceite automático apenas para confirmados
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

    // Validação PIX removida - já foi filtrado antes
    setLoadingOrderId(pedido._id) // Inicia loading

    try {
      await apiUpdateStatus(pedido._id, nextStatus)
      if (nextStatus === 'Em preparação' && settings.impressoraAutomatica) {
        handlePrint(pedido)
      }
      await fetchPedidos()
    } catch (err) {
      console.error('Erro ao avançar status', err)
    } finally {
      setLoadingOrderId(null) // Remove loading
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

  const columns = useMemo(() => ({
    pendente: pedidos.filter(p => !p.status || p.status === 'Recebido'),
    preparo: pedidos.filter(p => p.status === 'Em preparação'),
    entrega: pedidos.filter(p => ['Saiu para entrega', 'Saiu para Entrega'].includes(p.status)),
    concluido: pedidos.filter(p => p.status === 'Entregue'),
  }), [pedidos])

  const totalDia = columns.concluido.reduce((acc, curr) => acc + (curr.total || 0), 0)

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.log(err))
    } else {
      document.exitFullscreen()
    }
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      
      {/* Header Melhorado */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="w-full px-4 py-3 flex items-center justify-between">
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

          <div className="flex items-center gap-3">
            {/* Alerta PIX Recusado (NOVO) */}
            {pedidosRecusados.length > 0 && (
              <button
                onClick={() => setSelectedOrder(pedidosRecusados[0])}
                className="hidden md:flex items-center gap-2 px-3 py-2 bg-red-50 border-2 border-red-300 rounded-lg text-red-700 hover:bg-red-100 transition-colors animate-pulse"
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
            
            {/* Botão Fullscreen com ícone dinâmico */}
            <button 
              onClick={toggleFullScreen}
              className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 transition-colors"
              title={isFullScreen ? "Sair da Tela Cheia" : "Tela Cheia"}
            >
              <i className={`fas ${isFullScreen ? 'fa-compress' : 'fa-expand'} text-sm`}></i>
            </button>

            <button 
              onClick={fetchPedidos} 
              className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 transition-colors active:scale-95"
              title="Atualizar"
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
            >
              <i className="fas fa-cog text-sm"></i>
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-81px)]">
        {/* Kanban Board */}
        <main className={`flex-1 p-6 overflow-x-auto overflow-y-hidden transition-all duration-300 bg-gray-50 ${showSettings ? 'mr-96' : ''}`}>
          
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
                />
              ))}
            </KanbanColumn>

          </div>
        </main>

        {/* Sidebar Configurações */}
        <aside className={`fixed top-[81px] right-0 h-[calc(100vh-81px)] w-96 bg-white border-l border-gray-200 shadow-xl transition-all duration-300 z-40 overflow-y-auto ${showSettings ? 'translate-x-0' : 'translate-x-full'}`}>
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
                >
                  <option value="">Manual (Sem impressão auto)</option>
                  {printers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                
                <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200 hover:border-gray-300 transition-colors">
                  <span className="text-sm text-gray-900 font-medium">Aceitar Automaticamente</span>
                  <Switch checked={settings.aceitarAutomatico} onChange={() => saveSettings({...settings, aceitarAutomatico: !settings.aceitarAutomatico})} />
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
                  <Switch checked={settings.notificacoesPush} onChange={handleToggleNotification} />
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200 hover:border-gray-300 transition-colors">
                  <span className="text-sm text-gray-900 font-medium">Efeito Sonoro</span>
                  <Switch checked={settings.somNotificacao} onChange={() => saveSettings({...settings, somNotificacao: !settings.somNotificacao})} />
                </div>
              </div>
            </section>

            <div className="pt-6 border-t border-gray-200">
              <div className="p-6 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-center mb-4">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-md">
                    <i className="fas fa-bolt text-2xl text-white"></i>
                  </div>
                  <h4 className="font-bold text-gray-900 text-lg mb-1">NEXFOOD</h4>
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
                  navigate('/login') }} 
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

      <style>{`
        .slider-purple::-webkit-slider-thumb {
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #7f22fe;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .slider-purple::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #7f22fe;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
      `}</style>
    </div>
  )
}

// --- Componentes ---

function Switch({ checked, onChange }) {
  return (
    <button 
      onClick={onChange} 
      className={`relative w-12 h-6 rounded-full transition-colors ${
        checked ? 'bg-[#7f22fe]' : 'bg-gray-300'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
        checked ? 'translate-x-6' : ''
      }`}/>
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
             <i className={`fas fa-${icon}`}></i>
          </div>
          <span className="uppercase tracking-tight text-sm">{title}</span>
        </div>
        <span className="bg-gray-800 px-2.5 py-0.5 rounded-md text-xs font-bold text-white">
          {count}
        </span>
      </div>
      
      <div className="flex-1 p-2 overflow-y-auto custom-scrollbar">
        {children.length > 0 ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>

            {children}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center opacity-40">
            <i className={`fas fa-${icon} text-3xl mb-2`}></i>
            <span className="text-sm font-medium">Vazio</span>
          </div>
        )}
      </div>
    </div>
  )
}

function OrderCard({ pedido, onClick, onAdvance, onPrint, isDone, color, isLoading }) {
  const colorThemes = {
    purple: 'border-l-4 border-l-[#7f22fe]',
    orange: 'border-l-4 border-l-orange-500',
    blue: 'border-l-4 border-l-blue-500',
    emerald: 'border-l-4 border-l-emerald-500 opacity-60 grayscale-[0.5]',
  }

  return (
    <div 
      onClick={onClick} 
      className={`relative bg-white p-4 rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer border border-gray-200 group ${colorThemes[color]} min-w-[280px] sm:min-w-[300px]`}
    >
      {/* Cabeçalho do Card - FONTE MAIOR */}
      <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
        <div>
          <span className="text-sm font-black text-gray-900 block">
             #{pedido._id.slice(-4).toUpperCase()}
          </span>
          <span className="text-xs text-gray-600 font-semibold">
            {formatTime(pedido.createdAt)}
          </span>
        </div>
        <div className="text-right">
           <span className="text-base font-black text-gray-900 block">{formatCurrency(pedido.total)}</span>
           <span className="text-xs uppercase font-bold text-gray-600">{pedido.tipo}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 bg-gray-50 p-2 rounded border border-gray-100">
        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
          <i className="fas fa-user text-xs"></i>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {pedido.cliente?.nome || 'Consumidor'}
          </p>
          {pedido.cliente?.totalPedidos > 1 && (
            <p className="text-[10px] text-emerald-600 font-bold leading-none">
              ★ {pedido.cliente.totalPedidos}º Pedido
            </p>
          )}
        </div>
      </div>

      {/* Lista de Itens - FONTE MAIOR E LEGÍVEL */}
      <div className="space-y-2 mb-4 min-h-[80px]">
        {pedido.itens.map((item, idx) => (
          <div key={idx} className="text-sm leading-relaxed">
            <div className="flex items-start gap-1">
              <span className="font-black text-gray-900 min-w-[24px]">{item.quantidade}x</span>
              <span className="text-gray-800 font-semibold flex-1">{item.nome}</span>
            </div>
            
            {/* Complementos com melhor contraste */}
            {item.complementos?.length > 0 && (
              <p className="text-xs text-gray-600 ml-6 mt-1 leading-snug font-medium">
                + {item.complementos.join(', ')}
              </p>
            )}
            
            {/* OBS destacada */}
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
          >
             <i className="fas fa-print text-sm"></i>
          </button>
          
          <button 
            onClick={(e) => { e.stopPropagation(); onAdvance() }}
            disabled={isLoading}
            className={`flex-1 py-2.5 rounded-lg text-sm font-black text-white shadow-sm flex items-center justify-center gap-2 transition-all ${
              isLoading 
                ? 'bg-gray-400 cursor-wait' 
                : 'bg-gray-900 hover:bg-black active:scale-95'
            }`}
          >
            {isLoading ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                <span>PROCESSANDO...</span>
              </>
            ) : (
              <>
                <span>AVANÇAR</span>
                <i className="fas fa-chevron-right text-xs"></i>
              </>
            )}
          </button>
        </div>
      )}
      
      {/* Ícone de expandir FORA do card para não cobrir texto */}
      <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full w-6 h-6 flex items-center justify-center shadow-md border border-gray-200">
         <i className="fas fa-expand-alt text-gray-500 text-xs"></i>
      </div>
    </div>
  )
}

function OrderModal({ pedido, onClose, onPrint, onAdvance, isLoading }) {
   const handleWhatsApp = () => {
    if (!pedido.cliente?.telefone) return
    // Remove caracteres não numéricos
    const phone = pedido.cliente.telefone.replace(/\D/g, '')
    // Adiciona 55 se não tiver
    const fullPhone = phone.length <= 11 ? `55${phone}` : phone
    
    const msg = `Olá ${pedido.cliente.nome}, tudo bem? Aqui é do NexFood. Estamos entrando em contato sobre seu pedido #${pedido._id.slice(-4).toUpperCase()}.`
    
    window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`, '_blank')
  }
  
  const isPixRecusado = (pedido.formaPagamento === 'pix' || pedido.formaPagamento === 'online_pix') 
                         && pedido.statusPagamento === 'recusado'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      <div className="relative w-full max-w-3xl bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gray-50 px-6 py-5 flex items-center justify-between border-b border-gray-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-[#7f22fe] flex items-center justify-center shadow-sm">
              <i className="fas fa-receipt text-white"></i>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                Pedido #{pedido._id.slice(-4).toUpperCase()}
              </h2>
              <span className="text-xs px-3 py-1 rounded-full bg-purple-100 text-[#7f22fe] border border-purple-200 font-medium inline-block mt-1">
                {pedido.status}
              </span>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 hover:text-gray-900 transition-colors"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">

            {/* Alerta PIX Recusado */}
            {isPixRecusado && (
              <div className="rounded-xl bg-red-50 border-2 border-red-400 p-6">
                <div className="flex items-start gap-4 text-red-900">
                  <div className="w-14 h-14 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
                    <i className="fas fa-ban text-2xl text-white"></i>
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
              >
                <i className="fab fa-whatsapp text-xl"></i>
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
                          <i className="fas fa-sticky-note"></i>
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
                  <i className="fas fa-map-marker-alt"></i> Entrega
                </h3>
                <div className="space-y-2 text-sm">
                  {pedido.enderecoEntrega ? (
                    <>
                      <p className="text-gray-900 font-semibold">{pedido.enderecoEntrega.rua}, {pedido.enderecoEntrega.numero}</p>
                      <p className="text-gray-600 text-xs">{pedido.enderecoEntrega.bairro} - {pedido.enderecoEntrega.cidade}</p>
                      {pedido.enderecoEntrega.complemento && (
                        <p className="text-gray-600 text-xs italic mt-2 bg-white p-2 rounded border border-blue-100">
                          {pedido.enderecoEntrega.complemento}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-700 bg-white p-3 rounded border border-blue-200">
                      <i className="fas fa-store"></i>
                      <span className="font-medium">Retirada no Balcão</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-5">
                <h3 className="font-bold text-emerald-900 uppercase text-xs mb-4 flex items-center gap-2">
                  <i className="fas fa-wallet"></i> Pagamento
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
          >
            <i className="fas fa-print mr-2"></i>
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
            >
              {isLoading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-arrow-right mr-2"></i>
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