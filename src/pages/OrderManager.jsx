import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  createContext,
  useContext,
} from 'react'
import { useNavigate } from 'react-router-dom'
import electronAPI from '@utils/electronBridge'
import { useOrderClustering } from '@hooks/useOrderClustering'
import { ClusterFloatingCard } from '../components/ClusterFloatingCard'
import { notifyOrderStatus } from '@utils/nexBotNotify'
import { useNexBotStatus } from '@hooks/useNexBotStatus'
import { apiFetch } from '../utils/apiFetch'
import { PEDIDO_TESTE_IMPRESSAO } from '../components/PedidoTeste'

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETONS DE MÓDULO
// Criados uma única vez quando o bundle carrega.
// Sobrevivem a remounts do componente — evitam dupla impressão e dupla chamada
// à Box Delivery mesmo que React desmonte e remonte (StrictMode, troca de rota).
// ─────────────────────────────────────────────────────────────────────────────

/** Set global de IDs já processados — persiste entre remounts */
const globalProcessedIds = new Set()

/**
 * Instância única do áudio de notificação.
 * preload="auto" faz o browser baixar o arquivo imediatamente,
 * eliminando o delay na primeira notificação.
 */
const notificationAudio = new Audio(
  'https://painel.nexfood.app/sounds/notification.mp3'
)
notificationAudio.preload = 'auto'

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS DE FORMATAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

const formatCurrency = (val) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    val || 0
  )

const formatTime = (dateStr) => {
  if (!dateStr) return '--:--'
  return new Date(dateStr).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

const getOrderNumber = (pedido) =>
  pedido?.numeroPedido || pedido?._id?.slice(-4).toUpperCase() || '----'

const getTimeElapsed = (dateStr) => {
  if (!dateStr) return { minutes: 0, isUrgent: false }
  const minutes = Math.floor((Date.now() - new Date(dateStr)) / 60000)
  return { minutes, isUrgent: minutes > 30 }
}

/**
 * Mapeia o status atual para o próximo na esteira do Kanban.
 * Centralizado aqui para evitar lógica duplicada em advanceStatus e OrderCard.
 */
const getNextStatus = (currentStatus) => {
  const map = {
    Recebido: 'Em preparação',
    'Em preparação': 'Saiu para entrega',
    'Saiu para entrega': 'Entregue',
  }
  return map[currentStatus] || null
}

// ─────────────────────────────────────────────────────────────────────────────
// TICK CONTEXT — timer global único para todos os countdowns
//
// Problema anterior: cada OrderCard rodava seu próprio setInterval(1s).
// Com 30 cards ativos = 30 timers simultâneos no thread principal.
//
// Solução: 1 único Context que bate a cada segundo. Cada card apenas lê
// o valor — zero timers próprios. Redução de ~96% nos intervalos ativos.
// ─────────────────────────────────────────────────────────────────────────────

const TickContext = createContext(Date.now())

function TickProvider({ children }) {
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return <TickContext.Provider value={tick}>{children}</TickContext.Provider>
}

const useTick = () => useContext(TickContext)

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: useCountdown
// Calcula tempo restante a partir do tick global — sem setInterval próprio.
// ─────────────────────────────────────────────────────────────────────────────

function useCountdown(createdAt, estimatedMinutes = 40) {
  const now = useTick()
  const elapsedSecs = Math.floor((now - new Date(createdAt)) / 1000)
  const totalSecs = estimatedMinutes * 60
  const remaining = Math.max(0, totalSecs - elapsedSecs)
  const overdueSecs = remaining === 0 ? Math.max(0, elapsedSecs - totalSecs) : 0

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0')
  const secs = String(remaining % 60).padStart(2, '0')

  return {
    display: `${mins}:${secs}`,
    isLate: remaining === 0,
    isWarning: remaining > 0 && remaining < 600, // menos de 10 min
    overdueMinutes: Math.floor(overdueSecs / 60),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: useFocusTrap
// Prende o foco dentro de um container enquanto isActive=true.
// WCAG 2.1 critério 2.4.3 (Focus Order) — obrigatório em modais.
// Restaura o foco no elemento que estava ativo antes de abrir o modal.
// ─────────────────────────────────────────────────────────────────────────────

function useFocusTrap(isActive, onEscape) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const focusable = Array.from(
      containerRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), ' +
          'select:not([disabled]), textarea:not([disabled]), ' +
          '[tabindex]:not([tabindex="-1"])'
      )
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const previouslyFocused = document.activeElement

    // setTimeout 0 garante que o foco só mova após o DOM estar pintado
    const focusTimer = setTimeout(() => first?.focus(), 0)

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onEscape?.()
        return
      }
      if (e.key !== 'Tab') return
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      // Devolve foco ao elemento que estava ativo antes de abrir o modal
      previouslyFocused?.focus()
    }
  }, [isActive, onEscape])

  return containerRef
}

// ─────────────────────────────────────────────────────────────────────────────

function useRestaurantConfig() {
  return useMemo(() => {
    const cnpjRaw = localStorage.getItem('cnpjRestaurante') || ''
    const cnpjFormatado =
      cnpjRaw.length === 14
        ? cnpjRaw.replace(
            /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
            '$1.$2.$3/$4-$5'
          )
        : cnpjRaw

    return {
      nome: localStorage.getItem('nomeRestaurante') || 'Restaurante',
      endereco: localStorage.getItem('enderecoRestaurante') || '',
      cnpj: cnpjFormatado,
    }
  }, []) // [] = lê uma única vez por mount do componente
}

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY SEARCH
// ─────────────────────────────────────────────────────────────────────────────

const fuzzyMatch = (text, query) => {
  if (!query) return true
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERIZAÇÃO DO CUPOM TÉRMICO (80mm)
//
// Mudança: agora recebe restaurantConfig como parâmetro em vez de
// chamar localStorage.getItem a cada invocação — crítico no modo
// auto-aceitar onde a função é chamada em loop.
// ─────────────────────────────────────────────────────────────────────────────

const renderPedidoToHTML = (pedido, restaurantConfig = {}, printConfig = {}) => {
  const {
    nome: nomeRestaurante = 'Restaurante',
    endereco: enderecoRestaurante = '',
    cnpj: cnpjFormatado = '',
  } = restaurantConfig

  const { fonteTamanho = 12, negritar = false } = printConfig

  // Escala proporcional derivada do tamanho base escolhido
  const t = {
    base:  `${fonteTamanho}px`,
    title: `${Math.round(fonteTamanho * 1.35)}px`,
    lg:    `${Math.round(fonteTamanho * 1.1)}px`,
    total: `${Math.round(fonteTamanho * 1.45)}px`,
    sm:    `${Math.max(9, fonteTamanho - 1)}px`,
    xs:    `${Math.max(8, fonteTamanho - 2)}px`,
    wHeavy: '900',
    wBold:  negritar ? '900' : '800',
    wMid:   negritar ? '800' : '700',
    wBase:  negritar ? '700' : 'normal',
  }

  const itensHtml = pedido.itens
    .map((item) => {
      const totalItem = item.precoUnitario * item.quantidade
      const nomeItem = item.nome.replace(/\s*\(padrão\)/gi, '').trim()
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
            <span class="name">${nomeItem}</span>
            <span class="item-price">${formatCurrency(totalItem)}</span>
          </div>
          ${complementosHtml}${obsHtml}
        </div>`
    })
    .join('')

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          /* ── Tokens derivados das preferências do restaurante ── */
          :root {
            --fs-base:  ${t.base};
            --fs-title: ${t.title};
            --fs-lg:    ${t.lg};
            --fs-total: ${t.total};
            --fs-sm:    ${t.sm};
            --fs-xs:    ${t.xs};
            --fw-heavy: ${t.wHeavy};
            --fw-bold:  ${t.wBold};
            --fw-mid:   ${t.wMid};
            --fw-base:  ${t.wBase};
          }

          @page { margin: 0; size: 72mm auto; }
          html, body { height: auto !important; overflow: hidden; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }

          body {
            font-family: 'Courier New', Courier, monospace;
            width: 70mm;
            margin: 0;
            padding: 4px 6px 2px 6px;
            color: #000;
            font-size: var(--fs-base);
            font-weight: var(--fw-base);
            line-height: 1.5;
            -webkit-font-smoothing: none;
            display: inline-block;
          }

          .text-center  { text-align: center; }
          .title        { font-size: var(--fs-title); font-weight: var(--fw-heavy); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 1px; }
          .restaurant-address { font-size: var(--fs-sm); font-weight: var(--fw-bold); color: #000; margin-bottom: 6px; }
          .subtitle     { font-size: var(--fs-base); font-weight: var(--fw-bold); color: #000; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
          .info-group   { margin-bottom: 8px; }
          .info-label   { font-size: var(--fs-sm); text-transform: uppercase; font-weight: var(--fw-heavy); color: #000; border-bottom: 1px solid #000; margin-bottom: 3px; }
          .info-value   { font-size: var(--fs-lg); font-weight: var(--fw-bold); color: #000; }
          .info-sub     { font-size: var(--fs-base); font-weight: var(--fw-mid); color: #000; }
          .divider-bold { border-top: 2px solid #000; margin: 8px 0; }
          .divider      { border-top: 1px dashed #000; margin: 8px 0; }
          .item-row     { margin-bottom: 8px; }
          .item-header  { display: flex; align-items: flex-start; justify-content: space-between; }
          .qty          { font-weight: var(--fw-heavy); margin-right: 5px; font-size: var(--fs-lg); min-width: 22px; color: #000; }
          .name         { font-weight: var(--fw-bold); flex: 1; font-size: var(--fs-base); word-break: break-word; color: #000; }
          .item-price   { font-weight: var(--fw-heavy); font-size: var(--fs-base); color: #000; text-align: right; white-space: nowrap; margin-left: 4px; min-width: 52px; }
          .complementos { margin-left: 27px; font-size: var(--fs-sm); font-weight: var(--fw-bold); color: #000; }
          .obs          { margin-left: 27px; margin-top: 3px; font-weight: var(--fw-heavy); font-size: var(--fs-sm); border-left: 3px solid #000; padding-left: 4px; color: #000; }
          .totals-row   { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: var(--fs-base); font-weight: var(--fw-bold); color: #000; }
          .total-big    { font-size: var(--fs-total); font-weight: var(--fw-heavy); margin-top: 5px; color: #000; }
          .payment-box  { border: 2px solid #000; padding: 5px; margin-top: 8px; text-align: center; font-weight: var(--fw-heavy); font-size: var(--fs-lg); color: #000; }
          .footer       { margin-top: 8px; margin-bottom: 0; text-align: center; font-size: var(--fs-sm); font-weight: var(--fw-bold); color: #000; border-top: 2px dashed #000; padding-top: 6px; padding-bottom: 4px; }
          .fiel         { font-size: var(--fs-sm); font-weight: var(--fw-heavy); color: #000; margin-top: 2px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">${nomeRestaurante}</div>
          ${cnpjFormatado ? `<div class="restaurant-address">CNPJ ${cnpjFormatado}</div>` : ''}
          ${enderecoRestaurante ? `<div class="restaurant-address">${enderecoRestaurante}</div>` : ''}
          <div class="subtitle">
            ${formatDate(pedido.createdAt)} — ${formatTime(pedido.createdAt)}<br/>
            PEDIDO #${getOrderNumber(pedido)}
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
            <div class="info-value">${pedido.enderecoEntrega.rua}, ${pedido.enderecoEntrega.numero}</div>
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
        <div class="info-value">${
          { dinheiro: 'Dinheiro', pix: 'Pix na Entrega', debito_maq: 'Maquininha',
            cartao: 'Cartão na Entrega', online_card: 'Cartão Online',
            pix_online: 'Pix Online', mercadopago: 'Mercado Pago' }[pedido.formaPagamento]
          || pedido.formaPagamento?.replace(/_/g, ' ').toUpperCase()
        }</div>
        ${pedido.trocoPara ? `<div class="info-sub">Troco para: ${formatCurrency(pedido.trocoPara)}</div>` : ''}

        <div class="footer">
          ${nomeRestaurante} • Obrigado pela preferência!<br/>
          NEXFOOD - Tecnologia para Delivery<br/>
          NEX07 • CNPJ 63.805.056/0001-33
        </div>
      </body>
    </html>
  `
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL — OrderManager
// ─────────────────────────────────────────────────────────────────────────────

export default function OrderManager() {
  // ── Estado principal ──────────────────────────────────────────────────────
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

  // ── Estado do indicador "Atualizado há Xs" ────────────────────────────────
  const [lastUpdated, setLastUpdated] = useState(null)
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0)

  // ── Busca e filtros ───────────────────────────────────────────────────────
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

  // ── Sistema de toasts ─────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 6000) => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type, duration }])
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      duration
    )
  }, [])

  // ── Box Delivery: lido do storage uma vez (sem volatile deps) ─────────────
  const boxDeliveryAtivo = useMemo(() => {
    try {
      const data = JSON.parse(
        localStorage.getItem('nexfood_integracoes') ||
          sessionStorage.getItem('nexfood_integracoes') ||
          '{}'
      )
      return data?.boxDelivery?.ativo === true
    } catch {
      return false
    }
  }, [])

  // ── Ref ao Set global de IDs (singleton de módulo) ────────────────────────
  const processedOrderIds = useRef(globalProcessedIds)

  // ── Ref do AbortController para cancelar fetches obsoletos ───────────────
  const abortControllerRef = useRef(null)

  const navigate = useNavigate()
  const nexBotStatus = useNexBotStatus()
  const restaurantConfig = useRestaurantConfig()

  // ── Configurações — inicializadas do localStorage de forma síncrona ───────
  const [settings, setSettings] = useState({
    impressoraAutomatica: localStorage.getItem('impressoraAutomatica') || '',
    aceitarAutomatico: localStorage.getItem('aceitarAutomatico') !== 'false',
    notificacoesPush: localStorage.getItem('notificacoesPush') === 'true',
    somNotificacao: localStorage.getItem('somNotificacao') !== 'false',
    tempoRefresh: Math.max(
      10,
      Math.min(30, parseInt(localStorage.getItem('tempoRefresh')) || 10)
    ),
    agruparPorDistancia:
      localStorage.getItem('agruparPorDistancia') === 'true',
    raioCluster: parseFloat(localStorage.getItem('raioCluster')) || 2,
    enderecoRestaurante:
      localStorage.getItem('enderecoRestaurante') ||
      'Av. Paulista, 1578, São Paulo, SP',
    tempoJanela: parseInt(localStorage.getItem('tempoJanela')) || 30,
    capacidadeEntrega:
      parseInt(localStorage.getItem('capacidadeEntrega')) || 4,
    chamarEntregadorAuto:
      localStorage.getItem('chamarEntregadorAuto') !== 'false',
    fonteTamanho: parseInt(localStorage.getItem('fonteTamanho')) || 12,  // ← faltava
    negritar: localStorage.getItem('negritar') === 'true',
  })

  /**
   * settingsRef — espelho mutable das settings.
   *
   * Problema anterior: fetchPedidos dependia de [settings.aceitarAutomatico,
   * settings.impressoraAutomatica], forçando o useEffect a recriar o setInterval
   * sempre que qualquer config mudava (incluindo tempoRefresh), causando
   * um burst de requisições paralelas no momento da mudança.
   *
   * Solução: funções de callback leem settingsRef.current no momento da
   * execução, mantendo deps estáveis e o setInterval estável.
   */
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  // ── Timer "Atualizado há Xs" ───────────────────────────────────────────────
  useEffect(() => {
    if (!lastUpdated) return
    setSecondsSinceUpdate(0)
    const id = setInterval(() => {
      setSecondsSinceUpdate(Math.floor((Date.now() - lastUpdated) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  // ── Monitorar estado de tela cheia ────────────────────────────────────────
  useEffect(() => {
    const handleChange = () => setIsFullScreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  // ── Bloqueio de suspensão enquanto o gestor estiver aberto ───────────────
  useEffect(() => {
    if (!electronAPI.isElectron()) return
    electronAPI.setPowerBlocker(true)
    return () => { electronAPI.setPowerBlocker(false) }
  }, [])

  useEffect(() => {
  if (!electronAPI.isElectron()) return
  electronAPI.onKitchenReady(() => {
    electronAPI.pushKitchenOrders(
      pedidos.filter(p => p.status === 'Em preparação')
    )
  })
}, [pedidos])

  // ── Carregar impressoras disponíveis (Electron only) ──────────────────────
  useEffect(() => {
    const loadPrinters = async () => {
      if (!electronAPI?.isElectron?.()) return
      const res = await electronAPI.getPrinters()
      if (res?.success && Array.isArray(res.printers)) {
        setPrinters(res.printers)
        if (res.printers.length > 0 && !settingsRef.current.impressoraAutomatica) {
          saveSettings({
            ...settingsRef.current,
            impressoraAutomatica: res.printers[0].name,
          })
        }
      }
    }
    loadPrinters()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── saveSettings: persiste no localStorage e atualiza o state ─────────────
  const saveSettings = useCallback((newSettings) => {
    Object.keys(newSettings).forEach((key) => {
      const value = newSettings[key]
      localStorage.setItem(
        key,
        value === null || value === undefined ? '' : String(value)
      )
    })
    setSettings(newSettings)
  }, [])

  // ── Áudio: reutiliza o singleton, reseta o playhead antes de tocar ────────
  const playNotificationSound = useCallback(() => {
    if (!settingsRef.current.somNotificacao) return
    notificationAudio.currentTime = 0
    notificationAudio.play().catch((e) => console.error('Erro áudio:', e))
  }, [])

  // ── Push notification (Electron ou Web Notification API) ─────────────────
  const sendPushNotification = useCallback((title, body) => {
    if (!settingsRef.current.notificacoesPush) return
    if (electronAPI?.isElectron?.()) {
      electronAPI.sendNotification(title, body)
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/logo.png' })
    }
  }, [])

  // ── Impressão: restaurantConfig passado como parâmetro (sem getItem extra) ─
  const handlePrint = useCallback(
    async (pedido) => {
      const html = renderPedidoToHTML(pedido, restaurantConfig, {
        fonteTamanho: settingsRef.current.fonteTamanho,
        negritar: settingsRef.current.negritar,
      })

      if (electronAPI?.isElectron?.() && settingsRef.current.impressoraAutomatica) {
        await electronAPI.printOrder(settingsRef.current.impressoraAutomatica, html)
        return
      }

      const w = window.open('', '_blank', 'width=380,height=700')
      if (!w) { alert('Pop-up bloqueado! Permita pop-ups para este site.'); return }
      w.document.open()
      w.document.write(html)
      w.document.close()
      w.onload = () => {
        setTimeout(() => { w.focus(); w.print(); w.onafterprint = () => w.close() }, 200)
      }
      setTimeout(() => { if (!w.closed) { w.focus(); w.print() } }, 1500)
    },
    [restaurantConfig]
  )

  // ── Box Delivery: chama entregador na transportadora ─────────────────────
  const callBoxDelivery = useCallback(
    async (pedido) => {
      if (!boxDeliveryAtivo || !settingsRef.current.chamarEntregadorAuto) return
      if (pedido.tipo !== 'Delivery') return

      try {
        const boxRes = await apiFetch(
          `https://painel.nexfood.app/api/pedidos/${pedido._id}/box-delivery`,
          { method: 'POST' }
        )

        if (boxRes.ok) {
          const data = await boxRes.json()
          addToast(
            `🛵 Entregador chamado! Ref: ${data.boxDelivery?.uuid?.slice(0, 8)}...`,
            'success'
          )
        } else {
          let errData = {}
          try {
            errData = await boxRes.json()
          } catch {}

          const isBalanceError =
            errData?.code === 'BALANCE_ERROR' || boxRes.status === 400

          if (isBalanceError) {
            addToast(
              '⚠️ Saldo insuficiente na Box Delivery. Recarregue o saldo e entre em contato com a transportadora.',
              'error',
              14000
            )
          } else {
            addToast(
              `⚠️ Box Delivery: ${errData.message || 'Falha ao chamar entregador'} (cód: ${errData.code || boxRes.status})`,
              'warning',
              10000
            )
          }
        }
      } catch (boxErr) {
        console.error('❌ Box Delivery erro:', boxErr)
        addToast('❌ Erro ao conectar com a transportadora.', 'error')
      }
    },
    [boxDeliveryAtivo, addToast]
  )

  // ── API: atualiza status de um pedido ─────────────────────────────────────
  const apiUpdateStatus = async (id, status) => {
    return apiFetch(
      `https://painel.nexfood.app/api/pedidos/${id}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    )
  }

  // ── fetchPedidos ──────────────────────────────────────────────────────────
  //
  // Melhorias aplicadas:
  // 1. AbortController: cancela request anterior antes de iniciar um novo,
  //    e cancela ao desmontar — evita state updates em componente morto.
  // 2. settingsRef.current: lê configurações no momento da execução
  //    sem adicionar deps voláteis ao useCallback.
  // 3. Deps estáveis: [playNotificationSound, sendPushNotification,
  //    handlePrint, callBoxDelivery] — todas são useCallbacks com deps
  //    fixas, então fetchPedidos não é recriado desnecessariamente.
  // ──────────────────────────────────────────────────────────────────────────
  const fetchPedidos = useCallback(async () => {
    // Cancela qualquer request em voo antes de iniciar um novo
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    const { aceitarAutomatico, impressoraAutomatica } = settingsRef.current

    try {
      const res = await apiFetch('https://painel.nexfood.app/api/pedidos/dia', {
        signal: abortControllerRef.current.signal,
      })

      // Se não for OK (ex: 401 sem renovação), para aqui sem logar erro
      if (!res.ok) return

      const data = await res.json()

      const sorted = Array.isArray(data)
        ? data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        : []

      const pedidosConfirmados = []
      const aguardandoPagamento = []
      const pagamentosRecusados = []

      sorted.forEach((p) => {
        const isPixOnline =
          p.formaPagamento?.includes('pix') || p.formaPagamento === 'online_pix'
        const isPendente = p.statusPagamento === 'pendente'
        const isRecusado = p.statusPagamento === 'recusado'

        if (isPixOnline && isPendente) aguardandoPagamento.push(p)
        else if (isPixOnline && isRecusado) pagamentosRecusados.push(p)
        else pedidosConfirmados.push(p)
      })

      setPedidosPendentes(aguardandoPagamento)
      setPedidosRecusados(pagamentosRecusados)

      if (aceitarAutomatico) {
        const novos = pedidosConfirmados.filter(
          (p) =>
            p.status === 'Recebido' &&
            !processedOrderIds.current.has(p._id)
        )

        for (const pedido of novos) {
          processedOrderIds.current.add(pedido._id)
          playNotificationSound()
          sendPushNotification(
            'Novo Pedido Aceito!',
            `Pedido #${pedido._id.slice(-4)} enviado para cozinha.`
          )
          await apiUpdateStatus(pedido._id, 'Em preparação')
          if (impressoraAutomatica) handlePrint(pedido)
          await callBoxDelivery(pedido)
          pedido.status = 'Em preparação'
        }
      } else {
        const novosPendentes = pedidosConfirmados.filter(
          (p) =>
            p.status === 'Recebido' &&
            !processedOrderIds.current.has(p._id)
        )
        if (novosPendentes.length > 0) {
          novosPendentes.forEach((p) => processedOrderIds.current.add(p._id))
          playNotificationSound()
          sendPushNotification('Novo Pedido!', 'Você tem novos pedidos aprovados.')
        }
      }

      setPedidos(pedidosConfirmados)

      // Empurra pedidos em preparação para a janela da cozinha
      electronAPI.pushKitchenOrders(
        pedidosConfirmados.filter(p => p.status === 'Em preparação')
      )
      
      // Registra timestamp para o indicador "Atualizado há Xs"
      setLastUpdated(Date.now())
      setSecondsSinceUpdate(0)
    } catch (error) {
      // AbortError é esperado e silencioso — não é um erro real
      if (error.name === 'AbortError') return
      console.error('Erro fetch:', error)
    } finally {
      setLoading(false)
    }
  }, [playNotificationSound, sendPushNotification, handlePrint, callBoxDelivery])

  // ── Intervalo de refresh ──────────────────────────────────────────────────
  //
  // Reinicia APENAS quando tempoRefresh muda (ou fetchPedidos é recriado,
  // o que não acontece mais com os volatile deps removidos).
  // O cleanup aborta qualquer request em voo ao desmontar ou reiniciar.
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPedidos()
    const interval = setInterval(fetchPedidos, settings.tempoRefresh * 1000)
    return () => {
      clearInterval(interval)
      abortControllerRef.current?.abort()
    }
  }, [fetchPedidos, settings.tempoRefresh])

  // ── advanceStatus com atualização otimista ────────────────────────────────
  //
  // 1. Atualiza o state local imediatamente → UI responde em < 16ms
  // 2. Dispara a PATCH na API em background
  // 3. Em caso de erro, faz rollback do state e exibe toast de erro
  // 4. Em caso de sucesso, confirma com dados frescos do servidor
  // ──────────────────────────────────────────────────────────────────────────
  const advanceStatus = useCallback(
    async (pedido) => {
      const nextStatus = getNextStatus(pedido.status)
      if (!nextStatus) return

      setLoadingOrderId(pedido._id)

      // Passo 1: Atualização otimista — UI instantânea
      setPedidos((prev) =>
        prev.map((p) =>
          p._id === pedido._id ? { ...p, status: nextStatus } : p
        )
      )

      try {
        await apiUpdateStatus(pedido._id, nextStatus)
        notifyOrderStatus(pedido, nextStatus, nexBotStatus)

        if (nextStatus === 'Em preparação') {
          if (settingsRef.current.impressoraAutomatica) handlePrint(pedido)
          if (pedido.tipo === 'Delivery') await callBoxDelivery(pedido)
        }

        // Passo 2: Confirma com dados reais do servidor
        await fetchPedidos()
      } catch (err) {
        console.error('Erro ao avançar status', err)
        // Passo 3: Rollback — restaura status original
        setPedidos((prev) =>
          prev.map((p) =>
            p._id === pedido._id ? { ...p, status: pedido.status } : p
          )
        )
        addToast(
          'Erro ao atualizar status. Verifique a conexão e tente novamente.',
          'error'
        )
      } finally {
        setLoadingOrderId(null)
      }
    },
    [nexBotStatus, handlePrint, callBoxDelivery, fetchPedidos, addToast]
  )

  // ── Toggle de notificações push (solicita permissão se necessário) ────────
  const handleToggleNotification = useCallback(() => {
    const newState = !settingsRef.current.notificacoesPush
    saveSettings({ ...settingsRef.current, notificacoesPush: newState })
    if (newState) {
      if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            sendPushNotification(
              'Notificações Ativadas',
              'Tudo pronto para receber pedidos!'
            )
          }
        })
      } else {
        sendPushNotification(
          'Notificações Ativadas',
          'Tudo pronto para receber pedidos!'
        )
      }
    }
  }, [saveSettings, sendPushNotification])

  // ── Derivações memoizadas dos pedidos ─────────────────────────────────────
  const activeOrders = useMemo(
    () =>
      pedidos.filter(
        (p) =>
          p.status !== 'Entregue' &&
          p.status !== 'Cancelado' &&
          p.status !== 'Saiu para entrega'
      ),
    [pedidos]
  )

  const finishedOrders = useMemo(
    () =>
      pedidos.filter((p) =>
        ['Saiu para entrega', 'Entregue', 'Cancelado'].includes(p.status)
      ),
    [pedidos]
  )

  const clusteredActive = useOrderClustering(
    activeOrders,
    settings.agruparPorDistancia,
    settings.raioCluster,
    settings.tempoJanela,
    settings.capacidadeEntrega
  )

  const pedidosComClusters = useMemo(
    () => [...clusteredActive, ...finishedOrders],
    [clusteredActive, finishedOrders]
  )

  const pedidosFiltrados = useMemo(() => {
    let resultado = pedidosComClusters

    if (searchQuery.trim()) {
      const query = searchQuery.trim()
      resultado = resultado.filter((p) => {
        const searchText = [
          p._id.slice(-4).toUpperCase(),
          p.cliente?.nome || '',
          p.cliente?.telefone || '',
          p.enderecoEntrega?.rua || '',
          p.enderecoEntrega?.bairro || '',
          ...p.itens.map((i) => i.nome),
        ].join(' ')
        return fuzzyMatch(searchText, query)
      })
    }

    if (filters.tipo !== 'todos')
      resultado = resultado.filter((p) => p.tipo === filters.tipo)

    if (filters.pagamento !== 'todos')
      resultado = resultado.filter((p) =>
        p.formaPagamento?.includes(filters.pagamento)
      )

    if (filters.valorMin)
      resultado = resultado.filter(
        (p) => p.total >= parseFloat(filters.valorMin)
      )

    if (filters.valorMax)
      resultado = resultado.filter(
        (p) => p.total <= parseFloat(filters.valorMax)
      )

    if (filters.apenasAgrupados)
      resultado = resultado.filter(
        (p) => p.clusterId && p.clusterSize > 1
      )

    if (filters.apenasUrgentes)
      resultado = resultado.filter(
        (p) => getTimeElapsed(p.createdAt).isUrgent
      )

    if (filters.apenasRecorrentes)
      resultado = resultado.filter((p) => p.cliente?.totalPedidos >= 2)

    return resultado
  }, [pedidosComClusters, searchQuery, filters])

  const columns = useMemo(
    () => ({
      pendente: pedidosFiltrados.filter(
        (p) => !p.status || p.status === 'Recebido'
      ),
      preparo: pedidosFiltrados.filter((p) => p.status === 'Em preparação'),
      entrega: pedidosFiltrados.filter((p) =>
        ['Saiu para entrega', 'Saiu para Entrega'].includes(p.status)
      ),
      concluido: pedidosFiltrados.filter((p) => p.status === 'Entregue'),
    }),
    [pedidosFiltrados]
  )

  const totalDia = useMemo(
    () => columns.concluido.reduce((acc, curr) => acc + (curr.total || 0), 0),
    [columns.concluido]
  )

  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) =>
        console.log(err)
      )
    } else {
      document.exitFullscreen()
    }
  }, [])

  const clearFilters = useCallback(() => {
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
  }, [])

  const advanceCluster = useCallback(
    async (clusterId) => {
      const clusterOrders = pedidosComClusters.filter(
        (p) => p.clusterId === clusterId
      )
      for (const pedido of clusterOrders) {
        await advanceStatus(pedido)
      }
      await fetchPedidos()
      const stillActive = pedidosComClusters.some(
        (p) =>
          p.clusterId === clusterId &&
          p.status !== 'Entregue' &&
          p.status !== 'Cancelado'
      )
      if (!stillActive) {
        setVisibleClusters((prev) => prev.filter((id) => id !== clusterId))
      }
    },
    [pedidosComClusters, advanceStatus, fetchPedidos]
  )

  const toggleClusterPin = useCallback((clusterId) => {
    setVisibleClusters((prev) =>
      prev.includes(clusterId)
        ? prev.filter((id) => id !== clusterId)
        : [...prev, clusterId]
    )
  }, [])

  const uniqueClusters = useMemo(() => {
    const clusterMap = new Map()
    pedidosComClusters.forEach((p) => {
      if (
        p.clusterId &&
        p.clusterSize > 1 &&
        p.status !== 'Entregue' &&
        p.status !== 'Cancelado'
      ) {
        if (!clusterMap.has(p.clusterId)) {
          clusterMap.set(p.clusterId, {
            clusterId: p.clusterId,
            clusterColor: p.clusterColor,
            clusterSize: p.clusterSize,
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

  // ── Skeleton durante loading inicial ─────────────────────────────────────
  if (loading) {
    return (
      <KanbanSkeleton hasNewOrdersColumn={!settings.aceitarAutomatico} />
    )
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <TickProvider>
      <div className="min-h-screen bg-white text-gray-900 flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm shrink-0">
          <div className="w-full px-4 py-3 flex items-center justify-between gap-4">

            {/* Logo + título */}
            <div className="flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-lg bg-[#7f22fe] flex items-center justify-center shadow-sm"
                aria-hidden="true"
              >
                <i className="fas fa-bolt text-white text-lg"></i>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">
                  Gestor de Pedidos
                </h1>
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"
                    aria-hidden="true"
                  ></span>
                  <span className="text-gray-500 font-medium">Loja Aberta</span>
                  {lastUpdated && (
                    <span
                      className="text-xs text-gray-400 hidden lg:inline"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      · Atualizado há {secondsSinceUpdate}s
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Barra de busca desktop */}
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
                <i
                  className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
                  aria-hidden="true"
                ></i>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label="Limpar busca"
                  >
                    <i className="fas fa-times text-sm" aria-hidden="true"></i>
                  </button>
                )}
              </div>
            </div>

            {/* Ações do header */}
            <div className="flex items-center gap-3">

              {/* Indicador de filtros ativos */}
              {activeFiltersCount > 0 && (
                <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-[#7f22fe]/10 border border-[#7f22fe]/30 rounded-lg">
                  <i
                    className="fas fa-filter text-[#7f22fe] text-sm"
                    aria-hidden="true"
                  ></i>
                  <span className="text-sm font-bold text-[#7f22fe]">
                    {activeFiltersCount} filtro{activeFiltersCount > 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={clearFilters}
                    className="ml-1 text-[#7f22fe] hover:text-[#6b1de0]"
                    aria-label="Limpar todos os filtros ativos"
                  >
                    <i className="fas fa-times text-sm" aria-hidden="true"></i>
                  </button>
                </div>
              )}

              {/* Pix recusados */}
              {pedidosRecusados.length > 0 && (
                <button
                  onClick={() => setSelectedOrder(pedidosRecusados[0])}
                  className="hidden md:flex items-center gap-2 px-3 py-2 bg-red-50 border-2 border-red-300 rounded-lg text-red-700 hover:bg-red-100 transition-colors animate-pulse"
                  aria-label={`${pedidosRecusados.length} pagamento${pedidosRecusados.length > 1 ? 's' : ''} Pix recusado${pedidosRecusados.length > 1 ? 's' : ''}. Clique para ver.`}
                >
                  <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                  <span className="text-sm font-bold">
                    {pedidosRecusados.length} Pix Recusado
                  </span>
                </button>
              )}

              {/* Pix pendentes */}
              {pedidosPendentes.length > 0 && (
                <div
                  className="hidden md:flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700"
                  role="status"
                  aria-label={`${pedidosPendentes.length} pagamento Pix aguardando confirmação`}
                >
                  <i className="fas fa-clock" aria-hidden="true"></i>
                  <span className="text-sm font-bold">
                    {pedidosPendentes.length} Pix Pendente
                  </span>
                </div>
              )}

              {/* Faturamento do dia */}
              <div className="hidden lg:flex flex-col items-end px-4 border-r border-gray-200 mr-2">
                <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                  Faturamento (Entregues)
                </span>
                <span className="text-xl font-bold text-emerald-600">
                  {formatCurrency(totalDia)}
                </span>
              </div>

              <NexBotBadge status={nexBotStatus} />

              {/* Filtros */}
              <button
                onClick={() => {
                  setShowFilters(!showFilters)
                  setShowSettings(false)
                }}
                className={`w-10 h-10 rounded-lg transition-all border ${
                  showFilters || activeFiltersCount > 0
                    ? 'bg-[#7f22fe] text-white border-[#7f22fe] shadow-md'
                    : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600'
                }`}
                aria-label="Abrir filtros avançados"
                aria-expanded={showFilters}
                aria-controls="sidebar-filtros"
              >
                <i className="fas fa-sliders-h text-sm" aria-hidden="true"></i>
              </button>

              {electronAPI.isElectron() && (
                <button
                  onClick={() => electronAPI.openKitchenDisplay()}
                  className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 transition-colors"
                  title="Abrir display da cozinha"
                  aria-label="Abrir display da cozinha em nova janela"
                >
                  <i className="fas fa-tv text-sm" aria-hidden="true"></i>
                </button>
              )}

              {/* Tela cheia */}
              <button
                onClick={toggleFullScreen}
                className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 transition-colors"
                aria-label={
                  isFullScreen ? 'Sair da tela cheia' : 'Ativar tela cheia'
                }
                title={isFullScreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
              >
                <i
                  className={`fas ${isFullScreen ? 'fa-compress' : 'fa-expand'} text-sm`}
                  aria-hidden="true"
                ></i>
              </button>

              {/* Atualizar manual */}
              <button
                onClick={fetchPedidos}
                className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 transition-colors active:scale-95"
                title="Atualizar pedidos agora"
                aria-label="Atualizar pedidos manualmente"
              >
                <i className="fas fa-sync-alt text-sm" aria-hidden="true"></i>
              </button>

              {/* Configurações */}
              <button
                onClick={() => {
                  setShowSettings(!showSettings)
                  setShowFilters(false)
                }}
                className={`w-10 h-10 rounded-lg transition-all active:scale-95 border ${
                  showSettings
                    ? 'bg-[#7f22fe] text-white border-[#7f22fe] shadow-md'
                    : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600'
                }`}
                aria-label="Abrir configurações"
                aria-expanded={showSettings}
                aria-controls="sidebar-configuracoes"
              >
                <i className="fas fa-cog text-sm" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          {/* Busca mobile */}
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
              <i
                className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
                aria-hidden="true"
              ></i>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Limpar busca"
                >
                  <i className="fas fa-times text-sm" aria-hidden="true"></i>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── Corpo principal ────────────────────────────────────────────── */}
        <div className="flex h-[calc(100vh-81px)]">

          {/* Kanban Board */}
          <main
            className={`flex-1 p-6 overflow-x-auto overflow-y-hidden transition-all duration-300 bg-gray-50 ${
              showSettings || showFilters ? 'mr-96' : ''
            }`}
            role="main"
            aria-label="Quadro Kanban de pedidos"
          >
            <div
              className={`grid gap-4 h-full transition-all ${
                settings.aceitarAutomatico
                  ? finishedColumnCollapsed
                    ? 'grid-cols-[1fr_1fr_80px]'
                    : 'grid-cols-[1fr_1fr_1fr]'
                  : finishedColumnCollapsed
                  ? 'grid-cols-[280px_1fr_1fr_80px]'
                  : 'grid-cols-[280px_1fr_1fr_280px]'
              }`}
            >
              {/* Coluna: Novos Pedidos (modo manual) */}
              {!settings.aceitarAutomatico && (
                <KanbanColumn
                  title="Novos Pedidos"
                  count={columns.pendente.length}
                  color="purple"
                  icon="bell"
                  columnWidth="narrow"
                >
                  {columns.pendente.map((p) => (
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

              {/* Coluna: Em Preparação */}
              <KanbanColumn
                title="Em Preparação"
                count={columns.preparo.length}
                color="orange"
                icon="fire"
                columnWidth="wide"
              >
                {columns.preparo.map((p) => (
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

              {/* Coluna: Em Entrega */}
              <KanbanColumn
                title="Em Entrega"
                count={columns.entrega.length}
                color="blue"
                icon="shipping-fast"
                columnWidth="wide"
              >
                {columns.entrega.map((p) => (
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

              {/* Coluna: Finalizados (colapsável) */}
              <KanbanColumn
                title="Finalizados"
                count={columns.concluido.length}
                color="emerald"
                icon="check-circle"
                isCollapsible={true}
                isCollapsed={finishedColumnCollapsed}
                onToggleCollapse={() =>
                  setFinishedColumnCollapsed(!finishedColumnCollapsed)
                }
                columnWidth={finishedColumnCollapsed ? 'collapsed' : 'narrow'}
              >
                {columns.concluido.map((p) => (
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

          {/* ── Sidebar: Filtros Avançados ──────────────────────────────── */}
          <aside
            id="sidebar-filtros"
            className={`fixed top-[81px] right-0 h-[calc(100vh-81px)] w-96 bg-white border-l border-gray-200 shadow-xl transition-all duration-300 z-40 overflow-y-auto ${
              showFilters && !showSettings ? 'translate-x-0' : 'translate-x-full'
            }`}
            aria-hidden={!(showFilters && !showSettings)}
            aria-label="Painel de filtros avançados"
          >
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <i
                    className="fas fa-sliders-h text-[#7f22fe]"
                    aria-hidden="true"
                  ></i>
                  Filtros Avançados
                </h3>
                {activeFiltersCount > 0 && (
                  <button
                    onClick={clearFilters}
                    className="text-sm text-red-600 hover:text-red-700 font-bold"
                    aria-label="Limpar todos os filtros ativos"
                  >
                    Limpar Tudo
                  </button>
                )}
              </div>

              {/* Tipo de pedido */}
              <div className="space-y-2">
                <label
                  htmlFor="filtro-tipo"
                  className="text-sm font-bold text-gray-700 uppercase tracking-wider block"
                >
                  Tipo de Pedido
                </label>
                <select
                  id="filtro-tipo"
                  value={filters.tipo}
                  onChange={(e) =>
                    setFilters({ ...filters, tipo: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                >
                  <option value="todos">Todos os tipos</option>
                  <option value="Delivery">Delivery</option>
                  <option value="Balcão">Balcão</option>
                </select>
              </div>

              {/* Forma de pagamento */}
              <div className="space-y-2">
                <label
                  htmlFor="filtro-pagamento"
                  className="text-sm font-bold text-gray-700 uppercase tracking-wider block"
                >
                  Forma de Pagamento
                </label>
                <select
                  id="filtro-pagamento"
                  value={filters.pagamento}
                  onChange={(e) =>
                    setFilters({ ...filters, pagamento: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                >
                  <option value="todos">Todas as formas</option>
                  <option value="pix">PIX</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao">Cartão</option>
                  <option value="debito">Débito</option>
                  <option value="credito">Crédito</option>
                </select>
              </div>

              {/* Faixa de valor */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-700 uppercase tracking-wider block">
                  Faixa de Valor
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    placeholder="Min R$"
                    value={filters.valorMin}
                    onChange={(e) =>
                      setFilters({ ...filters, valorMin: e.target.value })
                    }
                    className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                    aria-label="Valor mínimo do pedido"
                    min="0"
                  />
                  <input
                    type="number"
                    placeholder="Máx R$"
                    value={filters.valorMax}
                    onChange={(e) =>
                      setFilters({ ...filters, valorMax: e.target.value })
                    }
                    className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                    aria-label="Valor máximo do pedido"
                    min="0"
                  />
                </div>
              </div>

              {/* Checkboxes de filtro */}
              <div className="space-y-3 pt-4 border-t border-gray-200">
                <FilterCheckbox
                  checked={filters.apenasAgrupados}
                  onChange={(val) =>
                    setFilters({ ...filters, apenasAgrupados: val })
                  }
                  label="Apenas Pedidos Agrupados"
                  icon="route"
                  description="Mostrar só pedidos próximos entre si"
                />
                <FilterCheckbox
                  checked={filters.apenasUrgentes}
                  onChange={(val) =>
                    setFilters({ ...filters, apenasUrgentes: val })
                  }
                  label="Apenas Pedidos Urgentes"
                  icon="clock"
                  description="Pedidos com mais de 30 minutos"
                />
                <FilterCheckbox
                  checked={filters.apenasRecorrentes}
                  onChange={(val) =>
                    setFilters({ ...filters, apenasRecorrentes: val })
                  }
                  label="Apenas Clientes Recorrentes"
                  icon="star"
                  description="Clientes com 2+ pedidos"
                />
              </div>

              {/* Resultado do filtro */}
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                <p className="text-sm font-bold text-gray-700 mb-2">
                  Resultados:
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Filtrados:</span>
                    <span className="font-bold">{pedidosFiltrados.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total:</span>
                    <span className="font-bold text-gray-400">
                      {pedidosComClusters.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* ── Sidebar: Configurações ─────────────────────────────────── */}
          <aside
            id="sidebar-configuracoes"
            className={`fixed top-[81px] right-0 h-[calc(100vh-81px)] w-96 bg-white border-l border-gray-200 shadow-xl transition-all duration-300 z-40 overflow-y-auto ${
              showSettings && !showFilters ? 'translate-x-0' : 'translate-x-full'
            }`}
            aria-hidden={!(showSettings && !showFilters)}
            aria-label="Painel de configurações"
          >
            <div className="p-4 space-y-3">

            {/* ── Impressão ─────────────────────────────────────────────── */}
            <AccordionSection id="acc-impressao" icon="print" title="Impressão" defaultOpen={true}>

              <label htmlFor="select-impressora" className="sr-only">Impressora automática</label>
              <select
                id="select-impressora"
                value={settings.impressoraAutomatica}
                onChange={(e) => saveSettings({ ...settings, impressoraAutomatica: e.target.value })}
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-300 text-gray-900 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none transition-all"
              >
                <option value="">Manual (sem impressão automática)</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>

              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200">
                <span className="text-sm text-gray-900 font-medium">Aceitar Automaticamente</span>
                <Switch
                  checked={settings.aceitarAutomatico}
                  onChange={() => saveSettings({ ...settings, aceitarAutomatico: !settings.aceitarAutomatico })}
                  ariaLabel="Ativar aceitação automática de pedidos"
                />
              </div>

              {/* Estilo do cupom */}
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                    <i className="fas fa-text-height text-gray-400" aria-hidden="true"></i>
                    Estilo do Cupom
                  </p>
                </div>
                <div className="p-4 space-y-4 bg-white">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-600">Tamanho da fonte</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Pequeno', size: 10 },
                        { label: 'Normal',  size: 12 },
                        { label: 'Grande',  size: 15 },
                      ].map(({ label, size }) => (
                        <button
                          key={size}
                          onClick={() => saveSettings({ ...settings, fonteTamanho: size })}
                          type="button"
                          className={`py-3 rounded-lg border-2 transition-all text-center focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40 ${
                            settings.fonteTamanho === size
                              ? 'bg-[#7f22fe] border-[#7f22fe] text-white shadow-md'
                              : 'bg-white border-gray-200 text-gray-700 hover:border-[#7f22fe]/40'
                          }`}
                          aria-pressed={settings.fonteTamanho === size}
                        >
                          <span className="block font-bold leading-tight" style={{ fontFamily: 'Courier New, monospace', fontSize: size }}>
                            {label}
                          </span>
                          <span className={`block text-[10px] mt-0.5 ${settings.fonteTamanho === size ? 'text-purple-200' : 'text-gray-400'}`}>
                            {size}px
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-900 font-medium">Negrito</p>
                      <p className="text-xs text-gray-500">Letras mais fortes e marcadas</p>
                    </div>
                    <Switch
                      checked={settings.negritar}
                      onChange={() => saveSettings({ ...settings, negritar: !settings.negritar })}
                      ariaLabel="Ativar texto em negrito no cupom"
                    />
                  </div>

                  <button
                    onClick={() => handlePrint(PEDIDO_TESTE_IMPRESSAO)}
                    type="button"
                    className="w-full py-2.5 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all font-medium flex items-center justify-center gap-2"
                  >
                    <i className="fas fa-print text-gray-400" aria-hidden="true"></i>
                    Imprimir cupom de teste
                  </button>
                </div>
              </div>
            </AccordionSection>

            {/* ── Sistema ───────────────────────────────────────────────── */}
            <AccordionSection id="acc-sistema" icon="sliders-h" title="Sistema">

              <div className="p-5 rounded-lg bg-gray-50 border border-gray-200">
                <div className="flex justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-900">Atualização Automática</span>
                  <span className="text-sm font-bold text-[#7f22fe] bg-purple-50 px-3 py-1 rounded-full border border-purple-200">
                    {settings.tempoRefresh}s
                  </span>
                </div>
                <input
                  type="range" min="10" max="30" step="10"
                  value={settings.tempoRefresh}
                  onChange={(e) => saveSettings({ ...settings, tempoRefresh: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-purple"
                  aria-label={`Tempo de atualização automática: ${settings.tempoRefresh} segundos`}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-2 font-medium">
                  <span>10s Rápido</span>
                  <span>30s Lento</span>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <span className="text-sm text-gray-900 font-medium">Notificações Push</span>
                  <span className="text-xs text-gray-500 block">Teste ao ativar</span>
                </div>
                <Switch checked={settings.notificacoesPush} onChange={handleToggleNotification} ariaLabel="Ativar notificações push" />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200">
                <span className="text-sm text-gray-900 font-medium">Efeito Sonoro</span>
                <Switch
                  checked={settings.somNotificacao}
                  onChange={() => saveSettings({ ...settings, somNotificacao: !settings.somNotificacao })}
                  ariaLabel="Ativar efeito sonoro"
                />
              </div>
            </AccordionSection>

            {/* ── Otimização de Entregas ────────────────────────────────── */}
            <AccordionSection id="acc-entregas" icon="route" title="Otimização de Entregas">

              {boxDeliveryAtivo && (
                <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-emerald-200">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <i className="fas fa-motorcycle text-emerald-600 text-sm" aria-hidden="true"></i>
                      <span className="text-sm text-gray-900 font-bold">Chamar Entregador Automático</span>
                    </div>
                    <p className="text-xs text-gray-600">Aciona a Box Delivery ao aceitar pedidos Delivery</p>
                  </div>
                  <Switch
                    checked={settings.chamarEntregadorAuto}
                    onChange={() => saveSettings({ ...settings, chamarEntregadorAuto: !settings.chamarEntregadorAuto })}
                    ariaLabel="Chamar entregador automaticamente"
                  />
                </div>
              )}

              <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-gray-900 font-bold">Agrupar por Distância</span>
                    <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">BETA</span>
                  </div>
                  <p className="text-xs text-gray-600">Destaca pedidos próximos para otimizar rotas</p>
                </div>
                <Switch
                  checked={settings.agruparPorDistancia}
                  onChange={() => saveSettings({ ...settings, agruparPorDistancia: !settings.agruparPorDistancia })}
                  ariaLabel="Ativar agrupamento por distância"
                />
              </div>

              {settings.agruparPorDistancia && (
                <>
                  <div className="p-5 rounded-lg bg-white border-2 border-blue-200">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-sm font-bold text-gray-900 block">Raio de Proximidade</span>
                        <span className="text-xs text-gray-500">Até quantos km considera próximo?</span>
                      </div>
                      <span className="text-lg font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-lg border-2 border-blue-300">
                        {settings.raioCluster}km
                      </span>
                    </div>
                    <input
                      type="range" min="0.5" max="10" step="0.5"
                      value={settings.raioCluster}
                      onChange={(e) => saveSettings({ ...settings, raioCluster: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-gradient-to-r from-blue-200 to-blue-400 rounded-lg appearance-none cursor-pointer slider-blue"
                      aria-label={`Raio: ${settings.raioCluster}km`}
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-2 font-medium">
                      <span>0.5km Restrito</span><span>10km Amplo</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-white border-2 border-blue-100">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-sm font-bold text-gray-900 block">
                          <i className="fas fa-shopping-bag text-blue-500 mr-1"></i>Capacidade da Entrega
                        </span>
                        <span className="text-xs text-gray-500">Quantos pedidos o motoboy leva?</span>
                      </div>
                      <span className="text-sm font-black text-blue-700 bg-blue-100 px-2 py-1 rounded border border-blue-200">
                        {settings.capacidadeEntrega} un.
                      </span>
                    </div>
                    <input
                      type="range" min="2" max="8" step="1"
                      value={settings.capacidadeEntrega}
                      onChange={(e) => saveSettings({ ...settings, capacidadeEntrega: parseInt(e.target.value) })}
                      className="w-full h-2 bg-gradient-to-r from-blue-200 to-blue-400 rounded-lg appearance-none cursor-pointer slider-blue"
                      aria-label={`Capacidade: ${settings.capacidadeEntrega} pedidos`}
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
                      <span>2 (Mínimo)</span><span>8 (Mochila Cheia)</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-white border-2 border-blue-100">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-sm font-bold text-gray-900 block">
                          <i className="fas fa-hourglass-half text-blue-500 mr-1"></i>Janela de Agrupamento
                        </span>
                        <span className="text-xs text-gray-500">Espera máx. do 1º pedido</span>
                      </div>
                      <span className="text-sm font-black text-blue-700 bg-blue-100 px-2 py-1 rounded border border-blue-200">
                        {settings.tempoJanela} min
                      </span>
                    </div>
                    <input
                      type="range" min="10" max="60" step="5"
                      value={settings.tempoJanela}
                      onChange={(e) => saveSettings({ ...settings, tempoJanela: parseInt(e.target.value) })}
                      className="w-full h-2 bg-gradient-to-r from-blue-200 to-blue-400 rounded-lg appearance-none cursor-pointer slider-blue"
                      aria-label={`Janela: ${settings.tempoJanela} minutos`}
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
                      <span>10min (Rápido)</span><span>60min (Econômico)</span>
                    </div>
                    <p className="mt-2 text-xs text-orange-600 bg-orange-50 p-2 rounded border border-orange-100">
                      <i className="fas fa-exclamation-circle mr-1"></i>
                      Pedidos antigos não esperarão mais que {settings.tempoJanela} min para sair.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="endereco-restaurante" className="text-sm font-bold text-gray-700 uppercase tracking-wider block">
                      Endereço do Restaurante
                    </label>
                    <input
                      id="endereco-restaurante"
                      type="text"
                      value={settings.enderecoRestaurante}
                      onChange={(e) => saveSettings({ ...settings, enderecoRestaurante: e.target.value })}
                      placeholder="Ex: Av. Paulista, 1578, São Paulo, SP"
                      className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500">Usado como ponto de partida nas rotas</p>
                  </div>
                </>
              )}
            </AccordionSection>

            {/* ── Sobre + Logout ────────────────────────────────────────── */}
            <AccordionSection id="acc-sobre" icon="info-circle" title="Sobre" defaultOpen={true}>
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-center mb-4">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-md">
                    <i className="fas fa-bolt text-2xl text-white" aria-hidden="true"></i>
                  </div>
                  <h4 className="font-bold text-gray-900 text-lg mb-1">
                    NEX<i className="fas fa-bolt" aria-hidden="true"></i>FOOD
                  </h4>
                  <p className="text-sm text-gray-500">by Nadin Garcia</p>
                </div>
                <div className="space-y-2 text-sm">
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
                  ['nexfood_token', 'nexfood_user', 'nexfood_refresh_token'].forEach((k) => localStorage.removeItem(k))
                  sessionStorage.removeItem('nexfood_token')
                  sessionStorage.removeItem('nexfood_refresh_token')
                  sessionStorage.removeItem('nexfood_user')
                  navigate('/login')
                }}
                className="w-full py-3 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 hover:text-red-700 font-bold transition-all uppercase tracking-wider text-sm"
              >
                <i className="fas fa-sign-out-alt mr-2" aria-hidden="true"></i>
                Encerrar Sessão
              </button>
            </AccordionSection>

          </div>
          </aside>
        </div>

        {/* Modal do pedido */}
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

        {/* Sistema de toasts */}
        <ToastContainer toasts={toasts} />

        {/* Cards flutuantes de clusters fixados */}
        {uniqueClusters
          .filter((c) => visibleClusters.includes(c.clusterId))
          .map((cluster) => (
            <ClusterFloatingCard
              key={cluster.clusterId}
              cluster={cluster}
              pedidos={pedidosComClusters}
              onAdvanceCluster={() => advanceCluster(cluster.clusterId)}
              onOrderClick={setSelectedOrder}
              onClose={() => toggleClusterPin(cluster.clusterId)}
            />
          ))}
          <ElectronBanner />
      </div>
    </TickProvider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON DE LOADING
// Exibido enquanto o primeiro fetch está em andamento.
// Elimina a tela em branco que parecia um erro para o operador.
// ─────────────────────────────────────────────────────────────────────────────

function KanbanSkeleton({ hasNewOrdersColumn = false }) {
  const colCount = hasNewOrdersColumn ? 4 : 3

  return (
    <div
      className="min-h-screen bg-white flex flex-col"
      role="status"
      aria-label="Carregando pedidos..."
      aria-busy="true"
    >
      {/* Header skeleton */}
      <div className="h-[81px] bg-white border-b border-gray-200 shadow-sm flex items-center px-4 gap-4">
        <div className="w-10 h-10 rounded-lg bg-gray-200 animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
        </div>
        <div className="flex-1 max-w-md hidden lg:block">
          <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
        </div>
        <div className="ml-auto flex gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse"
            />
          ))}
        </div>
      </div>

      {/* Kanban skeleton */}
      <div
        className="flex-1 p-6 bg-gray-50 grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${colCount}, 1fr)`,
        }}
      >
        {Array.from({ length: colCount }).map((_, colIdx) => (
          <div
            key={colIdx}
            className="rounded-xl bg-gray-100/50 border border-gray-200 overflow-hidden"
          >
            {/* Cabeçalho da coluna */}
            <div className="px-4 py-3 bg-white border-b-2 border-gray-200 flex items-center justify-between">
              <div className="h-4 w-28 bg-gray-200 rounded animate-pulse" />
              <div className="h-6 w-8 bg-gray-200 rounded-md animate-pulse" />
            </div>
            {/* Cards skeleton */}
            <div className="p-3 space-y-3">
              {Array.from({ length: colIdx === 0 ? 2 : 3 }).map((_, cardIdx) => (
                <div
                  key={cardIdx}
                  className="bg-white rounded-lg p-3 border border-l-4 border-l-gray-300 space-y-2 animate-pulse"
                >
                  <div className="flex justify-between">
                    <div className="h-3 w-16 bg-gray-200 rounded" />
                    <div className="h-3 w-14 bg-gray-200 rounded" />
                  </div>
                  <div className="h-3 w-32 bg-gray-100 rounded" />
                  <div className="flex gap-2">
                    <div className="h-4 w-16 bg-gray-100 rounded" />
                    <div className="h-4 w-20 bg-gray-100 rounded" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-2.5 w-full bg-gray-100 rounded" />
                    <div className="h-2.5 w-3/4 bg-gray-100 rounded" />
                  </div>
                  <div className="h-8 bg-gray-200 rounded mt-1" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Switch — toggle acessível
// ─────────────────────────────────────────────────────────────────────────────

function Switch({ checked, onChange, ariaLabel }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40 focus:ring-offset-1 ${
        checked ? 'bg-[#7f22fe]' : 'bg-gray-300'
      }`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      type="button"
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
          checked ? 'translate-x-6' : 'translate-x-0'
        }`}
        aria-hidden="true"
      />
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterCheckbox — checkbox estilizado com ícone e descrição
// ─────────────────────────────────────────────────────────────────────────────

function FilterCheckbox({ checked, onChange, label, icon, description }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-full p-4 rounded-lg border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40 ${
        checked
          ? 'bg-[#7f22fe]/10 border-[#7f22fe]'
          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
      }`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
            checked
              ? 'bg-[#7f22fe] border-[#7f22fe]'
              : 'bg-white border-gray-300'
          }`}
          aria-hidden="true"
        >
          {checked && (
            <i className="fas fa-check text-white text-sm"></i>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <i
              className={`fas fa-${icon} text-sm ${
                checked ? 'text-[#7f22fe]' : 'text-gray-500'
              }`}
              aria-hidden="true"
            ></i>
            <span
              className={`text-sm font-bold ${
                checked ? 'text-[#7f22fe]' : 'text-gray-900'
              }`}
            >
              {label}
            </span>
          </div>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KanbanColumn — coluna do quadro Kanban com suporte a colapso
// ─────────────────────────────────────────────────────────────────────────────

function KanbanColumn({
  title,
  count,
  children,
  color,
  icon,
  isCollapsible,
  isCollapsed,
  onToggleCollapse,
  columnWidth = 'normal',
}) {
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

  const borderColor = colorThemes[color]?.split(' ')[0] || ''
  const bgColor = colorThemes[color]?.split(' ')[1] || ''

  return (
    <div
      className={`flex flex-col h-full rounded-xl bg-gray-100/50 border border-gray-200 overflow-hidden shadow-sm transition-all ${
        isCollapsed ? 'max-w-[80px]' : ''
      }`}
      role="region"
      aria-label={`Coluna ${title}: ${count} pedidos`}
    >
      {/* Cabeçalho da coluna */}
      <div
        className={`px-4 py-3 border-b-2 bg-white flex justify-between items-center ${borderColor} ${
          isCollapsible ? 'cursor-pointer hover:bg-gray-50' : ''
        }`}
        onClick={isCollapsible ? onToggleCollapse : undefined}
        role={isCollapsible ? 'button' : undefined}
        aria-expanded={isCollapsible ? !isCollapsed : undefined}
        tabIndex={isCollapsible ? 0 : undefined}
        onKeyDown={
          isCollapsible
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggleCollapse()
                }
              }
            : undefined
        }
      >
        <div
          className={`font-bold flex items-center gap-2 ${textColors[color]}`}
        >
          <div
            className={`p-1.5 rounded-md ${bgColor} bg-opacity-50`}
            aria-hidden="true"
          >
            <i className={`fas fa-${icon}`}></i>
          </div>
          {!isCollapsed && (
            <span className="uppercase tracking-tight text-sm">{title}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="bg-gray-800 px-2.5 py-0.5 rounded-md text-sm font-bold text-white"
            aria-hidden="true"
          >
            {count}
          </span>
          {isCollapsible && (
            <i
              className={`fas fa-chevron-${isCollapsed ? 'right' : 'left'} text-sm`}
              aria-hidden="true"
            ></i>
          )}
        </div>
      </div>

      {/* Conteúdo scrollável */}
      {!isCollapsed && (
        <div className="flex-1 p-3 overflow-y-auto overflow-x-hidden custom-scrollbar">
          {children.length > 0 ? (
            <div
              className={`grid gap-3 ${
                columnWidth === 'wide'
                  ? 'grid-cols-1 2xl:grid-cols-2'
                  : 'grid-cols-1'
              }`}
            >
              {children}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-40">
              <i
                className={`fas fa-${icon} text-3xl mb-2`}
                aria-hidden="true"
              ></i>
              <span className="text-sm font-medium">Vazio</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OrderCard — card individual do Kanban
// ─────────────────────────────────────────────────────────────────────────────

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
  pedidos,
}) {
  const colorThemes = {
    purple: 'border-l-4 border-l-[#7f22fe]',
    orange: 'border-l-4 border-l-orange-500',
    blue: 'border-l-4 border-l-blue-500',
    emerald: 'border-l-4 border-l-emerald-500 opacity-60 grayscale-[0.5]',
  }

  const { minutes, isUrgent } = getTimeElapsed(pedido.createdAt)
  const estimatedMins = pedido.tipo === 'Delivery' ? 40 : 15
  const countdown = useCountdown(pedido.createdAt, estimatedMins)

  // Monta o tooltip do countdown com contexto claro para o operador
  const countdownTooltip = countdown.isLate
    ? `Pedido atrasado! Passou ${countdown.overdueMinutes} min além do estimado`
    : countdown.isWarning
    ? `Atenção: menos de 10 minutos restantes (${countdown.display})`
    : `Tempo estimado restante: ${countdown.display}`

  // Highlight do termo buscado no texto do card
  const highlightText = (text) => {
    if (!searchQuery || !text) return text
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  const pagamentoLabel =
    {
      dinheiro: 'Dinheiro',
      pix: 'Pix',
      debito_maq: 'Maquininha',
      cartao: 'Cartão',
      online_card: 'Cartão Online',
      pix_online: 'Pix Online',
      mercadopago: 'Mercado Pago',
    }[pedido.formaPagamento] || pedido.formaPagamento?.replace(/_/g, ' ')

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`relative bg-white p-3 rounded-lg shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all cursor-pointer border group flex flex-col gap-2 focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40 ${
        colorThemes[color]
      } ${isUrgent && !isDone ? 'ring-1 ring-red-400/60' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Pedido #${getOrderNumber(pedido)} — ${pedido.cliente?.nome || 'Consumidor'} — ${pedido.status || 'Recebido'} — ${formatCurrency(pedido.total)}`}
    >
      {/* Linha 1: ID · Hora · Countdown · Total */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-black text-gray-900">
          #{highlightText(getOrderNumber(pedido))}
        </span>
        <span className="text-[10px] text-gray-400">
          {formatTime(pedido.createdAt)}
        </span>

        {!isDone && (
          <span
            className={`text-[9px] font-black px-1.5 py-0.5 rounded font-mono shrink-0 cursor-help ${
              countdown.isLate
                ? 'bg-red-100 text-red-600'
                : countdown.isWarning
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-gray-100 text-gray-500'
            }`}
            title={countdownTooltip}
            aria-label={countdownTooltip}
          >
            {countdown.isLate ? '⚠ ATRASADO' : countdown.display}
          </span>
        )}

        {isUrgent && !isDone && (
          <span
            className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-500 text-white shrink-0"
            aria-label={`Pedido aguarda há ${minutes} minutos`}
            title={`Pedido aguarda há ${minutes} minutos`}
          >
            {minutes}m
          </span>
        )}

        <span className="ml-auto text-sm font-black text-gray-900 whitespace-nowrap">
          {formatCurrency(pedido.total)}
        </span>
      </div>

      {/* Linha 2: Nome do cliente */}
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-bold text-gray-900 truncate flex-1">
          {highlightText(pedido.cliente?.nome || 'Consumidor')}
        </p>
        {pedido.cliente?.totalPedidos > 1 && (
          <span
            className="text-[10px] text-emerald-600 font-bold shrink-0"
            title={`Cliente fiel — ${pedido.cliente.totalPedidos}º pedido`}
          >
            ★{pedido.cliente.totalPedidos}
          </span>
        )}
      </div>

      {/* Linha 3: Tipo + Pagamento */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
            pedido.tipo === 'Delivery'
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-orange-50 text-orange-700 border border-orange-200'
          }`}
        >
          <i
            className={`fas ${
              pedido.tipo === 'Delivery' ? 'fa-motorcycle' : 'fa-store'
            } text-[9px]`}
            aria-hidden="true"
          ></i>
          {pedido.tipo === 'Delivery' ? 'Delivery' : 'Balcão'}
        </span>
        {pagamentoLabel && (
          <>
            <span className="text-[10px] text-gray-300" aria-hidden="true">
              ·
            </span>
            <span className="text-[10px] text-gray-500 truncate">
              {pagamentoLabel}
              {pedido.trocoPara
                ? ` · troco ${formatCurrency(pedido.trocoPara)}`
                : ''}
            </span>
          </>
        )}
      </div>

      {/* Linha 4: Endereço (só Delivery) */}
      {pedido.tipo === 'Delivery' && pedido.enderecoEntrega && (
        <div className="flex items-start gap-1">
          <i
            className="fas fa-map-marker-alt text-[9px] text-gray-400 mt-0.5 shrink-0"
            aria-hidden="true"
          ></i>
          <span className="text-[10px] text-gray-500 leading-tight line-clamp-1">
            {pedido.enderecoEntrega.rua}, {pedido.enderecoEntrega.numero}
            {pedido.enderecoEntrega.bairro
              ? ` · ${pedido.enderecoEntrega.bairro}`
              : ''}
          </span>
        </div>
      )}

      {/* Badge de cluster */}
      {pedido.clusterId && pedido.clusterSize > 1 && (
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded ${pedido.clusterColor.bg} ${pedido.clusterColor.border} border`}
        >
          <div
            className={`w-4 h-4 rounded-full ${pedido.clusterColor.badge} flex items-center justify-center text-white font-black text-[9px] shrink-0`}
            aria-hidden="true"
          >
            {pedido.clusterSize}
          </div>
          <p
            className={`text-[10px] font-bold flex-1 ${pedido.clusterColor.text}`}
          >
            Rota Compartilhada
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleClusterPin(pedido.clusterId)
            }}
            className={`w-4 h-4 rounded flex items-center justify-center text-[9px] transition-all ${
              visibleClusters.includes(pedido.clusterId)
                ? `${pedido.clusterColor.badge} text-white`
                : 'bg-white hover:bg-gray-100'
            }`}
            title={
              visibleClusters.includes(pedido.clusterId)
                ? 'Desafixar painel do cluster'
                : 'Fixar painel do cluster'
            }
            aria-label={
              visibleClusters.includes(pedido.clusterId)
                ? 'Desafixar painel do grupo de rotas'
                : 'Fixar painel do grupo de rotas'
            }
            type="button"
          >
            <i className="fas fa-thumbtack" aria-hidden="true"></i>
          </button>
        </div>
      )}

      {/* Badge Box Delivery */}
      {pedido.boxDelivery?.despachado && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
          <i
            className="fas fa-motorcycle text-emerald-600 text-[9px]"
            aria-hidden="true"
          ></i>
          <span className="text-[10px] font-bold text-emerald-700">
            Entregador Chamado
          </span>
          {pedido.boxDelivery?.uuid && (
            <span className="text-[9px] text-emerald-500 ml-auto">
              #{pedido.boxDelivery.uuid.slice(0, 6)}
            </span>
          )}
        </div>
      )}

      {/* Itens do pedido (máx 2 visíveis) */}
      <div className="space-y-0.5">
        {pedido.itens.slice(0, 2).map((item, idx) => (
          <div key={idx} className="flex items-start gap-1">
            <span className="text-[10px] font-black text-gray-600 min-w-[18px]">
              {item.quantidade}x
            </span>
            <span className="text-[10px] text-gray-700 truncate">
              {item.nome.replace(/\s*\(padrão\)/gi, '').trim()}
            </span>
          </div>
        ))}
        {pedido.itens.length > 2 && (
          <p className="text-[9px] text-gray-400">
            +{pedido.itens.length - 2}{' '}
            {pedido.itens.length - 2 === 1 ? 'item' : 'itens'}
          </p>
        )}
      </div>

      {/* Ações (não exibidas em pedidos finalizados) */}
      {!isDone && (
        <div className="flex gap-1.5 pt-1.5 border-t border-gray-100 mt-auto">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPrint()
            }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400/40"
            title="Imprimir cupom"
            aria-label="Imprimir cupom do pedido"
            type="button"
          >
            <i className="fas fa-print" aria-hidden="true"></i>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAdvance()
            }}
            disabled={isLoading}
            className={`flex-1 py-1.5 rounded text-xs font-black text-white transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-gray-900/40 ${
              isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gray-900 hover:bg-black'
            }`}
            aria-label={
              isLoading
                ? 'Atualizando status...'
                : `Avançar para ${getNextStatus(pedido.status) || 'próximo status'}`
            }
            type="button"
          >
            {isLoading ? (
              <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
            ) : (
              <>
                AVANÇAR{' '}
                <i
                  className="fas fa-arrow-right text-[10px] ml-1"
                  aria-hidden="true"
                ></i>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OrderModal — modal de detalhes do pedido com navegação intra-cluster
// ─────────────────────────────────────────────────────────────────────────────

function OrderModal({
  pedido,
  onClose,
  onPrint,
  onAdvance,
  isLoading,
  pedidos,
  onNavigate,
  restaurantAddress,
}) {
  const [currentPedido, setCurrentPedido] = useState(pedido)

  // Focus trap com suporte a fechar via Escape
  const modalRef = useFocusTrap(true, onClose)

  // Sincroniza com pedido externo (ex: avançar status abre o modal no novo estado)
  useEffect(() => {
    setCurrentPedido(pedido)
  }, [pedido])

  const handleWhatsApp = () => {
    if (!currentPedido.cliente?.telefone) return
    const phone = currentPedido.cliente.telefone.replace(/\D/g, '')
    const fullPhone = phone.length <= 11 ? `55${phone}` : phone
    const msg = `Olá ${currentPedido.cliente.nome}, tudo bem? Aqui é do NexFood. Estamos entrando em contato sobre seu pedido #${getOrderNumber(currentPedido)}.`
    window.open(
      `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`,
      '_blank'
    )
  }

  const openGoogleMaps = () => {
    if (!currentPedido.enderecoEntrega) return
    const { rua, numero, bairro, cidade } = currentPedido.enderecoEntrega
    const address = `${rua}, ${numero}, ${bairro}, ${cidade}`
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      '_blank'
    )
  }

  const createClusterRoute = () => {
    if (!currentPedido?.clusterId || !pedidos?.length) return

    const clusterOrders = pedidos
      .filter((p) => p.clusterId === currentPedido.clusterId && p.enderecoEntrega)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

    if (clusterOrders.length === 0) return

    const origin = restaurantAddress || 'Av. Paulista, 1578, São Paulo, SP'

    const lastAddr =
      clusterOrders[clusterOrders.length - 1].enderecoEntrega
    const destination = `${lastAddr.rua}, ${lastAddr.numero}, ${lastAddr.bairro}, ${lastAddr.cidade}`

    const waypoints = clusterOrders
      .slice(0, -1)
      .map((p) => {
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

  const navigateToOrder = (orderId) => {
    const nextPedido = pedidos.find((p) => p._id === orderId)
    if (nextPedido) {
      setCurrentPedido(nextPedido)
      onNavigate(nextPedido)
    }
  }

  // Navegação prev/next dentro do cluster
  const clusterOrders =
    pedidos?.filter((p) => p.clusterId === currentPedido.clusterId) || []
  const currentIndexInCluster = clusterOrders.findIndex(
    (p) => p._id === currentPedido._id
  )
  const hasPrev = currentIndexInCluster > 0
  const hasNext = currentIndexInCluster < clusterOrders.length - 1

  const goToPrev = () => {
    if (hasPrev) {
      const prev = clusterOrders[currentIndexInCluster - 1]
      setCurrentPedido(prev)
      onNavigate(prev)
    }
  }

  const goToNext = () => {
    if (hasNext) {
      const next = clusterOrders[currentIndexInCluster + 1]
      setCurrentPedido(next)
      onNavigate(next)
    }
  }

  const { minutes } = getTimeElapsed(currentPedido.createdAt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
      >
        {/* Header */}
        <div className="bg-gray-50 px-6 py-5 border-b">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-lg bg-[#7f22fe] flex items-center justify-center"
                aria-hidden="true"
              >
                <i className="fas fa-receipt text-white"></i>
              </div>
              <div>
                <h2
                  id="modal-titulo"
                  className="text-xl font-bold text-gray-900 flex items-center gap-3"
                >
                  Pedido #{getOrderNumber(currentPedido)}
                  {minutes > 0 && (
                    <span className="text-sm font-normal text-gray-600">
                      ({minutes}min)
                    </span>
                  )}
                </h2>
                <span className="text-sm px-3 py-1 rounded-full bg-purple-100 text-[#7f22fe] font-medium">
                  {currentPedido.status}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400/40"
              aria-label="Fechar modal"
              type="button"
            >
              <i className="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>

          {/* Navegação prev/next intra-cluster */}
          {currentPedido.clusterId && clusterOrders.length > 1 && (
            <div className="flex items-center gap-3 mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <button
                onClick={goToPrev}
                disabled={!hasPrev}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                  hasPrev
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
                aria-label="Pedido anterior do grupo"
                type="button"
              >
                <i className="fas fa-chevron-left" aria-hidden="true"></i>
                Anterior
              </button>

              <div className="flex-1 text-center">
                <p className="text-sm font-bold text-blue-900">
                  Pedido {currentIndexInCluster + 1} de {clusterOrders.length}
                </p>
                <p className="text-xs text-blue-700">do mesmo grupo</p>
              </div>

              <button
                onClick={goToNext}
                disabled={!hasNext}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/40 ${
                  hasNext
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
                aria-label="Próximo pedido do grupo"
                type="button"
              >
                Próximo
                <i className="fas fa-chevron-right" aria-hidden="true"></i>
              </button>
            </div>
          )}
        </div>

        {/* Conteúdo scrollável */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">
          {/* Ação rápida: WhatsApp */}
          {currentPedido.cliente?.telefone && (
            <button
              onClick={handleWhatsApp}
              className="w-full flex items-center justify-center gap-2 py-3 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-green-400/40"
              type="button"
            >
              <i className="fab fa-whatsapp text-xl" aria-hidden="true"></i>
              <span>
                Conversar com {currentPedido.cliente.nome.split(' ')[0]} (
                {currentPedido.cliente.telefone})
              </span>
            </button>
          )}

          {/* Lista de itens */}
          <div className="space-y-3" role="list" aria-label="Itens do pedido">
            {currentPedido.itens.map((item, idx) => (
              <div
                key={idx}
                className="bg-gray-50 border rounded-lg p-4"
                role="listitem"
              >
                <div className="flex gap-4 items-start">
                  <div
                    className="w-10 h-10 rounded-lg bg-[#7f22fe] flex items-center justify-center font-bold text-white shrink-0"
                    aria-hidden="true"
                  >
                    {item.quantidade}x
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-gray-900 font-semibold">{item.nome}</p>
                      <p className="text-gray-900 font-bold">
                        {formatCurrency(item.precoUnitario * item.quantidade)}
                      </p>
                    </div>
                    {item.complementos?.length > 0 && (
                      <p className="text-sm text-gray-600">
                        + {item.complementos.join(', ')}
                      </p>
                    )}
                    {item.obs && (
                      <div className="inline-flex items-center gap-2 text-sm bg-yellow-100 text-yellow-800 px-3 py-1.5 rounded-lg mt-2">
                        <i
                          className="fas fa-sticky-note"
                          aria-hidden="true"
                        ></i>
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
            {/* Entrega */}
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-5">
              <h3 className="font-bold text-blue-900 uppercase text-sm mb-4 flex items-center gap-2">
                <i className="fas fa-map-marker-alt" aria-hidden="true"></i>{' '}
                Entrega
              </h3>

              {currentPedido.enderecoEntrega ? (
                <>
                  <p className="text-gray-900 font-semibold text-sm">
                    {currentPedido.enderecoEntrega.rua},{' '}
                    {currentPedido.enderecoEntrega.numero}
                  </p>
                  <p className="text-gray-600 text-sm mb-3">
                    {currentPedido.enderecoEntrega.bairro} -{' '}
                    {currentPedido.enderecoEntrega.cidade}
                  </p>
                  <div className="space-y-2">
                    <button
                      onClick={openGoogleMaps}
                      className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                      type="button"
                    >
                      <i
                        className="fas fa-map-marked-alt mr-2"
                        aria-hidden="true"
                      ></i>
                      Ver no Mapa
                    </button>

                    {currentPedido.clusterId && clusterOrders.length > 1 && (
                      <button
                        onClick={createClusterRoute}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                        type="button"
                      >
                        <i
                          className="fas fa-route mr-2"
                          aria-hidden="true"
                        ></i>
                        Criar Rota ({clusterOrders.length} pedidos)
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-gray-700 bg-white p-3 rounded border border-blue-100">
                  <i className="fas fa-store" aria-hidden="true"></i>
                  <span className="font-medium">Retirada no Balcão</span>
                </div>
              )}

              {/* Lista de pedidos próximos do cluster */}
              {currentPedido.clusterId &&
                currentPedido.clusterDistances?.length > 0 && (
                  <div className="mt-4 bg-white rounded-lg p-4 border border-blue-200">
                    <p className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                      <i className="fas fa-route" aria-hidden="true"></i>
                      Outros Pedidos da Rota:
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {currentPedido.clusterDistances.map((nearby, idx) => (
                        <button
                          key={idx}
                          onClick={() => navigateToOrder(nearby.orderId)}
                          className="w-full flex items-center justify-between p-2 rounded bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all text-left focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                          type="button"
                          aria-label={`Ver pedido #${nearby.orderNumber} a ${nearby.distance.toFixed(1)}km`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center shrink-0"
                              aria-hidden="true"
                            >
                              {idx + 1}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-blue-900">
                                #{nearby.orderNumber}
                              </p>
                              <p className="text-xs text-gray-600 truncate max-w-[150px]">
                                {nearby.address}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-bold bg-blue-500 text-white px-2 py-1 rounded shrink-0">
                            {nearby.distance.toFixed(1)}km
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </div>

            {/* Pagamento */}
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-5">
              <h3 className="font-bold text-emerald-900 uppercase text-sm mb-4 flex items-center gap-2">
                <i className="fas fa-wallet" aria-hidden="true"></i> Pagamento
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span className="font-semibold">
                    {formatCurrency(currentPedido.subtotal)}
                  </span>
                </div>
                {currentPedido.desconto > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Desconto</span>
                    <span className="font-semibold">
                      -{formatCurrency(currentPedido.desconto)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-gray-900 font-bold text-xl pt-3 border-t border-emerald-200">
                  <span>Total</span>
                  <span className="text-[#7f22fe]">
                    {formatCurrency(currentPedido.total)}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-3 p-3 rounded-lg bg-white border border-emerald-200">
                  <span className="text-xs uppercase font-bold">
                    {({
                      dinheiro: 'Dinheiro',
                      pix: 'Pix na Entrega',
                      debito_maq: 'Maquininha',
                      cartao: 'Cartão na Entrega',
                      online_card: 'Cartão Online',
                      pix_online: 'Pix Online',
                      mercadopago: 'Mercado Pago',
                    })[currentPedido.formaPagamento] ||
                      currentPedido.formaPagamento?.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`text-sm font-bold px-2 py-1 rounded ${
                      currentPedido.statusPagamento === 'aprovado'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {currentPedido.statusPagamento?.toUpperCase()}
                  </span>
                </div>
                {currentPedido.trocoPara && (
                  <p className="text-sm text-gray-600 text-center">
                    Troco para:{' '}
                    <strong>{formatCurrency(currentPedido.trocoPara)}</strong>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer com ações */}
        <div className="bg-gray-50 p-6 border-t flex gap-4">
          <button
            onClick={() => onPrint(currentPedido)}
            className="flex-1 py-4 rounded-lg bg-white hover:bg-gray-100 border-2 border-gray-300 font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400/40"
            type="button"
          >
            <i className="fas fa-print mr-2" aria-hidden="true"></i>Imprimir
          </button>
          {currentPedido.status !== 'Entregue' && (
            <button
              onClick={() => { onAdvance(currentPedido); onClose() }}
              disabled={isLoading}
              className={`flex-[2] py-4 rounded-lg font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40 ${isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#7f22fe] hover:bg-[#6b1de0]'}`}
              type="button"
              aria-label={isLoading ? 'Avançando...' : `Avançar para ${getNextStatus(currentPedido.status) || 'próxima etapa'}`}
            >
              {isLoading
                ? <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                : <><i className="fas fa-arrow-right mr-2" aria-hidden="true"></i>Avançar Etapa</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ToastContainer — sistema de notificações com aria-live e barra de progresso real
//
// Melhorias vs original:
// 1. aria-live="polite" + role="status" — leitores de tela anunciam cada toast
// 2. Barra de progresso com valor real via setInterval (não CSS puro)
//    → o operador vê exatamente quanto tempo ainda tem para ler
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ toast }) {
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const duration = toast.duration || 6000
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(pct)
    }, 50)
    return () => clearInterval(id)
  }, [toast.duration])

  const styles = {
    success: { bar: 'bg-emerald-500', box: 'bg-white border-emerald-300 text-emerald-900', icon: 'fa-check-circle text-emerald-500' },
    error:   { bar: 'bg-red-500',     box: 'bg-white border-red-300 text-red-900',         icon: 'fa-times-circle text-red-500' },
    warning: { bar: 'bg-yellow-400',  box: 'bg-white border-yellow-300 text-yellow-900',   icon: 'fa-exclamation-triangle text-yellow-500' },
    info:    { bar: 'bg-blue-500',    box: 'bg-white border-blue-300 text-blue-900',        icon: 'fa-info-circle text-blue-500' },
  }
  const s = styles[toast.type] || styles.info

  return (
    <div className={`relative overflow-hidden flex items-start gap-3 p-4 rounded-xl border shadow-xl text-sm font-medium ${s.box}`}>
      <i className={`fas ${s.icon} mt-0.5 shrink-0 text-base`} aria-hidden="true"></i>
      <span className="flex-1 leading-relaxed">{toast.message}</span>
      {/* Barra de progresso com valor real — não é apenas animação CSS */}
      <div
        className={`absolute bottom-0 left-0 h-1 rounded-b-xl transition-none ${s.bar}`}
        style={{ width: `${progress}%` }}
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  )
}

function ToastContainer({ toasts }) {
  return (
    <div
      className="fixed bottom-5 right-5 z-[200] flex flex-col gap-3 max-w-sm pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
      role="status"
    >
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} />
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NexBotBadge — indicador de status do WhatsApp bot
// ─────────────────────────────────────────────────────────────────────────────

function NexBotBadge({ status }) {
  const config = {
    online:   { dot: 'bg-emerald-500',              text: 'WhatsApp Ativo',   ring: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    offline:  { dot: 'bg-gray-400',                 text: 'WhatsApp Offline', ring: 'border-gray-200 bg-gray-50 text-gray-500' },
    checking: { dot: 'bg-yellow-400 animate-pulse', text: 'Verificando...',   ring: 'border-yellow-200 bg-yellow-50 text-yellow-600' },
  }
  const c = config[status] ?? config.checking

  return (
    <div
      className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold ${c.ring}`}
      role="status"
      aria-label={`Status do WhatsApp: ${c.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${c.dot}`} aria-hidden="true" />
      <i className="fab fa-whatsapp" aria-hidden="true" />
      {c.text}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ElectronBanner — aviso quando o gestor está rodando no navegador
// ─────────────────────────────────────────────────────────────────────────────

function ElectronBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('https://github.com/nadingarcia/gestor-pedidos/releases/latest')

  useEffect(() => {
    fetch('https://api.github.com/repos/nadingarcia/gestor-pedidos/releases/latest')
      .then(r => r.json())
      .then(data => {
        const exe = data.assets?.find(a => a.name.endsWith('.exe'))
        if (exe) setDownloadUrl(exe.browser_download_url)
      })
      .catch(() => {}) // fallback já está no estado inicial
  }, [])

  if (electronAPI.isElectron() || dismissed) return null

  return (
    <div
      className="fixed bottom-5 left-5 z-[200] max-w-sm w-full bg-white border-2 border-[#7f22fe] rounded-2xl shadow-2xl overflow-hidden"
      role="alert"
      aria-live="polite"
    >
      <div className="bg-[#7f22fe] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <i className="fas fa-bolt" aria-hidden="true"></i>
          Gestor de Pedidos — Versão Desktop
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-white/70 hover:text-white transition-colors"
          aria-label="Fechar aviso"
          type="button"
        >
          <i className="fas fa-times text-sm" aria-hidden="true"></i>
        </button>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-700 font-medium leading-relaxed">
          Você está usando o Gestor no navegador.{' '}
          <strong className="text-gray-900">Algumas funcionalidades estão indisponíveis:</strong>
        </p>

        <ul className="space-y-1.5 text-sm text-gray-600">
          {[
            ['fa-print',     'Impressão automática na térmica'],
            ['fa-tv',        'Display da cozinha (janela separada)'],
            ['fa-bell',      'Notificações nativas do sistema'],
            ['fa-plug',      'Bloqueio de suspensão do PC'],
            ['fa-sync-alt',  'Sincronização em tempo real com cozinha'],
          ].map(([icon, label]) => (
            <li key={label} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <i className={`fas ${icon} text-red-500 text-[10px]`} aria-hidden="true"></i>
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ul>

        <div className="pt-1 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">
            Baixe o app desktop para ter a experiência completa:
          </p>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#7f22fe] hover:bg-[#6b1de0] text-white rounded-lg font-bold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40"
          >
            <i className="fas fa-download" aria-hidden="true"></i>
            Baixar Gestor de Pedidos (.exe)
          </a>

          {/* Aviso SmartScreen */}
          <p className="text-[11px] text-gray-400 text-center mt-2 leading-relaxed">
            <i className="fas fa-shield-alt mr-1"></i>
            Se o Windows exibir um aviso de segurança, clique em{' '}
            <strong className="text-gray-500">"Mais informações"</strong> e depois em{' '}
            <strong className="text-gray-500">"Executar mesmo assim"</strong>.
          </p>
        </div>
      </div>
    </div>
  )
}

function AccordionSection({ id, icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#7f22fe]/30"
        aria-expanded={open}
        aria-controls={id}
      >
        <span className="flex items-center gap-2 text-sm font-bold text-gray-600 uppercase tracking-wider">
          <i className={`fas fa-${icon} text-gray-400`} aria-hidden="true"></i>
          {title}
        </span>
        <i
          className={`fas fa-chevron-down text-gray-400 text-xs transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={id} className="p-4 space-y-4 bg-white border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  )
}