import { codigoEntrega } from '../utils/codigoEntrega'
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
import { prazoEntregaDaLoja, prazoDoPedido, situacaoDoPrazo } from '@utils/prazoPedido'
import { useOrderClustering } from '@hooks/useOrderClustering'
import { ClusterFloatingCard } from '../components/ClusterFloatingCard'
import { useNexBotStatus } from '@hooks/useNexBotStatus'
import { apiFetch, API_PRINCIPAL, usandoServidorReserva, aoMudarServidor } from '../utils/apiFetch'
import { resolverStatusLoja, proximaTrocaStatusLoja } from '../utils/statusLoja'
import { conectarCanal } from '../utils/tempoReal'
import { RespostaChamado } from '../components/RespostaChamado'
import { getNomeComputador, getNomeDoSistema, salvarNomeComputador } from '../utils/gestorIdentidade'
import { PEDIDO_TESTE_IMPRESSAO } from '../components/PedidoTeste'
import packageInfo from '../../package.json'
import notificationSoundUrl from '../assets/notification.mp3'
import { linhaComplemento } from '../utils/complementos'
import { getTipoPedidoLabel, isDelivery } from '@utils/orderType'

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETONS DE MÓDULO
// Criados uma única vez quando o bundle carrega.
// Sobrevivem a remounts do componente — evitam dupla impressão
// mesmo que React desmonte e remonte (StrictMode, troca de rota).
// ─────────────────────────────────────────────────────────────────────────────

/** Set global de IDs já processados — persiste entre remounts */
const globalProcessedIds = new Set()

/**
 * Instância única do áudio de notificação.
 * preload="auto" faz o browser baixar o arquivo imediatamente,
 * eliminando o delay na primeira notificação.
 */
const notificationAudio = new Audio(notificationSoundUrl)
notificationAudio.preload = 'auto'

// ─────────────────────────────────────────────────────────────────────────────
// CACHE LOCAL DE PEDIDOS
// Elimina a tela em branco no mount e mantém operação durante quedas de API.
// Dados com mais de 8h são descartados — evita exibir pedidos de ontem.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'nexfood_pedidos_cache'
const CACHE_MAX_AGE_MS = 8 * 60 * 60 * 1000 // 8 horas
const PRINT_STATUS_KEY = 'nexfood_order_print_status'
// Reserva do renderer: um pouco acima dos 30 s do processo principal, que normalmente responde antes
const LIMITE_RESPOSTA_IMPRESSAO_MS = 35 * 1000
const AVISO_FILA_IMPRESSORA = 'Confira a fila da impressora antes de reimprimir: o trabalho pode sair atrasado.'
const PREFIXO_NEXBOT = 'NexBot:'
// Toque logo depois do alarme aparecer é engano (ex.: duplo clique no alarme anterior da fila)
const CHAMADO_IGNORAR_TOQUE_MS = 500

const lerRecadoChamado = (recado) => {
  const texto = (recado || '').trim()
  if (!texto.startsWith(PREFIXO_NEXBOT)) return { doNexBot: false, recado: recado || null }
  const semPrefixo = texto.slice(PREFIXO_NEXBOT.length).trim()
  return { doNexBot: true, recado: semPrefixo ? semPrefixo[0].toUpperCase() + semPrefixo.slice(1) : null }
}
const ORDER_REFRESH_SECONDS = 10
// Com o canal de avisos ligado, pedido novo chega em segundos e a consulta vira só a reserva
const ORDER_REFRESH_COM_CANAL_MS = 30 * 1000
const PERFIL_SEM_CANAL_MS = 60 * 1000
const PERFIL_SEGURANCA_COM_CANAL_MS = 30 * 60 * 1000

const readPedidosCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { timestamp, data } = JSON.parse(raw)
    if (Date.now() - timestamp > CACHE_MAX_AGE_MS) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return data
  } catch {
    return null
  }
}

const writePedidosCache = (data) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data,
    }))
  } catch {} // quota exceeded — silencioso
}

const readPrintStatuses = () => {
  try {
    return JSON.parse(localStorage.getItem(PRINT_STATUS_KEY) || '{}')
  } catch {
    return {}
  }
}

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

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

const DISCOUNT_LABELS = {
  CASHBACK: 'Cashback',
  DESCONTO_PERCENTUAL: 'Desconto percentual',
  PRIMEIRA_COMPRA: 'Primeira compra',
  MINIJOGO: 'Minijogo',
  MINI_JOGO: 'Minijogo',
  'MINI-GAME': 'Minijogo',
  MINIGAME: 'Minijogo',
  CAMPANHA: 'Campanha',
  COMBINADO: 'Desconto combinado',
}

const getDiscountInfo = (pedido) => {
  if (!pedido || Number(pedido.desconto || 0) <= 0) return null

  const origem = String(pedido.origemDesconto || '').trim().toUpperCase()
  const campanhaNome = String(pedido.campanha?.nome || '').trim()
  const campanhaPercentual = Number(pedido.campanha?.valorDesconto || 0)

  if (campanhaNome) {
    const campaignLabel = campanhaPercentual > 0
      ? `Campanha: ${campanhaNome} (${campanhaPercentual}% OFF)`
      : `Campanha: ${campanhaNome}`

    return {
      label: origem === 'COMBINADO' ? `${campaignLabel} + Cashback` : campaignLabel,
      shortLabel: campanhaNome,
      isCampaign: true,
    }
  }

  const label = DISCOUNT_LABELS[origem] || 'Desconto'
  return { label, shortLabel: label, isCampaign: false }
}

const hasOrderObservation = (pedido) =>
  Boolean(String(pedido?.observacao || pedido?.observacoes || '').trim()) ||
  (pedido?.itens || []).some((item) =>
    String(item?.observacao || item?.observacoes || item?.obs || '').trim()
  )

// (31) 99100-0042 — aceita com ou sem o 55 na frente; formato desconhecido volta como veio
const formatTelefone = (value) => {
  let digits = String(value || '').replace(/\D/g, '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return value || ''
}

// trocoPara = valor da nota com que o cliente vai pagar (não o troco em si)
const getTrocoInfo = (pedido) => {
  const pagaCom = Number(pedido?.trocoPara || 0)
  const troco = Math.round((pagaCom - Number(pedido?.total || 0)) * 100) / 100
  return { pagaCom, troco: troco > 0 ? troco : 0 }
}

const getPaymentInfo = (pedido) => {
  const method = String(pedido?.formaPagamento || '').toLowerCase()
  const status = String(pedido?.statusPagamento || '').toLowerCase()
  const total = Number(pedido?.total || 0)
  const isOnline = ['online_card', 'online_pix', 'pix_online', 'mercadopago'].includes(method)

  if (isOnline && ['approved', 'aprovado', 'pago'].includes(status)) {
    return {
      label: 'PAGO ONLINE',
      shortLabel: 'PAGO ONLINE',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: 'fa-circle-check',
    }
  }

  if (isOnline && ['refused', 'recusado', 'rejeitado'].includes(status)) {
    return {
      label: 'PAGAMENTO RECUSADO',
      shortLabel: 'RECUSADO',
      className: 'bg-red-50 text-red-700 border-red-200',
      icon: 'fa-circle-xmark',
    }
  }

  if (isOnline) {
    return {
      label: 'PAGAMENTO PENDENTE',
      shortLabel: 'PAG. PENDENTE',
      className: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: 'fa-clock',
    }
  }

  if (method === 'dinheiro' && Number(pedido?.trocoPara) > 0) {
    const { pagaCom, troco } = getTrocoInfo(pedido)
    return {
      label: troco > 0
        ? `DINHEIRO · PAGA COM ${formatCurrency(pagaCom)} · LEVAR ${formatCurrency(troco)} DE TROCO`
        : `DINHEIRO · PAGA COM ${formatCurrency(pagaCom)}`,
      shortLabel: troco > 0 ? `LEVAR TROCO ${formatCurrency(troco)}` : `PAGA C/ ${formatCurrency(pagaCom)}`,
      className: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: 'fa-money-bill-wave',
    }
  }

  const methodLabel = {
    dinheiro: 'DINHEIRO',
    pix: 'PIX',
    pix_presencial: 'PIX NA ENTREGA',
    cartao: 'CARTÃO',
    credito: 'CRÉDITO',
    debito: 'DÉBITO',
    debito_maq: 'MAQUININHA',
    refeicao_maq: 'VALE-REFEIÇÃO',
  }[method]

  return {
    label: `COBRAR R$ ${total.toFixed(2).replace('.', ',')}${methodLabel ? ` · ${methodLabel}` : ''}`,
    shortLabel: methodLabel || 'COBRAR',
    className: 'bg-slate-50 text-slate-700 border-slate-200',
    icon: 'fa-wallet',
  }
}

const getTimeElapsed = (dateStr, now = Date.now()) => {
  if (!dateStr) return { minutes: 0, isUrgent: false }
  const minutes = Math.floor((now - new Date(dateStr)) / 60000)
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

const getOrderAction = (pedido) => {
  const delivery = isDelivery(pedido)

  const actions = {
    Recebido: {
      label: 'Aceitar pedido',
      shortLabel: 'ACEITAR',
      loadingLabel: 'Aceitando...',
      successLabel: 'Pedido aceito e enviado para preparação.',
      icon: 'fa-check',
    },
    'Em preparação': delivery
      ? {
          label: 'Enviar para entrega',
          shortLabel: 'ENVIAR',
          loadingLabel: 'Enviando...',
          successLabel: 'Pedido enviado para entrega.',
          icon: 'fa-motorcycle',
        }
      : {
          label: 'Liberar para retirada',
          shortLabel: 'LIBERAR',
          loadingLabel: 'Liberando...',
          successLabel: 'Pedido liberado para retirada.',
          icon: 'fa-shopping-bag',
        },
    'Saiu para entrega': delivery
      ? {
          label: 'Marcar como entregue',
          shortLabel: 'ENTREGUE',
          loadingLabel: 'Finalizando...',
          successLabel: 'Pedido marcado como entregue.',
          icon: 'fa-check-circle',
        }
      : {
          label: 'Marcar como retirado',
          shortLabel: 'RETIRADO',
          loadingLabel: 'Finalizando...',
          successLabel: 'Pedido marcado como retirado.',
          icon: 'fa-check-circle',
        },
  }

  return actions[pedido?.status] || null
}

const getPrintStatusInfo = (printStatus) => {
  const status = printStatus?.status || 'not_printed'
  const options = {
    printing: {
      label: 'Imprimindo...',
      shortLabel: 'IMPRIMINDO',
      icon: 'fa-spinner fa-spin',
      className: 'bg-violet-50 border-violet-200 text-violet-700',
    },
    not_printed: {
      label: 'Não impresso',
      shortLabel: 'NÃO IMP.',
      icon: 'fa-print',
      className: 'bg-gray-50 border-gray-200 text-gray-500',
    },
    printed_auto: {
      label: 'Impresso automaticamente',
      shortLabel: 'IMPRESSO',
      icon: 'fa-check',
      className: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    },
    printed_manual: {
      label: 'Impresso',
      shortLabel: 'IMPRESSO',
      icon: 'fa-check',
      className: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    },
    reprinted: {
      label: `Reimpresso${printStatus?.count > 1 ? ` ${printStatus.count}x` : ''}`,
      shortLabel: `REIMP.${printStatus?.count > 1 ? ` ${printStatus.count}x` : ''}`,
      icon: 'fa-copy',
      className: 'bg-blue-50 border-blue-200 text-blue-700',
    },
    failed: {
      label: `Falha na impressão. ${AVISO_FILA_IMPRESSORA}`,
      shortLabel: 'FALHA IMP.',
      icon: 'fa-triangle-exclamation',
      className: 'bg-red-50 border-red-200 text-red-700',
    },
  }

  return options[status] || options.not_printed
}

const getApiErrorMessage = async (res, fallbackMessage) => {
  try {
    const contentType = res.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const data = await res.json()
      return data?.message || data?.error || fallbackMessage
    }

    const text = await res.text()
    return text || fallbackMessage
  } catch {
    return fallbackMessage
  }
}

// "há Xs" / "há N min" desde um instante. Componente próprio para só este texto mudar a cada
// segundo, não o quadro de pedidos inteiro.
function TempoDesde({ desde, emMinutos = false }) {
  const calcular = () => Math.max(0, Math.floor((Date.now() - desde) / 1000))
  const [segundos, setSegundos] = useState(calcular)
  useEffect(() => {
    const atualizar = () => setSegundos(Math.max(0, Math.floor((Date.now() - desde) / 1000)))
    atualizar()
    const id = setInterval(atualizar, emMinutos ? 15000 : 1000)
    return () => clearInterval(id)
  }, [desde, emMinutos])
  return emMinutos ? Math.floor(segundos / 60) : segundos
}

// ─────────────────────────────────────────────────────────────────────────────
// RELÓGIO DOS CARTÕES — um só para o quadro, na virada do minuto
//
// O prazo aparece em minutos ("faltam 12 min"), então nada muda entre um minuto e outro: o relógio
// bate 1 vez por minuto (antes 1 vez por segundo, refazendo todos os cartões para trocar os segundos).
// O prazo da entrega é o que a loja promete ao cliente (Minha Loja), não um número fixo.
// ─────────────────────────────────────────────────────────────────────────────

const TickContext = createContext(Date.now())
const PrazoEntregaContext = createContext(null)
const useTick = () => useContext(TickContext)

function TickProvider({ prazoEntrega = null, children }) {
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    let id = null
    const agendar = () => {
      id = setTimeout(() => { setTick(Date.now()); agendar() }, 60000 - (Date.now() % 60000) + 50)
    }
    agendar()
    return () => clearTimeout(id)
  }, [])

  return (
    <TickContext.Provider value={tick}>
      <PrazoEntregaContext.Provider value={prazoEntrega}>{children}</PrazoEntregaContext.Provider>
    </TickContext.Provider>
  )
}

// Prazo do pedido em minutos, lido do relógio único — sem timer próprio.
// Pedido que chega no meio do minuto usa a hora de agora, não a última batida.
function usePrazoDoPedido(pedido) {
  const tick = useTick()
  const prazoEntrega = useContext(PrazoEntregaContext)
  const prazo = prazoDoPedido(pedido, prazoEntrega)
  const criadoEm = new Date(pedido.createdAt).getTime()
  return { prazo, ...situacaoDoPrazo(criadoEm, prazo, Math.max(tick, criadoEm)) }
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
// HOOK: useOnlineStatus
// Monitora conexão via eventos nativos do browser.
// Quando volta online, dispara callback opcional (ex: refetch automático).
// ─────────────────────────────────────────────────────────────────────────────

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const wasOffline = useRef(false)

  useEffect(() => {
    const handleOnline  = () => { setIsOnline(true);  wasOffline.current = false }
    const handleOffline = () => { setIsOnline(false); wasOffline.current = true  }
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline, wasOffline }
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

  const { fonteTamanho = 12, negritar = false, codigoEntregador = false } = printConfig
  const discountInfo = getDiscountInfo(pedido)
  const restauranteNomeHtml = escapeHtml(nomeRestaurante)
  const restauranteEnderecoHtml = escapeHtml(enderecoRestaurante)
  const cnpjHtml = escapeHtml(cnpjFormatado)
  const numeroPedidoHtml = escapeHtml(getOrderNumber(pedido))
  const clienteNomeHtml = escapeHtml(pedido.cliente?.nome || 'Consumidor')
  const clienteTelefoneHtml = escapeHtml(pedido.cliente?.telefone || '')
  const totalPedidosClienteHtml = escapeHtml(pedido.cliente?.totalPedidos || 0)
  const formaPagamento =
    {
      dinheiro: 'Dinheiro',
      pix: 'Pix na Entrega',
      debito_maq: 'Maquininha',
      cartao: 'Cartão na Entrega',
      online_card: 'Cartão Online',
      pix_online: 'Pix Online',
      mercadopago: 'Mercado Pago',
    }[pedido.formaPagamento] ||
    pedido.formaPagamento?.replace(/_/g, ' ').toUpperCase() ||
    'Não informado'
  const formaPagamentoHtml = escapeHtml(formaPagamento)

  // Escala proporcional derivada do tamanho base escolhido
  const t = {
    base:  `${fonteTamanho}px`,
    title: `${Math.round(fonteTamanho * 1.35)}px`,
    order: `${Math.max(18, fonteTamanho)}px`,
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
      const quantidadeHtml = escapeHtml(item.quantidade)
      const nomeItem = escapeHtml(
        String(item.nome || '').replace(/\s*\(padrão\)/gi, '').trim()
      )
      const complementosHtml = item.complementos?.length
      ? `${item.quantidade > 1 ? '<div class="complementos-label">cada un.:</div>' : ''}
        <div class="complementos">${item.complementos.map(c => escapeHtml(linhaComplemento(c))).join('<br/>')}</div>`
      : ''
      const obsHtml = item.obs
        ? `<div class="obs"><strong>OBS:</strong> ${escapeHtml(item.obs)}</div>`
        : ''
      return `
        <div class="item-row">
          <div class="item-header">
            <span class="qty">${quantidadeHtml}x</span>
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
            --fs-order: ${t.order};
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
          .order-number { display: block; font-size: var(--fs-order); font-weight: var(--fw-heavy); line-height: 1.15; margin-top: 3px; }
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
          .complementos-label { margin-left: 27px; font-size: var(--fs-xs); font-weight: var(--fw-heavy); text-transform: uppercase; letter-spacing: 0.5px; color: #000; margin-bottom: 1px; }
          .obs          { margin-left: 27px; margin-top: 3px; font-weight: var(--fw-heavy); font-size: var(--fs-sm); border-left: 3px solid #000; padding-left: 4px; color: #000; }
          .totals-row   { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: var(--fs-base); font-weight: var(--fw-bold); color: #000; }
          .discount-reason { margin: -2px 0 5px; font-size: var(--fs-sm); font-weight: var(--fw-heavy); text-transform: uppercase; }
          .total-big    { font-size: var(--fs-total); font-weight: var(--fw-heavy); margin-top: 5px; color: #000; }
          .payment-box  { border: 2px solid #000; padding: 5px; margin-top: 8px; text-align: center; font-weight: var(--fw-heavy); font-size: var(--fs-lg); color: #000; }
          .footer       { margin-top: 8px; margin-bottom: 0; text-align: center; font-size: var(--fs-sm); font-weight: var(--fw-bold); color: #000; border-top: 2px dashed #000; padding-top: 6px; padding-bottom: 4px; }
          .footer-brand { font-size: var(--fs-xs); }
          .codigo-entregador { border: 3px solid #000; text-align: center; padding: 4px 0 2px; margin-bottom: 8px; }
          .codigo-rotulo { font-size: var(--fs-sm); font-weight: var(--fw-heavy); text-transform: uppercase; letter-spacing: 1px; }
          .codigo-numero { font-size: 34px; font-weight: 900; letter-spacing: 8px; line-height: 1.1; }
          .fiel         { font-size: var(--fs-sm); font-weight: var(--fw-heavy); color: #000; margin-top: 2px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">${restauranteNomeHtml}</div>
          ${cnpjFormatado ? `<div class="restaurant-address">CNPJ ${cnpjHtml}</div>` : ''}
          ${enderecoRestaurante ? `<div class="restaurant-address">${restauranteEnderecoHtml}</div>` : ''}
          <div class="subtitle">
            ${formatDate(pedido.createdAt)} — ${formatTime(pedido.createdAt)}<br/>
            <span class="order-number">PEDIDO #${numeroPedidoHtml}</span>
          </div>
        </div>

        ${codigoEntregador && isDelivery(pedido) ? `
          <div class="codigo-entregador">
            <div class="codigo-rotulo">Código do entregador</div>
            <div class="codigo-numero">${codigoEntrega(pedido._id)}</div>
          </div>
        ` : ''}

        <div class="info-group">
          <div class="info-label">Cliente</div>
          <div class="info-value">${clienteNomeHtml}</div>
          ${pedido.cliente?.telefone ? `<div class="info-sub">Tel: ${clienteTelefoneHtml}</div>` : ''}
          ${pedido.cliente?.totalPedidos > 0 ? `<div class="fiel">★ Cliente Fiel (${totalPedidosClienteHtml}º pedido)</div>` : ''}
        </div>

        ${isDelivery(pedido) && pedido.enderecoEntrega ? `
          <div class="info-group">
            <div class="info-label">Entrega</div>
            <div class="info-value">${escapeHtml(pedido.enderecoEntrega.rua)}, ${escapeHtml(pedido.enderecoEntrega.numero)}</div>
            <div class="info-sub">${escapeHtml(pedido.enderecoEntrega.bairro)} — ${escapeHtml(pedido.enderecoEntrega.cidade)}</div>
            ${pedido.enderecoEntrega.complemento ? `<div class="info-sub">Comp: ${escapeHtml(pedido.enderecoEntrega.complemento)}</div>` : ''}
          </div>
        ` : `<div class="payment-box">★ RETIRADA NO BALCÃO ★</div>`}

        <div class="divider-bold"></div>
        ${itensHtml}
        <div class="divider-bold"></div>

        <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(pedido.subtotal)}</span></div>
        ${pedido.taxaEntrega > 0 ? `<div class="totals-row"><span>Taxa Entrega</span><span>${formatCurrency(pedido.taxaEntrega)}</span></div>` : ''}
        ${pedido.desconto > 0 ? `<div class="totals-row"><span>Desconto</span><span>- ${formatCurrency(pedido.desconto)}</span></div>` : ''}
        ${discountInfo ? `<div class="discount-reason">Motivo: ${escapeHtml(discountInfo.label)}</div>` : ''}
        <div class="totals-row total-big"><span>TOTAL</span><span>${formatCurrency(pedido.total)}</span></div>

        <div class="divider"></div>
        <div class="info-label">Pagamento</div>
        <div class="info-value">${formaPagamentoHtml}</div>
        ${Number(pedido.trocoPara) > 0 ? `<div class="info-sub">Paga com: ${formatCurrency(pedido.trocoPara)}</div>` : ''}
        ${getTrocoInfo(pedido).troco > 0 ? `<div class="info-value">Levar troco: ${formatCurrency(getTrocoInfo(pedido).troco)}</div>` : ''}

        <div class="footer">
          ${restauranteNomeHtml} • Obrigado pela preferência!<br/>
          <span class="footer-brand">
            NEXFOOD - Tecnologia para Delivery<br/>
            NEX07 • CNPJ 63.805.056/0001-33
          </span>
        </div>
      </body>
    </html>
  `
}

// ─────────────────────────────────────────────────────────────────────────────
// ETIQUETA DE SACOLA — cupom minimalista com número do pedido em destaque
// ─────────────────────────────────────────────────────────────────────────────

const renderEtiquetaSacolaToHTML = (pedido, sacola, totalSacolas, restaurantConfig = {}, codigoEntregador = false) => {
  const { nome: nomeRestaurante = 'Restaurante' } = restaurantConfig
  const restauranteNomeHtml = escapeHtml(nomeRestaurante)
  const orderNumHtml = escapeHtml(getOrderNumber(pedido))
  const clienteNomeHtml = escapeHtml(pedido.cliente?.nome || 'Consumidor')
  const sacolaHtml = escapeHtml(sacola)
  const totalSacolasHtml = escapeHtml(totalSacolas)

  const enderecoHtml =
    isDelivery(pedido) && pedido.enderecoEntrega
      ? `<div class="address">${escapeHtml(pedido.enderecoEntrega.rua)}, ${escapeHtml(pedido.enderecoEntrega.numero)}</div>
         <div class="address-sub">${escapeHtml(pedido.enderecoEntrega.bairro)}${pedido.enderecoEntrega.cidade ? ` — ${escapeHtml(pedido.enderecoEntrega.cidade)}` : ''}</div>`
      : `<div class="address">★ RETIRADA NO BALCÃO ★</div>`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { margin: 0; size: 72mm auto; }
    html, body { height: auto !important; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body {
      font-family: 'Courier New', Courier, monospace;
      width: 70mm; margin: 0; padding: 6px;
      color: #000; display: inline-block;
    }
    .restaurant { font-size: 10px; font-weight: 700; text-align: center; margin-bottom: 4px; }
    .divider    { border-top: 2px dashed #000; margin: 6px 0; }
    .order-num  { font-size: 52px; font-weight: 900; text-align: center; line-height: 1; margin: 4px 0; letter-spacing: -2px; }
    .bag-tag    { font-size: 16px; font-weight: 900; text-align: center; background: #000; color: #fff; padding: 5px 0; border-radius: 4px; margin: 6px 0; letter-spacing: 1px; }
    .label      { font-size: 9px; font-weight: 900; text-transform: uppercase; }
    .client     { font-size: 15px; font-weight: 900; }
    .address    { font-size: 11px; font-weight: 700; }
    .address-sub{ font-size: 10px; }
    .footer     { font-size: 9px; text-align: center; border-top: 1px dashed #000; padding-top: 4px; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="restaurant">${restauranteNomeHtml}</div>
  <div class="divider"></div>
  <div class="order-num">#${orderNumHtml}</div>
  <div class="bag-tag">SACOLA ${sacolaHtml} DE ${totalSacolasHtml}</div>
  ${codigoEntregador && isDelivery(pedido) ? `<div class="label" style="text-align:center;margin-top:4px">Código do entregador</div><div class="order-num" style="font-size:36px;letter-spacing:6px">${codigoEntrega(pedido._id)}</div>` : ''}
  <div class="divider"></div>
  <div class="label">Cliente</div>
  <div class="client">${clienteNomeHtml}</div>
  ${enderecoHtml}
  <div class="footer">NexFood • NEX07</div>
</body>
</html>`
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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showClearDataConfirm, setShowClearDataConfirm] = useState(false)
  const [printers, setPrinters] = useState([])
  const [loadingOrderId, setLoadingOrderId] = useState(null)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [finishedColumnCollapsed, setFinishedColumnCollapsed] = useState(false)
  const [visibleClusters, setVisibleClusters] = useState([])
  const [bagLabelTarget, setBagLabelTarget] = useState(null)
  const [isFromCache, setIsFromCache] = useState(false)
  const [showFaturamento, setShowFaturamento] = useState(
    localStorage.getItem('showFaturamento') !== 'false'
  )
  const [showSlugModal, setShowSlugModal] = useState(false)
  const [printFailure, setPrintFailure] = useState(null)
  const printFailureRef = useRef(null)
  useEffect(() => { printFailureRef.current = printFailure }, [printFailure])
  const [printStatuses, setPrintStatuses] = useState(readPrintStatuses)
  const [printingOrderIds, setPrintingOrderIds] = useState(() => new Set())
  const printingOrderIdsRef = useRef(new Set())

  // ── Estado do indicador "Atualizado há Xs" ────────────────────────────────
  const [lastUpdated, setLastUpdated] = useState(null)
  // O quadro não guarda segundos: o texto "há Xs" fica em <TempoDesde> (só ele muda a cada segundo).
  // Aqui só o que muda o quadro: 60 s sem atualizar (aviso vermelho) e o minuto atual (pedidos atrasados).
  const [semAtualizar, setSemAtualizar] = useState(false)
  const [agoraMinuto, setAgoraMinuto] = useState(() => Date.now())

  // ── Status da loja para o cliente (aberta/fechada/pausada) e servidor em uso ─
  const [lojaInfo, setLojaInfo] = useState(null) // { horarios, statusLoja }
  const [prazoEntrega, setPrazoEntrega] = useState(null) // minutos que a loja promete na entrega
  const [statusLoja, setStatusLoja] = useState(null)
  const buscarLojaRef = useRef(null)
  const canalLigadoRef = useRef(false)
  const [canalLigado, setCanalLigado] = useState(false)
  // Com dois computadores abertos, só o principal aceita e imprime sozinho (o servidor decide)
  const papelRef = useRef(null)
  const [papel, setPapel] = useState(null)
  const [computadoresOnline, setComputadoresOnline] = useState(1)
  // Fila de alarmes (do dono pelo celular ou do NexBot): o primeiro aparece e, ao responder, vem o próximo
  const [chamados, setChamados] = useState([])
  const chamado = chamados[0] || null
  const chamadoMostradoEmRef = useRef(0)
  useEffect(() => { chamadoMostradoEmRef.current = Date.now() }, [chamado?.id])
  const [chamadoVendoPedidoId, setChamadoVendoPedidoId] = useState(null)
  // Quem começa a responder não precisa do alarme tocando enquanto escreve
  const [chamadoMudoId, setChamadoMudoId] = useState(null)
  // Avisos do NexBot ainda abertos, presos ao cartão do pedido (vivem no servidor: sobrevivem a reinício
  // e aparecem em todos os computadores). Não é campo do pedido.
  const [avisos, setAvisos] = useState([])
  const avisosRef = useRef([])
  useEffect(() => { avisosRef.current = avisos }, [avisos])
  const [avisoSaidaTarget, setAvisoSaidaTarget] = useState(null)
  const [sinalNexBot, setSinalNexBot] = useState(0)
  const [nomeComputador, setNomeComputador] = useState(getNomeComputador)
  const ultimaBuscaPedidosRef = useRef(0)
  const [servidorReserva, setServidorReserva] = useState(usandoServidorReserva)
  const [updateState, setUpdateState] = useState({
    status: 'idle',
    progress: 0,
  })

  // ── Busca ─────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')

  // ── Sistema de toasts ─────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  // Dismissal fica a cargo do próprio <Toast> (via onDismiss), que pausa a
  // contagem quando o mouse está em cima — por isso não há setTimeout aqui.
  const addToast = useCallback((message, type = 'info', duration = 6000, action = null) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, type, duration, action }])
  }, [])

  useEffect(() => {
    localStorage.setItem(PRINT_STATUS_KEY, JSON.stringify(printStatuses))
  }, [printStatuses])

  const updatePrintStatus = useCallback((orderId, update) => {
    if (!orderId || orderId === PEDIDO_TESTE_IMPRESSAO._id) return
    setPrintStatuses((prev) => {
      const current = prev[orderId] || { status: 'not_printed', count: 0 }
      const next = typeof update === 'function' ? update(current) : { ...current, ...update }
      return { ...prev, [orderId]: next }
    })
  }, [])

  const getVisiblePrintStatus = useCallback(
    (orderId) =>
      printingOrderIds.has(orderId)
        ? { ...(printStatuses[orderId] || {}), status: 'printing' }
        : printStatuses[orderId],
    [printStatuses, printingOrderIds]
  )

  // ── Ref ao Set global de IDs (singleton de módulo) ────────────────────────
  const processedOrderIds = useRef(globalProcessedIds)

  // ── Ref do AbortController para cancelar fetches obsoletos ───────────────
  const abortControllerRef = useRef(null)

  // ── Refs da sidebar de configurações — fecha com ESC ou clique fora ───────
  const settingsPanelRef = useRef(null)
  const settingsButtonRef = useRef(null)

  // ── Refs dos campos de busca (desktop/mobile) — atalho de teclado "/" ─────
  const desktopSearchRef = useRef(null)
  const mobileSearchRef = useRef(null)

  const navigate = useNavigate()
  const nexBotStatus = useNexBotStatus({ canalLigado, sinal: sinalNexBot })
  const restaurantConfig = useRestaurantConfig()
  const { isOnline, wasOffline } = useOnlineStatus()
  const accountInfo = useMemo(() => {
    let user
    try {
      user = JSON.parse(
        localStorage.getItem('nexfood_user') ||
          sessionStorage.getItem('nexfood_user') ||
          '{}'
      )
    } catch {
      user = {}
    }

    const restaurante =
      user.nomeRestaurante ||
      user.restaurante?.nome ||
      localStorage.getItem('nomeRestaurante') ||
      'Restaurante'

    return {
      restaurante,
      cnpj: restaurantConfig.cnpj,
      slug: user.slug || localStorage.getItem('restauranteSlug') || '',
    }
  }, [restaurantConfig.cnpj])

  // ── Configurações — inicializadas do localStorage de forma síncrona ───────
  const [settings, setSettings] = useState({
    impressoraAutomatica: localStorage.getItem('impressoraAutomatica') || '',
    aceitarAutomatico: localStorage.getItem('aceitarAutomatico') !== 'false',
    notificacoesPush: localStorage.getItem('notificacoesPush') === 'true',
    somNotificacao: localStorage.getItem('somNotificacao') !== 'false',
    tempoRefresh: ORDER_REFRESH_SECONDS,
    agruparPorDistancia:
      localStorage.getItem('agruparPorDistancia') === 'true',
    raioCluster: parseFloat(localStorage.getItem('raioCluster')) || 2,
    enderecoRestaurante:
      localStorage.getItem('enderecoRestaurante') ||
      'Av. Paulista, 1578, São Paulo, SP',
    tempoJanela: parseInt(localStorage.getItem('tempoJanela')) || 30,
    capacidadeEntrega:
      parseInt(localStorage.getItem('capacidadeEntrega')) || 4,
    appEntregador: localStorage.getItem('appEntregador') === 'true',
    fonteTamanho: parseInt(localStorage.getItem('fonteTamanho')) || 12,  // ← faltava
    negritar: localStorage.getItem('negritar') === 'true',
    usarEtiquetasSacola: localStorage.getItem('usarEtiquetasSacola') === 'true',
  })

  // ── Hidratação do cache — executa uma única vez no mount ──────────────────
// Popula os pedidos instantaneamente antes do primeiro fetch terminar.
// O skeleton nunca aparece se houver cache válido.
useEffect(() => {
  const cache = readPedidosCache()
  if (!cache) return
  setPedidos(cache.pedidosConfirmados)
  setPedidosPendentes(cache.aguardandoPagamento)
  setPedidosRecusados(cache.pagamentosRecusados)
  setLoading(false)
  setIsFromCache(true)
}, [])

  /**
   * settingsRef — espelho mutable das settings.
   *
   * Problema anterior: fetchPedidos dependia de [settings.aceitarAutomatico,
   * settings.impressoraAutomatica], forçando o useEffect a recriar o setInterval
   * sempre que qualquer config mudava, causando
   * um burst de requisições paralelas no momento da mudança.
   *
   * Solução: funções de callback leem settingsRef.current no momento da
   * execução, mantendo deps estáveis e o setInterval estável.
   */
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])


  // ── "Sem atualizar há N min": um agendamento só, 60 s depois da última atualização ──────────
  // (antes um relógio de 1 s refazia o quadro inteiro o dia todo para mudar este número)
  useEffect(() => {
    if (!lastUpdated) return
    setSemAtualizar(false)
    const id = setTimeout(() => setSemAtualizar(true), Math.max(0, lastUpdated + 60000 - Date.now()))
    return () => clearTimeout(id)
  }, [lastUpdated])

  // Pedidos atrasados contam em minutos: o quadro confere uma vez por minuto
  useEffect(() => {
    const id = setInterval(() => setAgoraMinuto(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  // ── Status da loja: horários + modo manual vêm do perfil. Com o canal ligado, a busca só acontece
  // no aviso "loja", ao reconectar e, por segurança, a cada 30 min; sem canal, a cada 1 min.
  // A conta aberta/fechada (e o fim da pausa) roda a cada 30 s, sem consultar o servidor.
  useEffect(() => {
    let ativo = true
    let ultimaBusca = 0
    const buscar = async () => {
      ultimaBusca = Date.now()
      try {
        const res = await apiFetch(`${API_PRINCIPAL}/api/restaurante/profile`)
        if (!res.ok) return
        const data = await res.json()
        if (!ativo) return
        setLojaInfo({ horarios: data.horariosFuncionamento || [], statusLoja: data.statusLoja || null })
        setPrazoEntrega(prazoEntregaDaLoja(data.tempoEntrega))
      } catch { /* mantém o último status conhecido */ }
    }
    buscarLojaRef.current = buscar
    buscar()
    const id = setInterval(() => {
      const intervalo = canalLigadoRef.current ? PERFIL_SEGURANCA_COM_CANAL_MS : PERFIL_SEM_CANAL_MS
      if (Date.now() - ultimaBusca >= intervalo) buscar()
    }, PERFIL_SEM_CANAL_MS)
    return () => { ativo = false; buscarLojaRef.current = null; clearInterval(id) }
  }, [])

  // Aberta/fechada/pausada: recalcula só na próxima troca (abrir, fechar, fim da pausa ou meia-noite),
  // e só troca o estado se mudou. Antes recalculava a cada 30 s e refazia o quadro mesmo sem mudar nada.
  useEffect(() => {
    if (!lojaInfo) return
    let id = null
    const calcular = () => {
      const novo = resolverStatusLoja(lojaInfo.horarios, lojaInfo.statusLoja)
      setStatusLoja(atual => (
        atual && atual.estado === novo.estado && atual.manual === novo.manual
          && String(atual.pausaAte) === String(novo.pausaAte) ? atual : novo
      ))
      const alvo = proximaTrocaStatusLoja(lojaInfo.horarios, lojaInfo.statusLoja).getTime() + 1000
      id = setTimeout(calcular, Math.max(1000, alvo - Date.now()))
    }
    calcular()
    return () => clearTimeout(id)
  }, [lojaInfo])

  useEffect(() => aoMudarServidor(setServidorReserva), [])

  // ── Monitorar estado de tela cheia ────────────────────────────────────────
  useEffect(() => {
    const handleChange = () => setIsFullScreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  // ── Sidebar de configurações: fecha com clique fora ───────────────────────
  useEffect(() => {
    if (!showSettings) return

    const isOutside = (target) =>
      !settingsPanelRef.current?.contains(target) &&
      !settingsButtonRef.current?.contains(target)

    const handlePointerDown = (e) => {
      if (isOutside(e.target)) setShowSettings(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showSettings])

  // ── Atalhos de teclado globais ─────────────────────────────────────────────
  // "/" foca a busca (padrão de painéis operacionais). ESC fecha a sidebar
  // aberta ou, se a busca estiver focada com texto, limpa e desfoca.
  useEffect(() => {
    const isTypingContext = (el) =>
      el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showSettings) {
          setShowSettings(false)
          return
        }
        const isSearchFocused =
          document.activeElement === desktopSearchRef.current ||
          document.activeElement === mobileSearchRef.current
        if (isSearchFocused && searchQuery) {
          setSearchQuery('')
          document.activeElement.blur()
        }
        return
      }

      if (e.key === '/' && !isTypingContext(document.activeElement)) {
        e.preventDefault()
        const visibleInput = [desktopSearchRef.current, mobileSearchRef.current].find(
          (el) => el && el.offsetParent !== null
        )
        visibleInput?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showSettings, searchQuery])

  // ── Bloqueio de suspensão enquanto o gestor estiver aberto ───────────────
  useEffect(() => {
    if (!electronAPI.isElectron()) return
    electronAPI.setPowerBlocker(true)
    return () => { electronAPI.setPowerBlocker(false) }
  }, [])

  useEffect(() => {
    if (!electronAPI.isElectron()) return

    electronAPI.onUpdateAvailable(() => {
      setUpdateState({ status: 'downloading', progress: 0 })
    })
    electronAPI.onUpdateDownloadProgress((progress) => {
      setUpdateState({
        status: 'downloading',
        progress: Math.round(progress?.percent || 0),
      })
    })
    electronAPI.onUpdateDownloaded(() => {
      setUpdateState({ status: 'ready', progress: 100 })
    })

    return () => electronAPI.offUpdaterEvents()
  }, [])

  useEffect(() => {
  if (!electronAPI.isElectron()) return
  electronAPI.onKitchenReady(() => {
    electronAPI.pushKitchenOrders(
      pedidos.filter(p => p.status === 'Em preparação')
    )
  })
  return () => electronAPI.offKitchenReady()
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
      const notification = new Notification(title, { body, icon: '/logo.png' })
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    }
  }, [])

  const printWithFeedback = useCallback(
    async (html) => {
      const printerName = settingsRef.current.impressoraAutomatica

      const avisarFalha = (errorMessage) => {
        setPrintFailure({ printerName, message: errorMessage, at: Date.now() })
        addToast(
          `Falha ao imprimir em "${printerName}": ${errorMessage.replace(/\.$/, '')}. ${AVISO_FILA_IMPRESSORA}`,
          'error',
          14000
        )
        return false
      }

      let tempoLimite
      try {
        const semResposta = new Promise((resolve) => {
          tempoLimite = setTimeout(
            () => resolve({ success: false, error: 'A impressora não respondeu' }),
            LIMITE_RESPOSTA_IMPRESSAO_MS
          )
        })
        const res = await Promise.race([electronAPI.printOrder(printerName, html), semResposta])

        if (res?.success) {
          setPrintFailure(null)
          return true
        }

        return avisarFalha(res?.error || 'Verifique se a impressora está ligada e instalada.')
      } catch (err) {
        return avisarFalha(err?.message || 'erro inesperado no spooler de impressão.')
      } finally {
        clearTimeout(tempoLimite)
      }
    },
    [addToast]
  )

  // ── Impressão: restaurantConfig passado como parâmetro (sem getItem extra) ─
  const handlePrint = useCallback(
    async (pedido, { automatic = false } = {}) => {
      const orderId = pedido?._id
      if (!orderId || printingOrderIdsRef.current.has(orderId)) return false

      printingOrderIdsRef.current.add(orderId)
      setPrintingOrderIds((current) => new Set(current).add(orderId))

      const usesElectronPrinter =
        electronAPI?.isElectron?.() && settingsRef.current.impressoraAutomatica

      // No Electron, permite pintar o feedback antes de chamar o spooler.
      // No navegador, window.open precisa continuar ligado diretamente ao clique.
      // Com a janela minimizada ou coberta o Chromium pode não desenhar quadro nenhum, e esperar só
      // pelo requestAnimationFrame travava a impressão em segundo plano: o tempo limite garante a saída.
      if (usesElectronPrinter) {
        await new Promise((resolve) => {
          requestAnimationFrame(() => resolve())
          setTimeout(resolve, 100)
        })
      }

      try {
        const html = renderPedidoToHTML(pedido, restaurantConfig, {
          fonteTamanho: settingsRef.current.fonteTamanho,
          negritar: settingsRef.current.negritar,
          codigoEntregador: settingsRef.current.appEntregador,
        })

        if (usesElectronPrinter) {
          const printed = await printWithFeedback(html)
          if (printed) {
            updatePrintStatus(orderId, (current) => {
              const count = Number(current.count || 0) + 1
              return {
                status: count > 1 ? 'reprinted' : (automatic ? 'printed_auto' : 'printed_manual'),
                count,
                lastPrintedAt: Date.now(),
                printerName: settingsRef.current.impressoraAutomatica,
                error: null,
              }
            })
          } else {
            updatePrintStatus(orderId, {
              status: 'failed',
              lastAttemptAt: Date.now(),
              printerName: settingsRef.current.impressoraAutomatica,
              error: 'Falha ao enviar para a impressora.',
            })
          }
          return printed
        }

        const w = window.open('', '_blank', 'width=380,height=700')
        if (!w) {
          updatePrintStatus(orderId, {
            status: 'failed',
            lastAttemptAt: Date.now(),
            error: 'Pop-up de impressão bloqueado.',
          })
          addToast('Pop-up bloqueado! Permita pop-ups para este site.', 'error', 10000)
          return false
        }
        w.document.open()
        w.document.write(html)
        w.document.close()
        w.onload = () => {
          setTimeout(() => { w.focus(); w.print(); w.onafterprint = () => w.close() }, 200)
        }
        setTimeout(() => { if (!w.closed) { w.focus(); w.print() } }, 1500)
        updatePrintStatus(orderId, (current) => {
          const count = Number(current.count || 0) + 1
          return {
            status: count > 1 ? 'reprinted' : 'printed_manual',
            count,
            lastPrintedAt: Date.now(),
            printerName: 'Impressão do sistema',
            error: null,
          }
        })
        return true
      } finally {
        printingOrderIdsRef.current.delete(orderId)
        setPrintingOrderIds((current) => {
          const next = new Set(current)
          next.delete(orderId)
          return next
        })
      }
    },
    [restaurantConfig, printWithFeedback, updatePrintStatus, addToast]
  )

  // ── Impressão de etiquetas de sacola ──────────────────────────────────────
const handlePrintBagLabels = useCallback(
  async (pedido, totalSacolas) => {
    let etiquetasEnviadas = 0
    for (let i = 1; i <= totalSacolas; i++) {
      const html = renderEtiquetaSacolaToHTML(pedido, i, totalSacolas, restaurantConfig, settingsRef.current.appEntregador)

      if (electronAPI?.isElectron?.() && settingsRef.current.impressoraAutomatica) {
        const printed = await printWithFeedback(html)
        if (!printed) break
        etiquetasEnviadas++
      } else {
        const w = window.open('', '_blank', 'width=380,height=500')
        if (!w) { addToast('Pop-up bloqueado! Permita pop-ups para este site.', 'error', 10000); break }
        w.document.open()
        w.document.write(html)
        w.document.close()
        w.onload = () => {
          setTimeout(() => { w.focus(); w.print(); w.onafterprint = () => w.close() }, 200)
        }
        etiquetasEnviadas++
        setTimeout(() => { if (!w.closed) { w.focus(); w.print() } }, 1500)
      }

      // Pausa entre janelas para não sobrecarregar o spooler
      if (i < totalSacolas) await new Promise((r) => setTimeout(r, 350))
    }
    setBagLabelTarget(null)
    if (etiquetasEnviadas > 0) {
      const plural = etiquetasEnviadas > 1 ? 's' : ''
      addToast(
        '🏷️ ' + etiquetasEnviadas + ' etiqueta' + plural +
          ' enviada' + plural + ' para impressão!',
        'success'
      )
    }
  },
  [restaurantConfig, addToast, printWithFeedback]
)

  // ── API: atualiza status de um pedido ─────────────────────────────────────
  const apiUpdateStatus = async (id, status) => {
    const res = await apiFetch(
      `https://api.nexfood.app/api/pedidos/${id}/status`,
      {
        method: 'PATCH',
        // O backend passa a avisar o cliente (push ou WhatsApp via NexBot).
        // Sem este header ele trata como gestor antigo e não avisa.
        headers: { 'X-Avisos-Cliente': 'backend' },
        body: JSON.stringify({ status }),
      }
    )

    if (!res.ok) {
      const message = await getApiErrorMessage(
        res,
        `Falha ao atualizar status do pedido (${res.status})`
      )
      throw new Error(message)
    }

    return res
  }

  // ── fetchPedidos ──────────────────────────────────────────────────────────
  //
  // Melhorias aplicadas:
  // 1. AbortController: cancela request anterior antes de iniciar um novo,
  //    e cancela ao desmontar — evita state updates em componente morto.
  // 2. settingsRef.current: lê configurações no momento da execução
  //    sem adicionar deps voláteis ao useCallback.
  // 3. Deps estáveis: [playNotificationSound, sendPushNotification,
  //    handlePrint, addToast] — todas são useCallbacks com deps
  //    fixas, então fetchPedidos não é recriado desnecessariamente.
  // ──────────────────────────────────────────────────────────────────────────
  const fetchPedidos = useCallback(async () => {
    // Cancela qualquer request em voo antes de iniciar um novo
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    const { aceitarAutomatico, impressoraAutomatica } = settingsRef.current

    try {
      ultimaBuscaPedidosRef.current = Date.now()
      const res = await apiFetch('https://api.nexfood.app/api/pedidos/dia', {
        signal: abortControllerRef.current.signal,
        headers: {
          'X-Gestor-Versao': packageInfo.version,
          'X-Gestor-Impressora': !electronAPI?.isElectron?.() || !settingsRef.current.impressoraAutomatica
            ? 'sem'
            : printFailureRef.current ? 'falha' : 'ok',
        },
      })

      // Se não for OK (ex: 401 sem renovação), para aqui sem logar erro
      if (!res.ok) return

      // Vem nesta mesma resposta: o segundo computador já abre sabendo que só acompanha
      const papelServidor = res.headers.get('X-Gestor-Papel')
      if (papelServidor) {
        papelRef.current = papelServidor
        setPapel(papelServidor)
      }

      const data = await res.json()

      const sorted = Array.isArray(data)
        ? data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        : []

      const deliveredOrderIds = new Set(
        sorted.filter((pedido) => pedido.status === 'Entregue').map((pedido) => pedido._id)
      )
      if (deliveredOrderIds.size > 0) {
        setPrintStatuses((current) => {
          const next = { ...current }
          let changed = false
          deliveredOrderIds.forEach((orderId) => {
            if (next[orderId]) {
              delete next[orderId]
              changed = true
            }
          })
          return changed ? next : current
        })
      }

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

      writePedidosCache({ pedidosConfirmados, aguardandoPagamento, pagamentosRecusados })
      setIsFromCache(false)

      if (aceitarAutomatico && papelRef.current !== 'acompanhando') {
        const novos = pedidosConfirmados.filter(
          (p) =>
            p.status === 'Recebido' &&
            !processedOrderIds.current.has(p._id)
        )

        for (const pedido of novos) {
          try {
            await apiUpdateStatus(pedido._id, 'Em preparação')
            processedOrderIds.current.add(pedido._id)
            playNotificationSound()
            sendPushNotification(
              'Novo Pedido Aceito!',
              'Pedido #' + pedido._id.slice(-4) + ' enviado para cozinha.'
            )
            if (impressoraAutomatica) handlePrint(pedido, { automatic: true })
            pedido.status = 'Em preparação'
          } catch (err) {
            console.error('Erro ao aceitar pedido automaticamente:', err)
            addToast(
              err?.message || 'Erro ao aceitar pedido automaticamente.',
              'error'
            )
          }
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
      setSemAtualizar(false)
    } catch (error) {
      // AbortError é esperado e silencioso — não é um erro real
      if (error.name === 'AbortError') return
      console.error('Erro fetch:', error)
    } finally {
      setLoading(false)
    }
  }, [playNotificationSound, sendPushNotification, handlePrint, addToast])

  useEffect(() => {
    if (isOnline && wasOffline.current) fetchPedidos()
  }, [isOnline, wasOffline, fetchPedidos])

  // ── Intervalo de refresh ──────────────────────────────────────────────────
  // Pedidos precisam chegar rapido no caixa; mantemos 10s fixo para evitar
  // configuracao operacional desnecessaria.
  useEffect(() => {
    fetchPedidos()
    const interval = setInterval(() => {
      if (canalLigadoRef.current && Date.now() - ultimaBuscaPedidosRef.current < ORDER_REFRESH_COM_CANAL_MS) return
      fetchPedidos()
    }, ORDER_REFRESH_SECONDS * 1000)
    return () => {
      clearInterval(interval)
      abortControllerRef.current?.abort()
    }
  }, [fetchPedidos])

  // ── Ordens vindas do celular ──────────────────────────────────────────────
  // Assumir é atômico no servidor: com dois gestores abertos, só um imprime.
  const handlePrintRef = useRef(handlePrint)
  useEffect(() => { handlePrintRef.current = handlePrint }, [handlePrint])
  const cumprindoComandosRef = useRef(false)

  const cumprirComandos = useCallback(async () => {
    if (cumprindoComandosRef.current) return
    cumprindoComandosRef.current = true
    try {
      const res = await apiFetch(`${API_PRINCIPAL}/api/gestor/comandos/pendentes`)
      if (!res.ok) return
      const comandos = await res.json()
      for (const comando of comandos) {
        const assumido = await apiFetch(`${API_PRINCIPAL}/api/gestor/comandos/${comando._id}/assumir`, { method: 'POST' })
        if (!assumido.ok) continue
        const concluir = (ok, erro = null, resultado = null) => apiFetch(`${API_PRINCIPAL}/api/gestor/comandos/${comando._id}/concluir`, {
          method: 'POST',
          body: JSON.stringify({ ok, erro, resultado }),
        })

        if (comando.tipo === 'desconectar') {
          await concluir(true)
          ;['nexfood_token', 'nexfood_user', 'nexfood_refresh_token'].forEach((key) => localStorage.removeItem(key))
          ;['nexfood_token', 'nexfood_user', 'nexfood_refresh_token'].forEach((key) => sessionStorage.removeItem(key))
          navigate('/login')
          return
        }

        if (comando.tipo === 'chamar') {
          // Fica "assumido" até alguém responder: é isso que o dono vê como resposta no celular
          let pedido = null
          if (comando.pedido) {
            const resPedido = await apiFetch(`${API_PRINCIPAL}/api/pedidos/${comando.pedido}`).catch(() => null)
            if (resPedido?.ok) pedido = await resPedido.json()
          }
          const novoChamado = {
            id: comando._id,
            numero: pedido?.numeroPedido || null,
            pedidoId: comando.pedido || null,
            pedido,
            em: Date.now(),
            ...lerRecadoChamado(comando.recado),
          }
          setChamados((fila) => [...fila, novoChamado])
          electronAPI.chamarAtencao?.()
          continue
        }

        if (comando.tipo === 'atualizar') {
          const resposta = await electronAPI.atualizarAgora()
          const versao = resposta?.versao ? ` ${resposta.versao}` : ''
          if (resposta?.estado === 'instalando') await concluir(true, null, `instalando${versao}`)
          else if (resposta?.estado === 'baixando') await concluir(true, null, `baixando${versao}`)
          else if (resposta?.estado === 'atualizado') await concluir(true, null, `atualizado${versao}`)
          else if (resposta?.estado === 'dev') await concluir(false, 'Gestor em modo de desenvolvimento: não atualiza.')
          else await concluir(false, resposta?.erro || 'Não foi possível procurar atualização.')
          continue
        }

        if (comando.tipo === 'testar-impressora') {
          if (!electronAPI?.isElectron?.() || !settingsRef.current.impressoraAutomatica) {
            await concluir(false, 'O Gestor está sem impressora configurada.')
          } else {
            const ok = await handlePrintRef.current(PEDIDO_TESTE_IMPRESSAO)
            await concluir(ok, ok ? null : 'A impressora não respondeu.')
          }
          continue
        }

        let ok = false
        let erro = null
        try {
          if (!electronAPI?.isElectron?.() || !settingsRef.current.impressoraAutomatica) {
            erro = 'O Gestor está sem impressora configurada.'
          } else {
            const resPedido = await apiFetch(`${API_PRINCIPAL}/api/pedidos/${comando.pedido}`)
            if (!resPedido.ok) throw new Error('Pedido não encontrado.')
            ok = await handlePrintRef.current(await resPedido.json())
            if (!ok) erro = 'A impressora não respondeu.'
          }
        } catch (err) {
          erro = err?.message || 'Falha ao imprimir.'
        }
        await concluir(ok, erro)
      }
    } catch (err) {
      console.error('Erro ao cumprir ordens do celular:', err)
    } finally {
      cumprindoComandosRef.current = false
    }
  }, [navigate])

  // Alarme do chamado: toque próprio (dois tons alternados, tipo sirene curta), diferente do som de pedido
  // novo para não confundir. Toca até alguém responder, mesmo com o som de pedido desligado.
  // Gerado pelo Web Audio, sem arquivo; se o áudio estiver bloqueado, usa o som de pedido como reserva.
  useEffect(() => {
    if (!chamado || chamadoMudoId === chamado.id) return
    let contexto = null
    try {
      contexto = new (window.AudioContext || window.webkitAudioContext)()
    } catch { /* sem Web Audio */ }

    const tocar = () => {
      if (!contexto || contexto.state !== 'running') {
        contexto?.resume().catch(() => {})
        if (contexto?.state !== 'running') {
          notificationAudio.currentTime = 0
          notificationAudio.play().catch(() => {})
          return
        }
      }
      const inicio = contexto.currentTime + 0.05
      // tu-ti tu-ti: 4 notas de 0,2 s
      ;[988, 740, 988, 740].forEach((frequencia, i) => {
        const momento = inicio + i * 0.24
        const oscilador = contexto.createOscillator()
        const volume = contexto.createGain()
        oscilador.type = 'square'
        oscilador.frequency.value = frequencia
        volume.gain.setValueAtTime(0.0001, momento)
        volume.gain.exponentialRampToValueAtTime(0.18, momento + 0.02)
        volume.gain.exponentialRampToValueAtTime(0.0001, momento + 0.2)
        oscilador.connect(volume).connect(contexto.destination)
        oscilador.start(momento)
        oscilador.stop(momento + 0.22)
      })
    }

    contexto?.resume().catch(() => {})
    tocar()
    const id = setInterval(tocar, 2500)
    return () => {
      clearInterval(id)
      contexto?.close().catch(() => {})
    }
  }, [chamado, chamadoMudoId])

  const responderChamado = useCallback(async (resultado = 'visto') => {
    const atual = chamado
    if (!atual || Date.now() - chamadoMostradoEmRef.current < CHAMADO_IGNORAR_TOQUE_MS) return
    setChamados((fila) => fila.filter((item) => item.id !== atual.id))
    // Alarme do NexBot sobre um pedido: "Vi" só cala o alarme; o aviso fica no cartão até alguém resolver
    if (atual.doNexBot && atual.pedidoId) {
      const visto = await apiFetch(`${API_PRINCIPAL}/api/gestor/comandos/${atual.id}/visto`, {
        method: 'POST',
        body: JSON.stringify({ resultado }),
      }).catch(() => null)
      if (visto?.ok) return
      // servidor sem a rota nova: conclui como antes
    }
    await apiFetch(`${API_PRINCIPAL}/api/gestor/comandos/${atual.id}/concluir`, {
      method: 'POST',
      body: JSON.stringify({ ok: true, resultado }),
    }).catch(() => {})
  }, [chamado])

  const buscarAvisos = useCallback(async () => {
    try {
      const inicio = Date.now()
      const res = await apiFetch(`${API_PRINCIPAL}/api/gestor/avisos`)
      if (!res.ok) return
      const lista = await res.json()
      // Aviso fechado fora daqui (a equipe respondeu pelo WhatsApp ou outro computador resolveu):
      // o alarme dele, se ainda estiver tocando, sai da fila. Só vale para alarme anterior a esta busca.
      const abertos = new Set(lista.map((a) => a._id))
      setChamados((fila) => {
        const resto = fila.filter((c) => !(c.doNexBot && c.pedidoId && c.em < inicio && !abertos.has(c.id)))
        return resto.length === fila.length ? fila : resto
      })
      const novos = lista.map((a) => ({ id: a._id, pedidoId: String(a.pedido), ...lerRecadoChamado(a.recado) }))
      // Quase sempre nada mudou: não refaz o quadro à toa
      setAvisos((atuais) => (JSON.stringify(atuais) === JSON.stringify(novos) ? atuais : novos))
    } catch { /* fica com os últimos conhecidos */ }
  }, [])

  // Com `mensagem`, ela vai ao cliente pelo WhatsApp da loja e o aviso fecha; sem, só fecha ("Resolvido").
  // Se o NexBot não enviar, o aviso continua aberto e o caixa responde pelo WhatsApp, como sempre.
  const resolverAviso = useCallback(async (avisoId, mensagem = null) => {
    try {
      const res = await apiFetch(`${API_PRINCIPAL}/api/gestor/avisos/${avisoId}/resolver`, {
        method: 'POST',
        body: JSON.stringify(mensagem ? { mensagem } : {}),
      })
      // 409: outro computador já resolveu
      if (!res.ok && res.status !== 409) {
        const erro = await getApiErrorMessage(res, 'Não foi enviado. Responda pelo WhatsApp da loja.')
        if (!mensagem) addToast(erro, 'error')
        return { ok: false, erro }
      }
      setAvisos((lista) => lista.filter((a) => a.id !== avisoId))
      setChamados((fila) => fila.filter((item) => item.id !== avisoId))
      if (res.ok) addToast(mensagem ? 'Resposta enviada ao cliente pelo WhatsApp.' : 'Aviso resolvido.', 'success')
      buscarAvisos()
      return { ok: true }
    } catch {
      const erro = mensagem ? 'Não foi enviado. Responda pelo WhatsApp da loja.' : 'Não foi possível resolver o aviso. Confira a conexão.'
      if (!mensagem) addToast(erro, 'error')
      return { ok: false, erro }
    }
  }, [addToast, buscarAvisos])

  const buscarPapel = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_PRINCIPAL}/api/gestor/status`)
      if (!res.ok) return
      const dados = await res.json()
      if (dados.papel) {
        papelRef.current = dados.papel
        setPapel(dados.papel)
      }
      setComputadoresOnline((dados.instancias || []).filter((i) => i.online).length || 1)
    } catch { /* fica com o último papel conhecido */ }
  }, [])

  // ── Canal de avisos ───────────────────────────────────────────────────────
  // Espera um instante para uma rajada de gravações virar uma consulta só.
  const fetchPedidosRef = useRef(fetchPedidos)
  useEffect(() => { fetchPedidosRef.current = fetchPedidos }, [fetchPedidos])

  useEffect(() => {
    let timerPedidos = null
    const parar = conectarCanal({
      aoMudarConexao: (ligado) => {
        canalLigadoRef.current = ligado
        setCanalLigado(ligado)
        if (!ligado) return
        fetchPedidosRef.current()
        cumprirComandos()
        buscarAvisos()
        buscarPapel()
        buscarLojaRef.current?.() // a loja pode ter mudado enquanto o canal estava fora
      },
      aoAviso: (tipo) => {
        if (tipo === 'pedido') {
          clearTimeout(timerPedidos)
          timerPedidos = setTimeout(() => fetchPedidosRef.current(), 300)
        } else if (tipo === 'loja') {
          buscarLojaRef.current?.()
        } else if (tipo === 'comando') {
          cumprirComandos()
          buscarAvisos()
        } else if (tipo === 'resposta') {
          buscarAvisos() // outro computador respondeu ou resolveu um aviso
        } else if (tipo === 'gestor') {
          buscarPapel()
        } else if (tipo === 'nexbot') {
          setSinalNexBot((n) => n + 1) // o WhatsApp da loja caiu ou voltou
        }
      },
    })
    buscarAvisos() // vale também para quem só acompanha e quando o canal não abre
    // Sem o canal, a ordem do celular e os avisos ainda chegam, só que em até 30 s
    const reserva = setInterval(() => {
      if (canalLigadoRef.current) return
      cumprirComandos()
      buscarAvisos()
    }, ORDER_REFRESH_COM_CANAL_MS)
    return () => {
      parar()
      clearTimeout(timerPedidos)
      clearInterval(reserva)
      canalLigadoRef.current = false
    }
  }, [cumprirComandos, buscarPapel, buscarAvisos])

  // ── advanceStatus com atualização otimista ────────────────────────────────
  //
  // 1. Atualiza o state local imediatamente → UI responde em < 16ms
  // 2. Dispara a PATCH na API em background
  // 3. Em caso de erro, faz rollback do state e exibe toast de erro
  // 4. Em caso de sucesso, confirma com dados frescos do servidor
  // ──────────────────────────────────────────────────────────────────────────
  const advanceStatus = useCallback(
    async (pedido, { avisoConferido = false } = {}) => {
      const nextStatus = getNextStatus(pedido.status)
      if (!nextStatus) return { success: false, deferred: false }

      // Aviso do NexBot aberto ("quer mudar o endereço"): confirma antes de o pedido sair
      if (
        nextStatus === 'Saiu para entrega' &&
        !avisoConferido &&
        avisosRef.current.some((a) => a.pedidoId === pedido._id)
      ) {
        setAvisoSaidaTarget(pedido)
        return { success: false, deferred: true }
      }

      setLoadingOrderId(pedido._id)
      setPedidos((prev) =>
        prev.map((p) => p._id === pedido._id ? { ...p, status: nextStatus } : p)
      )

      try {
        await apiUpdateStatus(pedido._id, nextStatus)

        if (nextStatus === 'Em preparação' && settingsRef.current.impressoraAutomatica) {
          handlePrint(pedido, { automatic: true })
        }

        // Com o canal ligado, o aviso do servidor já busca a lista nova (uma busca por clique, não duas)
        if (!canalLigadoRef.current) await fetchPedidos()
        addToast(
          getOrderAction(pedido)?.successLabel || 'Status do pedido atualizado.',
          'success',
          15000,
          {
            label: 'Desfazer',
            onClick: async () => {
              setLoadingOrderId(pedido._id)

              try {
                const currentRes = await apiFetch(
                  `https://api.nexfood.app/api/pedidos/${pedido._id}`
                )
                if (!currentRes.ok) {
                  throw new Error(await getApiErrorMessage(currentRes, 'Não foi possível conferir o pedido.'))
                }

                const currentOrder = await currentRes.json()
                if (currentOrder.status !== nextStatus) {
                  addToast('O pedido já mudou de etapa e não pode mais ser desfeito.', 'warning')
                  return false
                }

                await apiUpdateStatus(pedido._id, pedido.status)
                setPedidos((prev) =>
                  prev.map((item) =>
                    item._id === pedido._id ? { ...item, status: pedido.status } : item
                  )
                )
                if (!canalLigadoRef.current) await fetchPedidos()
                addToast('Alteração de status desfeita.', 'info')
                return true
              } catch (err) {
                addToast(err?.message || 'Não foi possível desfazer a alteração.', 'error', 10000)
                return false
              } finally {
                setLoadingOrderId(null)
              }
            },
          }
        )
        return { success: true, deferred: false }
      } catch (err) {
        setPedidos((prev) =>
          prev.map((p) => p._id === pedido._id ? { ...p, status: pedido.status } : p)
        )
        addToast(
          err?.message || 'Erro ao atualizar status. Verifique a conexão e tente novamente.',
          'error'
        )
        return { success: false, deferred: false }
      } finally {
        setLoadingOrderId(null)
      }
    },
    [handlePrint, fetchPedidos, addToast]
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

  const handleConfirmLogout = useCallback(() => {
    ['nexfood_token', 'nexfood_user', 'nexfood_refresh_token'].forEach((key) => localStorage.removeItem(key))
    sessionStorage.removeItem('nexfood_token')
    sessionStorage.removeItem('nexfood_refresh_token')
    sessionStorage.removeItem('nexfood_user')
    setShowLogoutConfirm(false)
    navigate('/login')
  }, [navigate])

  const handleClearLocalData = useCallback(() => {
    localStorage.clear()
    sessionStorage.clear()
    setShowClearDataConfirm(false)
    navigate('/login')
  }, [navigate])

  const handleInstallUpdate = useCallback(() => {
    electronAPI.installUpdate()
  }, [])

  // ── Derivações memoizadas dos pedidos ─────────────────────────────────────
  const avisosPorPedido = useMemo(() => {
    const mapa = new Map()
    // O cliente pode insistir no mesmo assunto: vira um aviso só (resolver fecha os iguais no servidor)
    avisos.forEach((a) => {
      const doPedido = mapa.get(a.pedidoId) || []
      if (!doPedido.some((outro) => outro.recado === a.recado)) mapa.set(a.pedidoId, [...doPedido, a])
    })
    return mapa
  }, [avisos])

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
      const normalizedQuery = query.toLowerCase()
      const queryDigits = query.replace(/\D/g, '')
      resultado = resultado.filter((p) => {
        const phoneDigits = String(p.cliente?.telefone || '').replace(/\D/g, '')
        const directMatch =
          String(getOrderNumber(p)).toLowerCase().includes(normalizedQuery) ||
          String(p._id || '').toLowerCase().includes(normalizedQuery) ||
          (queryDigits.length >= 3 && phoneDigits.endsWith(queryDigits))
        const searchText = [
          getOrderNumber(p),
          p._id || '',
          p.cliente?.nome || '',
          p.cliente?.telefone || '',
          p.enderecoEntrega?.rua || '',
          p.enderecoEntrega?.bairro || '',
          ...(p.itens || []).map((i) => i.nome),
        ].join(' ')
        return directMatch || fuzzyMatch(searchText, query)
      })
    }

    return resultado
  }, [pedidosComClusters, searchQuery])

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

  // Todos os entregues do dia, mesmo com busca ativa (a busca só esconde cartões)
  const totalDia = useMemo(
    () => pedidos.reduce((acc, curr) => acc + (curr.status === 'Entregue' ? curr.total || 0 : 0), 0),
    [pedidos]
  )

  // ── Alarme recorrente para pedido novo aguardando aceite ──────────────────
  // Um beep único se perde num caixa/cozinha barulhento. Enquanto houver
  // pedido em "Recebido" pendente de aceite manual, repete o som até o
  // operador aceitar — evita pedido esquecido na fila.
  const pendingAcceptCount = columns.pendente.length
  useEffect(() => {
    if (settings.aceitarAutomatico || pendingAcceptCount === 0) return
    const interval = setInterval(() => playNotificationSound(), 25000)
    return () => clearInterval(interval)
  }, [settings.aceitarAutomatico, pendingAcceptCount, playNotificationSound])

  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) =>
        console.log(err)
      )
    } else {
      document.exitFullscreen()
    }
  }, [])

  const advanceCluster = useCallback(
    async (clusterId) => {
      const clusterOrders = pedidosComClusters.filter(
        (p) => p.clusterId === clusterId
      )
      // No avanço em grupo, pedido com aviso aberto não sai junto: fica para alguém conferir
      const comAviso = clusterOrders.filter(
        (p) => getNextStatus(p.status) === 'Saiu para entrega' && avisosRef.current.some((a) => a.pedidoId === p._id)
      )
      for (const pedido of clusterOrders) {
        if (comAviso.includes(pedido)) continue
        await advanceStatus(pedido)
      }
      if (comAviso.length) {
        addToast(
          `${comAviso.map((p) => `#${getOrderNumber(p)}`).join(', ')} não saiu: tem aviso do cliente aberto. Confira o pedido.`,
          'warning',
          15000
        )
      }
      if (!canalLigadoRef.current) await fetchPedidos()
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
    [pedidosComClusters, advanceStatus, fetchPedidos, addToast]
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

  const delayedOrders = useMemo(
    () => {
      const elapsedAt = Math.max(agoraMinuto, lastUpdated || 0)

      return pedidosComClusters.filter((p) => {
        if (['Entregue', 'Cancelado'].includes(p.status)) return false
        return situacaoDoPrazo(p.createdAt, prazoDoPedido(p, prazoEntrega), elapsedAt).atrasado
      })
    },
    [pedidosComClusters, lastUpdated, agoraMinuto, prazoEntrega]
  )

  const operationalAlerts = useMemo(() => {
    const alerts = []

    if (delayedOrders.length > 0) {
      alerts.push({
        id: 'delayed-orders',
        severity: 'critical',
        icon: 'fa-stopwatch',
        label: `${delayedOrders.length} atrasado${delayedOrders.length > 1 ? 's' : ''}`,
        detail: `Mais antigo #${getOrderNumber(delayedOrders[0])}`,
        onClick: () => setSelectedOrder(delayedOrders[0]),
      })
    }

    if (pedidosRecusados.length > 0) {
      alerts.push({
        id: 'pix-recused',
        severity: 'critical',
        icon: 'fa-circle-xmark',
        label: `${pedidosRecusados.length} Pix recusado${pedidosRecusados.length > 1 ? 's' : ''}`,
        detail: `Pedido #${getOrderNumber(pedidosRecusados[0])}`,
        onClick: () => setSelectedOrder(pedidosRecusados[0]),
      })
    }

    if (pedidosPendentes.length > 0) {
      alerts.push({
        id: 'pix-pending',
        severity: 'warning',
        icon: 'fa-clock',
        label: `${pedidosPendentes.length} Pix pendente${pedidosPendentes.length > 1 ? 's' : ''}`,
        detail: `Aguardando confirmação`,
        onClick: () => setSelectedOrder(pedidosPendentes[0]),
      })
    }

    if (printFailure) {
      alerts.push({
        id: 'print-failure',
        severity: 'critical',
        icon: 'fa-print',
        label: 'Falha ao imprimir',
        detail: `${printFailure.printerName || printFailure.message}. ${AVISO_FILA_IMPRESSORA}`,
      })
    }

    if (nexBotStatus === 'offline') {
      alerts.push({
        id: 'nexbot-offline',
        severity: 'warning',
        icon: 'fa-brands fa-whatsapp',
        label: 'NexBot offline',
        detail: 'Clientes sem WhatsApp automático',
      })
    }

    if (!isOnline || isFromCache) {
      alerts.push({
        id: 'offline-cache',
        severity: !isOnline ? 'critical' : 'warning',
        icon: 'fa-wifi',
        label: !isOnline ? 'Loja sem internet' : 'Modo cache',
        detail: !isOnline ? 'Exibindo últimos dados salvos' : 'Sincronizando pedidos',
      })
    }

    return alerts
  }, [
    delayedOrders,
    pedidosRecusados,
    pedidosPendentes,
    printFailure,
    nexBotStatus,
    isOnline,
    isFromCache,
  ])

  // ── Skeleton durante loading inicial ─────────────────────────────────────
  if (loading) {
    return (
      <KanbanSkeleton hasNewOrdersColumn={!settings.aceitarAutomatico} />
    )
  }

  const pedidoDoChamado = chamado
    ? pedidosComClusters.find((p) => p._id === chamado.pedidoId) || chamado.pedido
    : null
  const chamadoRecolhido = Boolean(chamado && selectedOrder && chamadoVendoPedidoId === chamado.id)
  // Alarme do NexBot sobre um pedido: dá para responder ao cliente daqui e o aviso fica preso ao cartão
  const chamadoComAviso = Boolean(chamado?.doNexBot && chamado.pedidoId)

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <TickProvider prazoEntrega={prazoEntrega}>
      <div className="h-screen overflow-hidden bg-white text-gray-900 flex flex-col">

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
                {/* Duas informações diferentes, antes misturadas em "Loja Online" (que só media a internet):
                    1) a loja como o cliente vê no app (aberta/fechada/pausada, pelo horário ou manual do painel);
                    2) a conexão do gestor (internet, servidor reserva, última atualização). */}
                <div className="flex items-center gap-2 text-sm">
                {statusLoja && (
                  <span
                    className={`inline-flex items-center gap-1.5 font-semibold ${
                      statusLoja.estado === 'aberta' ? 'text-emerald-700'
                        : statusLoja.estado === 'pausada' ? 'text-orange-600'
                        : 'text-gray-500'
                    }`}
                    title={statusLoja.manual
                      ? 'Como os clientes veem a loja no app agora (definido manualmente no painel)'
                      : 'Como os clientes veem a loja no app agora (pelo horário de funcionamento)'}
                    aria-live="polite"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        statusLoja.estado === 'aberta' ? 'bg-emerald-500'
                          : statusLoja.estado === 'pausada' ? 'bg-orange-500'
                          : 'bg-gray-400'
                      }`}
                      aria-hidden="true"
                    />
                    {statusLoja.estado === 'aberta' && 'Loja aberta'}
                    {statusLoja.estado === 'fechada' && 'Loja fechada'}
                    {statusLoja.estado === 'pausada' && (statusLoja.pausaAte
                      ? `Pausada até ${statusLoja.pausaAte.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Loja pausada')}
                    {statusLoja.manual && statusLoja.estado !== 'pausada' && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">manual</span>
                    )}
                  </span>
                )}
                {isOnline ? (
                  <>
                    {/* Prioridade: pedidos parados (nem o principal nem a reserva responderam) > reserva em uso */}
                    {lastUpdated && !isFromCache && semAtualizar ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700"
                        title="Os pedidos não estão sendo atualizados: o servidor não respondeu. Pedidos novos podem não aparecer."
                        role="alert"
                      >
                        <i className="fas fa-triangle-exclamation text-[10px]" aria-hidden="true" />
                        Sem atualizar há <TempoDesde desde={lastUpdated} emMinutos /> min
                      </span>
                    ) : servidorReserva ? (
                      <span
                        className="text-xs font-semibold text-amber-700"
                        title="O servidor principal não respondeu. O gestor está usando o servidor reserva e volta sozinho ao principal."
                        role="status"
                      >
                        {statusLoja ? '· ' : ''}Servidor reserva
                      </span>
                    ) : canalLigado && !isFromCache ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"
                        title="Conectado ao servidor: pedidos novos e mudanças chegam em segundos."
                        role="status"
                      >
                        {statusLoja ? '· ' : ''}
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                        Ao vivo
                        {computadoresOnline > 1 && papel && (
                          <span
                            className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              papel === 'principal' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'
                            }`}
                            title={papel === 'principal'
                              ? 'Há outro Gestor aberto. Este é o principal: aceita e imprime sozinho.'
                              : 'Há outro Gestor aberto e ele é o principal. Este só acompanha: não aceita nem imprime sozinho.'}
                          >
                            {papel === 'principal' ? 'Principal' : 'Só acompanhando'}
                          </span>
                        )}
                      </span>
                    ) : lastUpdated && !isFromCache ? (
                      <span className="text-xs text-gray-400 hidden lg:inline">
                        {statusLoja ? '· ' : ''}Atualizado há <TempoDesde desde={lastUpdated} />s
                      </span>
                    ) : null}
                    {isFromCache && (
                      <span className="text-xs text-amber-600 hidden lg:inline">
                        · Sincronizando...
                      </span>
                    )}
                  </>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-full"
                    title="Sem conexão com a internet. Exibindo últimos dados salvos."
                    role="alert"
                  >
                    <i className="fas fa-wifi text-[10px]" aria-hidden="true" />
                    Sem conexão
                    {isFromCache && <span className="font-normal opacity-80">· modo cache</span>}
                  </span>
                )}
              </div>
              </div>
            </div>

            {/* Barra de busca desktop */}
            <div className="flex-1 max-w-md hidden lg:block">
              <div className="relative">
                <input
                  ref={desktopSearchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar nº do pedido, cliente ou telefone"
                  title="Atalho: tecla /"
                  className="peer w-full pl-10 pr-10 py-2 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:outline-none focus:border-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/20 transition-all"
                  aria-label="Buscar pedidos (atalho: tecla /)"
                />
                <i
                  className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
                  aria-hidden="true"
                ></i>
                {/* Mostra o atalho enquanto o campo está vazio e sem foco */}
                {!searchQuery && (
                  <kbd
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-gray-500 shadow-sm peer-focus:hidden"
                    aria-hidden="true"
                  >
                    /
                  </kbd>
                )}
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

              {/* Busca ativa: os pedidos que não batem ficam escondidos, inclusive um novo que chegue */}
              {searchQuery.trim() && (
                <div
                  className="hidden md:flex items-center gap-2 px-3 py-2 bg-[#7f22fe]/10 border border-[#7f22fe]/30 rounded-lg"
                  role="status"
                >
                  <i className="fas fa-search text-[#7f22fe] text-sm" aria-hidden="true"></i>
                  <span className="text-sm font-bold text-[#7f22fe] whitespace-nowrap">
                    Busca ativa · {pedidosFiltrados.length} de {pedidosComClusters.length}{' '}
                    {pedidosComClusters.length === 1 ? 'pedido' : 'pedidos'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="ml-1 text-[#7f22fe] hover:text-[#6b1de0]"
                    aria-label="Limpar busca e mostrar todos os pedidos"
                    title="Limpar busca"
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
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                    Faturamento (Entregues)
                  </span>
                  <button
                    onClick={() => {
                      const next = !showFaturamento
                      setShowFaturamento(next)
                      localStorage.setItem('showFaturamento', String(next))
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
                    aria-label={showFaturamento ? 'Ocultar faturamento' : 'Mostrar faturamento'}
                    title={showFaturamento ? 'Ocultar' : 'Mostrar'}
                    type="button"
                  >
                    <i className={`fas ${showFaturamento ? 'fa-eye' : 'fa-eye-slash'} text-xs`} aria-hidden="true" />

                  </button>
                </div>
                <span className="text-xl font-bold text-emerald-600 tabular-nums tracking-wide">
                  {showFaturamento ? formatCurrency(totalDia) : '•••••'}
                </span>
              </div>

              {nexBotStatus === 'online' && <NexBotBadge status={nexBotStatus} />}

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
                ref={settingsButtonRef}
                onClick={() => {
                  setShowSettings(!showSettings)
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
                ref={mobileSearchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pedido, cliente ou últimos dígitos do telefone..."
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

          <OperationalAlertsBar alerts={operationalAlerts} />
        </header>

        {/* ── Corpo principal ────────────────────────────────────────────── */}
        <div className="relative flex flex-1 min-h-0">

          {/* Kanban Board */}
          <main
            className="flex-1 p-6 overflow-x-auto overflow-y-hidden bg-gray-50"
            role="main"
            aria-label="Quadro Kanban de pedidos"
          >
            <div
              className={`grid gap-4 h-full min-h-0 auto-rows-fr transition-all ${
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
                  isAlerting={pendingAcceptCount > 0}
                >
                  {columns.pendente.map((p) => (
                    <OrderCard
                      key={p._id}
                      pedido={p}
                      onClick={() => setSelectedOrder(p)}
                      onAdvance={() => advanceStatus(p)}
                      onPrint={() => handlePrint(p)}
                      avisos={avisosPorPedido.get(p._id)}
                      codigoEntregador={settings.appEntregador}
                      printStatus={getVisiblePrintStatus(p._id)}
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
                    avisos={avisosPorPedido.get(p._id)}
                    codigoEntregador={settings.appEntregador}
                    printStatus={getVisiblePrintStatus(p._id)}
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
                title="Em entrega · Retirada"
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
                    avisos={avisosPorPedido.get(p._id)}
                    codigoEntregador={settings.appEntregador}
                    printStatus={getVisiblePrintStatus(p._id)}
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
                    printStatus={getVisiblePrintStatus(p._id)}
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

          {/* ── Sidebar: Configurações ─────────────────────────────────── */}
          <aside
            ref={settingsPanelRef}
            id="sidebar-configuracoes"
            className={`absolute top-0 right-0 h-full w-96 bg-white border-l border-gray-200 shadow-xl transition-all duration-300 z-40 overflow-y-auto ${
              showSettings ? 'translate-x-0' : 'translate-x-full'
            }`}
            aria-hidden={!showSettings}
            aria-label="Painel de configurações"
          >
            <div className="p-4 space-y-3">

            {/* ── Operação ──────────────────────────────────────────────── */}
            <AccordionSection id="acc-operacao" icon="store" title="Operação" defaultOpen={true}>
              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <p className="text-sm text-gray-900 font-medium">Aceitar pedidos automaticamente</p>
                  <p className="text-xs text-gray-500">Novos pedidos entram direto em preparação</p>
                </div>
                <Switch
                  checked={settings.aceitarAutomatico}
                  onChange={() => saveSettings({ ...settings, aceitarAutomatico: !settings.aceitarAutomatico })}
                  ariaLabel="Ativar aceitação automática de pedidos"
                />
              </div>

              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                <label htmlFor="nome-computador" className="text-sm text-gray-900 font-medium">Nome deste computador</label>
                <p className="text-xs text-gray-500 mb-2">Aparece no celular, para saber qual Gestor está ligado</p>
                <input
                  id="nome-computador"
                  type="text"
                  maxLength={40}
                  value={nomeComputador}
                  placeholder={getNomeDoSistema() || 'Ex.: Caixa'}
                  onChange={(e) => setNomeComputador(e.target.value)}
                  onBlur={() => { salvarNomeComputador(nomeComputador); fetchPedidosRef.current() }}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <p className="text-sm text-gray-900 font-medium">Aviso do sistema</p>
                  <p className="text-xs text-gray-500">Mostra notificação quando chegar pedido</p>
                </div>
                <Switch checked={settings.notificacoesPush} onChange={handleToggleNotification} ariaLabel="Ativar notificações push" />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div>
                  <p className="text-sm text-gray-900 font-medium">Som ao receber pedido</p>
                  <p className="text-xs text-gray-500">Toca alerta sonoro para novos pedidos</p>
                </div>
                <Switch
                  checked={settings.somNotificacao}
                  onChange={() => saveSettings({ ...settings, somNotificacao: !settings.somNotificacao })}
                  ariaLabel="Ativar som ao receber pedido"
                />
              </div>
            </AccordionSection>

            {/* ── Impressão ─────────────────────────────────────────────── */}
            <AccordionSection id="acc-impressao" icon="print" title="Impressão">

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
                    disabled={printingOrderIds.has(PEDIDO_TESTE_IMPRESSAO._id)}
                    type="button"
                    className="w-full py-2.5 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all font-medium flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60"
                  >
                    <i
                      className={`fas ${printingOrderIds.has(PEDIDO_TESTE_IMPRESSAO._id) ? 'fa-spinner fa-spin' : 'fa-print'} text-gray-400`}
                      aria-hidden="true"
                    ></i>
                    {printingOrderIds.has(PEDIDO_TESTE_IMPRESSAO._id)
                      ? 'Imprimindo...'
                      : 'Imprimir cupom de teste'}
                  </button>
                  <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-200">
                    <div>
                      <p className="text-sm text-gray-900 font-medium">Etiquetas de Sacola</p>
                      <p className="text-xs text-gray-500">Exibe botão para imprimir etiquetas por sacola</p>
                    </div>
                    <Switch
                      checked={settings.usarEtiquetasSacola}
                      onChange={() => saveSettings({ ...settings, usarEtiquetasSacola: !settings.usarEtiquetasSacola })}
                      ariaLabel="Ativar etiquetas de sacola"
                    />
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* ── Sistema ───────────────────────────────────────────────── */}
            <AccordionSection id="acc-sistema" icon="sliders-h" title="Sistema">
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Sincronização de pedidos</p>
                    <p className="text-xs text-gray-500 mt-1">Pedidos atualizados automaticamente a cada 10 segundos</p>
                  </div>
                  <span className="text-sm font-bold text-[#7f22fe] bg-purple-50 px-3 py-1 rounded-full border border-purple-200">
                    {ORDER_REFRESH_SECONDS}s
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Atualização do gestor</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {updateState.status === 'ready'
                        ? 'Nova versão baixada e pronta para instalar'
                        : updateState.status === 'downloading'
                        ? `Baixando atualização (${updateState.progress}%)`
                        : `Versão atual v${packageInfo.version}`}
                    </p>
                  </div>
                  {updateState.status === 'ready' ? (
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      className="shrink-0 rounded-lg bg-[#7f22fe] px-3 py-2 text-xs font-bold text-white hover:bg-[#6b1de0]"
                    >
                      Atualizar
                    </button>
                  ) : (
                    <span className={`shrink-0 text-xs font-bold px-3 py-1 rounded-full border ${
                      updateState.status === 'downloading'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {updateState.status === 'downloading' ? 'Baixando' : 'Em dia'}
                    </span>
                  )}
                </div>
              </div>
            </AccordionSection>

            {/* ── Otimização de Entregas ────────────────────────────────── */}
            <AccordionSection id="acc-entregas" icon="route" title="Otimização de Entregas">

              {/* ✅ App do Entregador */}
              <div className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                settings.appEntregador
                  ? 'bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-300'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fas fa-motorcycle text-purple-600 text-sm"></i>
                    <span className="text-sm text-gray-900 font-bold">App do Entregador</span>
                  </div>
                  <p className="text-xs text-gray-600">Imprime na comanda o código que o motoboy digita no app para sair com o pedido</p>
                </div>
                <Switch
                  checked={settings.appEntregador}
                  onChange={() => {
                    const novoEstado = !settings.appEntregador
                    // ✅ Ao ativar, verifica se tem slug
                    if (novoEstado) {
                      const slug = localStorage.getItem('restauranteSlug')
                      if (!slug) {
                        setShowSlugModal(true)
                        return
                      }
                    }
                    saveSettings({ ...settings, appEntregador: novoEstado })
                  }}
                  ariaLabel="Ativar App do Entregador"
                />
              </div>

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

            {/* ── Sobre ─────────────────────────────────────────────────── */}
            <AccordionSection id="acc-sobre" icon="info-circle" title="Sobre">
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-center mb-4">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-md">
                    <i className="fas fa-bolt text-2xl text-white" aria-hidden="true"></i>
                  </div>
                  <h4 className="font-bold text-gray-900 text-lg mb-1">
                    NEXFOOD
                  </h4>
                  <p className="text-sm text-gray-500">by Nadin Garcia</p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between p-2 rounded bg-white border border-gray-100">
                    <span className="text-gray-600">Licença:</span>
                    <span className="text-emerald-600 font-bold">NEX07</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-white border border-gray-100">
                    <span className="text-gray-600">Versão:</span>
                    <span className="text-gray-900 font-bold">v{packageInfo.version}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-white border border-gray-100">
                    <span className="text-gray-600">CNPJ NexFood:</span>
                    <span className="text-gray-900 font-medium">63.805.056/0001-33</span>
                  </div>
                  <div className="flex justify-between p-2 rounded bg-white border border-gray-100">
                    <span className="text-gray-600">Pedidos Hoje:</span>
                    <span className="text-gray-900 font-bold">{pedidos.length}</span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* ── Conta ─────────────────────────────────────────────────── */}
            <AccordionSection id="acc-conta" icon="user-circle" title="Conta">
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-11 h-11 rounded-lg bg-[#7f22fe]/10 text-[#7f22fe] flex items-center justify-center shrink-0">
                    <i className="fas fa-store" aria-hidden="true"></i>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                      Restaurante logado
                    </p>
                    <p className="font-bold text-gray-900 truncate">
                      {accountInfo.restaurante}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {accountInfo.cnpj && (
                    <div className="flex justify-between gap-3 p-2 rounded bg-white border border-gray-100">
                      <span className="text-gray-600">CNPJ:</span>
                      <span className="text-gray-900 font-medium">{accountInfo.cnpj}</span>
                    </div>
                  )}
                  {accountInfo.slug && (
                    <div className="flex justify-between gap-3 p-2 rounded bg-white border border-gray-100">
                      <span className="text-gray-600">Slug:</span>
                      <span className="text-gray-900 font-medium truncate">{accountInfo.slug}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full py-3 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 hover:text-red-700 font-bold transition-all uppercase tracking-wider text-sm"
                type="button"
              >
                <i className="fas fa-sign-out-alt mr-2" aria-hidden="true"></i>
                Encerrar Sessão
              </button>
              <button
                onClick={() => setShowClearDataConfirm(true)}
                className="w-full py-3 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 hover:text-gray-800 font-bold transition-all uppercase tracking-wider text-sm"
                type="button"
              >
                <i className="fas fa-broom mr-2" aria-hidden="true"></i>
                Limpar Cache e Dados Locais
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
            onPrint={(pedidoAtual) => handlePrint(pedidoAtual || selectedOrder)}
            printStatus={getVisiblePrintStatus(selectedOrder._id)}
            onAdvance={advanceStatus}
            onPrintBagLabels={(pedido) => setBagLabelTarget(pedido)}
            showBagLabels={settings.usarEtiquetasSacola}
            isLoading={loadingOrderId === selectedOrder._id}
            pedidos={pedidosComClusters}
            onNavigate={setSelectedOrder}
            restaurantAddress={settings.enderecoRestaurante}
            avisosPorPedido={avisosPorPedido}
            onResolverAviso={resolverAviso}
            onComecarResposta={(avisoId) => setChamadoMudoId(avisoId)}
          />
        )}

        {avisoSaidaTarget && (
          <AvisoSaidaModal
            pedido={avisoSaidaTarget}
            avisos={avisosPorPedido.get(avisoSaidaTarget._id) || []}
            onVerPedido={() => {
              setSelectedOrder(avisoSaidaTarget)
              setAvisoSaidaTarget(null)
            }}
            onSair={() => {
              const pedido = avisoSaidaTarget
              setAvisoSaidaTarget(null)
              advanceStatus(pedido, { avisoConferido: true })
            }}
            onClose={() => setAvisoSaidaTarget(null)}
          />
        )}


        {showSlugModal && (
          <SlugInputModal
            onConfirm={(slug) => {
              localStorage.setItem('restauranteSlug', slug)
              setShowSlugModal(false)
              saveSettings({ ...settings, appEntregador: true })
              addToast('✅ Slug salvo! App do Entregador ativado.', 'success')
            }}
            onClose={() => setShowSlugModal(false)}
          />
        )}

        {chamado && chamadoRecolhido && (
          // Com o pedido do alarme aberto, o alarme vira uma barra para não cobrir o pedido
          <div
            className="fixed left-1/2 top-3 z-[100] flex w-[min(720px,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-xl bg-violet-900 px-4 py-3 text-white shadow-2xl"
            role="alertdialog"
            aria-labelledby="chamado-barra-titulo"
          >
            <i className="fas fa-bell fa-shake text-xl" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p id="chamado-barra-titulo" className="font-bold">Cliente precisa de atendimento</p>
              {chamado.recado && <p className="truncate text-sm text-violet-100">{chamado.recado}</p>}
            </div>
            <button
              type="button"
              onClick={() => responderChamado('visto')}
              className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-bold text-violet-900 hover:bg-violet-100 focus:outline-none focus:ring-4 focus:ring-violet-300"
            >
              {chamadoComAviso ? 'Vi, calar o alarme' : 'Vi, vou responder'}
            </button>
            <button
              type="button"
              onClick={() => responderChamado('ocupado')}
              className="shrink-0 rounded-lg border border-violet-300 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800 focus:outline-none focus:ring-4 focus:ring-violet-300"
            >
              Agora não posso
            </button>
          </div>
        )}

        {chamado && !chamadoRecolhido && (
          <div
            key={chamado.id}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-violet-900/80 p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="chamado-titulo"
          >
            <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-8 text-center shadow-2xl">
              <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                <i className="fas fa-bell fa-shake text-3xl" aria-hidden="true" />
              </span>
              <h2 id="chamado-titulo" className="text-2xl font-bold text-gray-900">
                {chamado.doNexBot ? 'Cliente precisa de atendimento' : 'O dono está chamando'}
              </h2>
              {chamado.recado && (
                <p className="mt-3 rounded-xl bg-violet-50 px-4 py-3 text-xl font-bold text-violet-900">{chamado.recado}</p>
              )}
              {(chamado.numero || !chamado.doNexBot) && (
                <p className="mt-2 text-base text-gray-600">
                  {chamado.numero
                    ? `Pedido #${chamado.numero}.`
                    : chamado.recado ? 'Responda para o dono saber que você viu.' : 'Confira os pedidos, por favor.'}
                </p>
              )}
              {chamadoComAviso && (
                <div className="mt-4">
                  <RespostaChamado
                    recado={chamado.recado}
                    numero={chamado.numero}
                    onEnviar={(mensagem) => resolverAviso(chamado.id, mensagem)}
                    onComecar={() => setChamadoMudoId(chamado.id)}
                  />
                </div>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => responderChamado('visto')}
                className={`w-full rounded-xl bg-violet-600 px-6 font-bold text-white hover:bg-violet-700 focus:outline-none focus:ring-4 focus:ring-violet-300 ${
                  chamadoComAviso ? 'mt-3 py-3 text-base' : 'mt-6 py-4 text-lg'
                }`}
              >
                {chamadoComAviso ? 'Vi, vou resolver depois' : chamado.doNexBot ? 'Vi, vou responder' : 'Vi, já estou vendo'}
              </button>
              {chamado.doNexBot && pedidoDoChamado && (
                <button
                  type="button"
                  onClick={() => {
                    setChamadoVendoPedidoId(chamado.id)
                    setSelectedOrder(pedidoDoChamado)
                  }}
                  className="mt-2 w-full rounded-xl border border-violet-300 bg-violet-50 px-6 py-3 text-base font-bold text-violet-800 hover:bg-violet-100 focus:outline-none focus:ring-4 focus:ring-violet-200"
                >
                  Ver pedido
                </button>
              )}
              <button
                type="button"
                onClick={() => responderChamado('ocupado')}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-gray-200"
              >
                Agora não posso
              </button>
              <p className="mt-3 text-xs text-gray-400">
                {chamadoComAviso
                  ? 'O aviso fica no cartão do pedido até alguém responder ou marcar como resolvido.'
                  : chamado.doNexBot ? 'Responda o cliente no WhatsApp da loja' : 'O dono recebe a confirmação no celular.'}
              </p>
            </div>
          </div>
        )}

        {showLogoutConfirm && (
          <LogoutConfirmModal
            onConfirm={handleConfirmLogout}
            onClose={() => setShowLogoutConfirm(false)}
          />
        )}

        {showClearDataConfirm && (
          <ClearLocalDataModal
            onConfirm={handleClearLocalData}
            onClose={() => setShowClearDataConfirm(false)}
          />
        )}

        {/* Sistema de toasts */}
         <ToastContainer toasts={toasts} onDismiss={removeToast} />

        {/* Modal de quantidade de sacolas */}
        {bagLabelTarget && (
          <BagCountModal
            pedido={bagLabelTarget}
            onConfirm={(count) => handlePrintBagLabels(bagLabelTarget, count)}
            onClose={() => setBagLabelTarget(null)}
          />
        )}

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
  isAlerting = false,
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
      className={`flex flex-col h-full rounded-xl bg-gray-100/50 border overflow-hidden shadow-sm transition-all ${
        isAlerting ? 'border-rose-400 animate-pulse-glow' : 'border-gray-200'
      } ${isCollapsed ? 'max-w-[80px]' : ''}`}
      role="region"
      aria-label={`Coluna ${title}: ${count} pedidos${isAlerting ? '. Aguardando aceite' : ''}`}
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
  printStatus,
  isDone,
  color,
  isLoading,
  searchQuery,
  visibleClusters,
  toggleClusterPin,
  avisos,
  codigoEntregador = false,
}) {
  const colorThemes = {
    purple: 'border-l-4 border-l-[#7f22fe]',
    orange: 'border-l-4 border-l-orange-500',
    blue: 'border-l-4 border-l-blue-500',
    emerald: 'border-l-4 border-l-emerald-500 opacity-60 grayscale-[0.5]',
  }

  const prazo = usePrazoDoPedido(pedido)
  const discountInfo = getDiscountInfo(pedido)
  const orderAction = getOrderAction(pedido)
  const printInfo = getPrintStatusInfo(printStatus)
  const paymentInfo = getPaymentInfo(pedido)
  const hasObservation = hasOrderObservation(pedido)

  // Monta o tooltip do countdown com contexto claro para o operador
  const prazoDe = isDelivery(pedido) ? `prazo de entrega de ${prazo.prazo} min` : `prazo de retirada de ${prazo.prazo} min`
  const countdownTooltip = prazo.atrasado
    ? `Pedido atrasado! Feito há ${prazo.passados} min, ${prazo.atraso > 0 ? `${prazo.atraso} min além do` : 'no limite do'} ${prazoDe}`
    : `Faltam ${prazo.restam} min do ${prazoDe} (feito há ${prazo.passados} min)`

  // Highlight do termo buscado no texto do card
  const highlightText = (text) => {
    if (!searchQuery || !text) return text
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = String(text).split(new RegExp(`(${escapedQuery})`, 'gi'))
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
      } ${prazo.atrasado && !isDone ? 'ring-1 ring-red-400/60' : ''}`}
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
            className={`text-[10px] font-black px-1.5 py-0.5 rounded shrink-0 cursor-help whitespace-nowrap ${
              prazo.atrasado
                ? 'bg-red-100 text-red-600'
                : prazo.atencao
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-gray-100 text-gray-500'
            }`}
            title={countdownTooltip}
            aria-label={countdownTooltip}
          >
            {prazo.atrasado ? (prazo.atraso > 0 ? `ATRASADO ${prazo.atraso} min` : 'ATRASADO') : `${prazo.restam} min`}
          </span>
        )}

        <span className="ml-auto text-sm font-black text-gray-900 whitespace-nowrap">
          {formatCurrency(pedido.total)}
        </span>
      </div>

      {/* Aviso do NexBot aberto: fica no cartão até alguém responder ou resolver */}
      {!isDone && avisos?.map((aviso) => (
        <p
          key={aviso.id}
          className="flex items-center gap-1.5 rounded-md bg-violet-700 px-2 py-1 text-[11px] font-bold text-white"
          title="Aviso do cliente pelo WhatsApp. Abra o pedido para responder ou resolver."
        >
          <i className="fas fa-bell text-[10px]" aria-hidden="true"></i>
          <span className="truncate">{aviso.recado || 'Cliente precisa de atendimento'}</span>
        </p>
      ))}

      {/* Linha 2: Nome do cliente */}
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-bold text-gray-900 truncate flex-1">
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

      {/* Indicadores operacionais compactos */}
      <div className="flex items-center gap-1 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${
            isDelivery(pedido)
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-orange-50 text-orange-700 border-orange-200'
          }`}
        >
          <i
            className={`fas ${
              isDelivery(pedido) ? 'fa-motorcycle' : 'fa-store'
            } text-[9px]`}
            aria-hidden="true"
          ></i>
          {getTipoPedidoLabel(pedido.tipo)}
        </span>

        <span
          className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-black ${paymentInfo.className}`}
          title={paymentInfo.label}
        >
          <i className={`fas ${paymentInfo.icon} text-[9px]`} aria-hidden="true"></i>
          <span className="truncate">{paymentInfo.shortLabel || paymentInfo.label}</span>
        </span>

        {hasObservation && (
          <span
            className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900"
            title="Este pedido possui observação em um ou mais itens"
          >
            <i className="fas fa-comment-dots text-[9px]" aria-hidden="true"></i>
            OBSERVAÇÃO
          </span>
        )}

        {discountInfo && (
          <span
            className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
              discountInfo.isCampaign
                ? 'bg-violet-50 border-violet-200 text-violet-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
            title={discountInfo.label}
          >
            <i className="fas fa-tag text-[9px]" aria-hidden="true"></i>
            <span className="truncate font-bold">{discountInfo.shortLabel}</span>
            <span className="shrink-0 font-black">-{formatCurrency(pedido.desconto)}</span>
          </span>
        )}

        {!isDone && ['printing', 'failed'].includes(printStatus?.status) && (printStatus.status === 'failed' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onPrint()
            }}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-black hover:brightness-95 ${printInfo.className}`}
            title={`${printInfo.label} Clique para tentar novamente.`}
          >
            <i className="fas fa-rotate text-[9px]" aria-hidden="true"></i>
            {printInfo.shortLabel}
          </button>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold ${printInfo.className}`}
            title={printInfo.label}
          >
            <i className={`fas ${printInfo.icon} text-[9px]`} aria-hidden="true"></i>
            {printInfo.shortLabel}
          </span>
        ))}
      </div>

      {/* Linha 4: Endereço (só Delivery) */}
      {isDelivery(pedido) && pedido.enderecoEntrega && (
        <div className="flex items-start gap-1">
          <i
            className="fas fa-map-marker-alt text-[9px] text-gray-400 mt-0.5 shrink-0"
            aria-hidden="true"
          ></i>
          <span className="text-[10px] text-gray-500 leading-tight line-clamp-1">
            {pedido.enderecoEntrega.rua}, {pedido.enderecoEntrega.numero}
            {pedido.enderecoEntrega.complemento
              ? ` · ${pedido.enderecoEntrega.complemento}`
              : ''}
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
            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] transition-all ${
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

      {/* Código que o motoboy digita no app (também sai na comanda) */}
      {codigoEntregador && isDelivery(pedido) && pedido.status === 'Em preparação' && !pedido.entregadorNome && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-gray-50 border border-gray-200" title="O motoboy digita este código no app do entregador">
          <i className="fas fa-motorcycle text-gray-500 text-[9px]" aria-hidden="true"></i>
          <span className="text-[10px] font-bold text-gray-600">Código do entregador</span>
          <span className="ml-auto text-[12px] font-black tracking-widest text-gray-900">{codigoEntrega(pedido._id)}</span>
        </div>
      )}

      {/* Badge motoboy atribuído */}
      {pedido.motoboyAtribuido && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-50 border border-purple-200">
          <i className="fas fa-user-check text-purple-600 text-[9px]"></i>
          <span className="text-[10px] font-bold text-purple-700 truncate">
            {pedido.entregadorNome
              ? `Com ${pedido.entregadorNome.split(' ')[0]}${pedido.status === 'Saiu para entrega' ? ' · ele confirma a entrega' : ''}`
              : 'Motoboy atribuído'}
          </span>
          <a
            href={`https://nexfood.app/tracking/${pedido._id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[9px] text-purple-500 ml-auto underline"
            title="Ver rastreamento"
          >
            Rastrear
          </a>
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

      {/* Ações (não exibidas em pedidos finalizados) — alvos de toque ≥40px */}
      {!isDone && (
        <div className="flex gap-2 pt-2 border-t border-gray-100 mt-auto">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPrint()
            }}
            disabled={printStatus?.status === 'printing'}
            className={`rounded-lg p-3 text-base transition-colors focus:outline-none focus:ring-2 ${
              printStatus?.status === 'printing'
                ? 'cursor-wait bg-violet-100 text-violet-700'
                : printStatus?.status === 'failed'
                ? 'bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-400/40'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:ring-gray-400/40'
            }`}
            title={
              printStatus?.status === 'printing'
                ? 'Imprimindo pedido'
                : printStatus?.status === 'failed'
                ? 'Tentar imprimir novamente'
                : 'Imprimir cupom'
            }
            aria-label={
              printStatus?.status === 'printing'
                ? 'Imprimindo pedido'
                : printStatus?.status === 'failed'
                ? 'Tentar imprimir o pedido novamente'
                : 'Imprimir cupom do pedido'
            }
            type="button"
          >
            <i
              className={`fas ${
                printStatus?.status === 'printing'
                  ? 'fa-spinner fa-spin'
                  : printStatus?.status === 'failed'
                  ? 'fa-rotate'
                  : 'fa-print'
              }`}
              aria-hidden="true"
            ></i>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAdvance()
            }}
            disabled={isLoading}
            className={`flex-1 py-3 rounded-lg text-sm font-black text-white transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-gray-900/40 ${
              isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gray-900 hover:bg-black'
            }`}
            aria-label={
              isLoading
                ? orderAction?.loadingLabel || 'Atualizando status...'
                : orderAction?.label || 'Atualizar pedido'
            }
            type="button"
          >
            {isLoading ? (
              <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
            ) : (
              <>
                {orderAction?.shortLabel || 'ATUALIZAR'}{' '}
                <i
                  className={`fas ${orderAction?.icon || 'fa-arrow-right'} text-xs ml-1`}
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
  printStatus,
  onAdvance,
  onPrintBagLabels,
  showBagLabels,
  isLoading,
  pedidos,
  onNavigate,
  restaurantAddress,
  avisosPorPedido,
  onResolverAviso,
  onComecarResposta,
}) {
  const [currentPedido, setCurrentPedido] = useState(pedido)
  const avisosDoPedido = ['Entregue', 'Cancelado'].includes(currentPedido.status)
    ? []
    : avisosPorPedido?.get(currentPedido._id) || []
  const discountInfo = getDiscountInfo(currentPedido)
  const orderAction = getOrderAction(currentPedido)
  const printInfo = getPrintStatusInfo(printStatus)
  // Entregue nunca mostra "Imprimindo"; o botão segue travado até a impressão em andamento terminar
  const mostrarImprimindo = printStatus?.status === 'printing' && currentPedido.status !== 'Entregue'
  const modalPaymentInfo = getPaymentInfo(currentPedido)
  const itemCount = (currentPedido.itens || []).reduce(
    (total, item) => total + Number(item.quantidade || 0),
    0
  )

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

  const handleAdvance = async () => {
    if (isLoading) return
    const result = await onAdvance(currentPedido)
    if (result?.success || result?.deferred) onClose()
  }

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
        className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 bg-white px-5 py-4 lg:px-6">
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

          {/* Avisos do NexBot abertos neste pedido */}
          {avisosDoPedido.map((aviso) => (
            <div key={aviso.id} className="mt-3 rounded-xl border border-violet-300 bg-violet-50 p-3">
              <div className="mb-3 flex items-center gap-3">
                <i className="fas fa-bell text-violet-700" aria-hidden="true"></i>
                <p className="min-w-0 flex-1 text-sm font-bold text-violet-900">
                  Pelo WhatsApp: {aviso.recado || 'cliente precisa de atendimento'}
                </p>
                <button
                  type="button"
                  onClick={() => onResolverAviso(aviso.id)}
                  className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-bold text-violet-800 hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  title="Fecha o aviso sem mandar mensagem ao cliente"
                >
                  <i className="fas fa-check mr-1.5" aria-hidden="true"></i>
                  Resolvido
                </button>
              </div>
              <RespostaChamado
                recado={aviso.recado}
                numero={getOrderNumber(currentPedido)}
                onEnviar={(mensagem) => onResolverAviso(aviso.id, mensagem)}
                onComecar={() => onComecarResposta?.(aviso.id)}
              />
            </div>
          ))}

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

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
          <aside className="order-2 flex flex-none flex-col border-t border-gray-200 bg-slate-50 lg:order-1 lg:min-h-0 lg:border-r lg:border-t-0">
            <div className="flex-1 space-y-3 p-4 custom-scrollbar lg:overflow-y-auto">
              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-[#7f22fe]">
                    <i className="fas fa-user" aria-hidden="true"></i>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-gray-900">
                      {currentPedido.cliente?.nome || 'Consumidor'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatTelefone(currentPedido.cliente?.telefone) || 'Telefone não informado'}
                    </p>
                  </div>
                </div>
                {currentPedido.cliente?.telefone && (
                  <button
                    onClick={handleWhatsApp}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                    type="button"
                  >
                    <i className="fab fa-whatsapp text-base" aria-hidden="true"></i>
                    Conversar no WhatsApp
                  </button>
                )}
              </section>

              <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-900">
                  <i className={`fas ${currentPedido.enderecoEntrega ? 'fa-location-dot' : 'fa-store'}`} aria-hidden="true"></i>
                  {currentPedido.enderecoEntrega ? 'Entrega' : 'Retirada'}
                </h3>
                {currentPedido.enderecoEntrega ? (
                  <>
                    <p className="text-sm font-bold leading-snug text-gray-900">
                      {currentPedido.enderecoEntrega.rua}, {currentPedido.enderecoEntrega.numero}
                    </p>
                    {currentPedido.enderecoEntrega.complemento && (
                      <p className="mt-0.5 text-sm font-bold text-blue-900">
                        {currentPedido.enderecoEntrega.complemento}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-600">
                      {currentPedido.enderecoEntrega.bairro}
                      {currentPedido.enderecoEntrega.cidade
                        ? ` · ${currentPedido.enderecoEntrega.cidade}`
                        : ''}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={openGoogleMaps}
                        className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        type="button"
                      >
                        <i className="fas fa-map mr-1.5" aria-hidden="true"></i>
                        Mapa
                      </button>
                      {currentPedido.clusterId && clusterOrders.length > 1 && (
                        <button
                          onClick={createClusterRoute}
                          className="flex-1 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                          type="button"
                        >
                          <i className="fas fa-route mr-1.5" aria-hidden="true"></i>
                          Rota
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-bold text-gray-800">Retirada no balcão</p>
                )}

                {currentPedido.clusterId && currentPedido.clusterDistances?.length > 0 && (
                  <div className="mt-3 border-t border-blue-200 pt-3">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-blue-800">
                      Pedidos da rota
                    </p>
                    <div className="space-y-1.5">
                      {currentPedido.clusterDistances.map((nearby) => (
                        <button
                          key={nearby.orderId}
                          onClick={() => navigateToOrder(nearby.orderId)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 text-left text-blue-900 hover:bg-blue-100"
                          type="button"
                          aria-label={`Ver pedido #${nearby.orderNumber} a ${nearby.distance.toFixed(1)} km`}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-black">#{nearby.orderNumber}</span>
                            <span className="block truncate text-[10px] font-medium text-blue-700">
                              {nearby.address}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-bold">
                            {nearby.distance.toFixed(1)} km
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-emerald-800">
                    <i className="fas fa-wallet" aria-hidden="true"></i>
                    Pagamento
                  </h3>
                  <span
                    className={`rounded-full border px-2 py-1 text-[9px] font-black ${modalPaymentInfo.className}`}
                    title={modalPaymentInfo.label}
                  >
                    {modalPaymentInfo.shortLabel || modalPaymentInfo.label}
                  </span>
                </div>
                <div className="space-y-2 text-xs text-gray-600">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <strong className="text-gray-800">{formatCurrency(currentPedido.subtotal)}</strong>
                  </div>
                  {currentPedido.taxaEntrega > 0 && (
                    <div className="flex justify-between">
                      <span>Taxa de entrega</span>
                      <strong className="text-gray-800">{formatCurrency(currentPedido.taxaEntrega)}</strong>
                    </div>
                  )}
                  {currentPedido.desconto > 0 && (
                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-800">
                      <div className="flex justify-between font-bold">
                        <span>Desconto</span>
                        <span>-{formatCurrency(currentPedido.desconto)}</span>
                      </div>
                      {discountInfo && <p className="mt-1 text-[10px]">{discountInfo.label}</p>}
                    </div>
                  )}
                  <div className="flex items-end justify-between border-t border-gray-200 pt-3">
                    <span className="font-bold text-gray-900">Total</span>
                    <strong className="text-2xl leading-none text-[#7f22fe]">
                      {formatCurrency(currentPedido.total)}
                    </strong>
                  </div>
                  {Number(currentPedido.trocoPara) > 0 && (
                    <div className="rounded-lg bg-blue-50 px-2.5 py-2 text-center text-blue-800">
                      <p className="text-xs">Paga com {formatCurrency(currentPedido.trocoPara)}</p>
                      {getTrocoInfo(currentPedido).troco > 0 && (
                        <p className="font-black">Levar {formatCurrency(getTrocoInfo(currentPedido).troco)} de troco</p>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="shrink-0 border-t border-gray-200 bg-white p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.06)]">
              {currentPedido.status !== 'Entregue' && (
                <div className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-bold ${printInfo.className}`}>
                  <i className={`fas ${printInfo.icon}`} aria-hidden="true"></i>
                  <span>{printInfo.label}</span>
                  {printStatus?.lastPrintedAt && (
                    <span className="ml-auto font-medium opacity-70">
                      {formatTime(printStatus.lastPrintedAt)}
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => onPrint(currentPedido)}
                  disabled={isLoading || printStatus?.status === 'printing'}
                  className="flex-1 rounded-xl border border-gray-300 bg-white py-3 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                  type="button"
                >
                  <i
                    className={`fas ${
                      mostrarImprimindo
                        ? 'fa-spinner fa-spin'
                        : printStatus?.status === 'failed'
                        ? 'fa-rotate'
                        : 'fa-print'
                    } mr-1.5`}
                    aria-hidden="true"
                  ></i>
                  {mostrarImprimindo
                    ? 'Imprimindo...'
                    : printStatus?.status === 'failed'
                    ? 'Tentar'
                    : 'Imprimir'}
                </button>
                {showBagLabels && (
                  <button
                    onClick={() => onPrintBagLabels(currentPedido)}
                    disabled={isLoading}
                    className="flex-1 rounded-xl border border-violet-200 bg-violet-50 py-3 text-xs font-bold text-[#7f22fe] hover:bg-violet-100 disabled:opacity-50"
                    type="button"
                  >
                    <i className="fas fa-shopping-bag mr-1.5" aria-hidden="true"></i>
                    Sacolas
                  </button>
                )}
              </div>
              {currentPedido.status !== 'Entregue' && (
                <button
                  onClick={handleAdvance}
                  disabled={isLoading}
                  className={`mt-2 w-full rounded-xl py-3.5 text-sm font-black text-white transition-colors ${
                    isLoading ? 'cursor-not-allowed bg-gray-400' : 'bg-[#7f22fe] hover:bg-[#6b1de0]'
                  }`}
                  type="button"
                  aria-label={isLoading ? orderAction?.loadingLabel : orderAction?.label}
                >
                  {isLoading ? (
                    <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                  ) : (
                    <>
                      <i className={`fas ${orderAction?.icon || 'fa-arrow-right'} mr-2`} aria-hidden="true"></i>
                      {orderAction?.label || 'Atualizar pedido'}
                    </>
                  )}
                </button>
              )}
            </div>
          </aside>

          <section className="order-1 flex min-h-[45vh] flex-none flex-col bg-gray-50/70 lg:order-2 lg:min-h-0">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
              <div>
                <h3 className="font-black text-gray-900">Itens do pedido</h3>
                <p className="text-xs text-gray-500">
                  {itemCount} {itemCount === 1 ? 'item' : 'itens'} em {(currentPedido.itens || []).length} {(currentPedido.itens || []).length === 1 ? 'produto' : 'produtos'}
                </p>
              </div>
              {hasOrderObservation(currentPedido) && (
                <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[10px] font-black text-amber-900">
                  <i className="fas fa-comment-dots mr-1.5" aria-hidden="true"></i>
                  TEM OBSERVAÇÃO
                </span>
              )}
            </div>
            <div className="flex-1 space-y-3 p-4 custom-scrollbar lg:overflow-y-auto lg:p-5" role="list" aria-label="Itens do pedido">
              {(currentPedido.itens || []).map((item, idx) => (
                <article
                  key={idx}
                  className={`rounded-2xl border bg-white p-4 shadow-sm ${
                    item.obs ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'
                  }`}
                  role="listitem"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#7f22fe] text-sm font-black text-white shadow-sm">
                      {item.quantidade}x
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <p className="font-bold leading-snug text-gray-900">{item.nome}</p>
                        <p className="shrink-0 font-black text-gray-900">
                          {formatCurrency(item.precoUnitario * item.quantidade)}
                        </p>
                      </div>
                      {item.complementos?.length > 0 && (
                        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                          {item.quantidade > 1 && (
                            <span className="mr-1 text-[10px] font-black uppercase tracking-wide text-gray-400">
                              Cada unidade:
                            </span>
                          )}
                          {item.complementos.map(linhaComplemento).join(', ')}
                        </div>
                      )}
                      {item.obs && (
                        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">
                          <i className="fas fa-comment-dots mt-0.5" aria-hidden="true"></i>
                          <span>{item.obs}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
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
// 2. Barra de progresso por animação de CSS (pausa com o mouse em cima) e um único setTimeout
//    para fechar: antes era um setInterval de 50 ms refazendo o aviso 20 vezes por segundo
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }) {
  const [actionLoading, setActionLoading] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  // Tempo restante em ms — sobrevive a pausas do hover
  const totalDuration = toast.duration || 6000
  const remainingRef = useRef(totalDuration)

  useEffect(() => {
    if (isPaused) return
    const inicio = Date.now()
    const id = setTimeout(() => onDismiss(toast.id), remainingRef.current)
    return () => {
      clearTimeout(id)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - inicio))
    }
  }, [isPaused, toast.id, onDismiss])

  const styles = {
    success: { bar: 'bg-emerald-500', box: 'bg-white border-emerald-300 text-emerald-900', icon: 'fa-check-circle text-emerald-500' },
    error:   { bar: 'bg-red-500',     box: 'bg-white border-red-300 text-red-900',         icon: 'fa-times-circle text-red-500' },
    warning: { bar: 'bg-yellow-400',  box: 'bg-white border-yellow-300 text-yellow-900',   icon: 'fa-exclamation-triangle text-yellow-500' },
    info:    { bar: 'bg-blue-500',    box: 'bg-white border-blue-300 text-blue-900',        icon: 'fa-info-circle text-blue-500' },
  }
  const s = styles[toast.type] || styles.info

  const handleAction = async () => {
    if (!toast.action?.onClick || actionLoading) return
    setActionLoading(true)
    try {
      const completed = await toast.action.onClick()
      if (completed !== false) onDismiss(toast.id)
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`relative overflow-hidden flex items-start gap-3 p-4 rounded-xl border shadow-xl text-sm font-medium ${s.box}`}
    >
      <i className={`fas ${s.icon} mt-0.5 shrink-0 text-base`} aria-hidden="true"></i>
      <span className="flex-1 leading-relaxed">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={handleAction}
          disabled={actionLoading}
          className="shrink-0 rounded-lg border border-current/30 px-3 py-1.5 text-xs font-black hover:bg-black/5 disabled:opacity-50"
        >
          {actionLoading ? (
            <i className="fas fa-spinner fa-spin" aria-label="Processando"></i>
          ) : (
            toast.action.label
          )}
        </button>
      )}
      {/* Barra do tempo restante: animação de CSS, parada enquanto o mouse está em cima */}
      <div
        className={`absolute bottom-0 left-0 h-1 w-full origin-left rounded-b-xl ${s.bar}`}
        style={{ animation: `toast-barra ${totalDuration}ms linear forwards`, animationPlayState: isPaused ? 'paused' : 'running' }}
        aria-hidden="true"
      />
    </div>
  )
}

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div
      className="fixed bottom-5 right-5 z-[200] flex flex-col gap-3 max-w-sm pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
      role="status"
    >
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}

function OperationalAlertsBar({ alerts }) {
  if (!alerts.length) return null

  const styles = {
    critical: 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100',
    warning: 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
    info: 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100',
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50/80 px-4 py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-gray-500 shrink-0">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          Operação
        </span>
        {alerts.map((alert) => {
          const content = (
            <>
              <i className={`${alert.icon.includes('fa-brands') ? alert.icon : `fas ${alert.icon}`} text-xs`} aria-hidden="true" />
              <span className="font-black whitespace-nowrap">{alert.label}</span>
              {alert.detail && (
                <span className="hidden md:inline max-w-[220px] truncate opacity-80">{alert.detail}</span>
              )}
            </>
          )

          const className = `inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors shrink-0 ${styles[alert.severity] || styles.info}`

          return alert.onClick ? (
            <button key={alert.id} type="button" onClick={alert.onClick} className={className}>
              {content}
            </button>
          ) : (
            <div key={alert.id} className={className}>
              {content}
            </div>
          )
        })}
      </div>
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

const BANNER_DESKTOP_KEY = 'nexfood_banner_desktop_ate'
const BANNER_DESKTOP_PAUSA_DIAS = 7

// Só oferece o .exe para quem está no Windows: no celular, Mac ou Linux o botão não serviria.
const ehWindows = () => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent || '')

function bannerDesktopPausado() {
  try {
    return Number(localStorage.getItem(BANNER_DESKTOP_KEY) || 0) > Date.now()
  } catch {
    return false
  }
}

function ElectronBanner() {
  // "Agora não" pausa por 7 dias (antes voltava a cada recarga da página)
  const [dismissed, setDismissed] = useState(bannerDesktopPausado)
  const [downloadUrl, setDownloadUrl] = useState('https://github.com/nadingarcia/gestor-pedidos/releases/latest')
  const visivel = !electronAPI.isElectron() && !dismissed && ehWindows()

  useEffect(() => {
    if (!visivel) return
    fetch('https://api.github.com/repos/nadingarcia/gestor-pedidos/releases/latest')
      .then(r => r.json())
      .then(data => {
        const exe = data.assets?.find(a => a.name.endsWith('.exe'))
        if (exe) setDownloadUrl(exe.browser_download_url)
      })
      .catch(() => {}) // fallback já está no estado inicial
  }, [visivel])

  const fechar = () => {
    try {
      localStorage.setItem(BANNER_DESKTOP_KEY, String(Date.now() + BANNER_DESKTOP_PAUSA_DIAS * 24 * 60 * 60 * 1000))
    } catch { /* sem storage: fecha só nesta sessão */ }
    setDismissed(true)
  }

  if (!visivel) return null

  // Cartão discreto no padrão dos outros cartões do gestor (borda cinza, sombra, roxo só no ícone e no
  // botão). Antes: borda roxa grossa, faixa roxa e ícones vermelhos de "indisponível" — parecia erro.
  return (
    <aside
      className="fixed bottom-5 left-5 z-[200] w-[min(360px,calc(100vw-2.5rem))] rounded-2xl border border-gray-200 bg-white p-4 shadow-xl"
      aria-labelledby="banner-desktop-titulo"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#7f22fe]/10 text-[#7f22fe]" aria-hidden="true">
          <i className="fas fa-desktop"></i>
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="banner-desktop-titulo" className="text-sm font-bold text-gray-900">
            Use o Gestor instalado no computador
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            No navegador, algumas funções ficam de fora.
          </p>
        </div>
        <button
          onClick={fechar}
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
          aria-label="Fechar aviso por 7 dias"
          type="button"
        >
          <i className="fas fa-times text-sm" aria-hidden="true"></i>
        </button>
      </div>

      <ul className="mt-3 space-y-1.5 text-[13px] text-gray-700">
        {[
          'Imprime sozinho na térmica',
          'Tela da cozinha em outra janela',
          'Avisos do Windows mesmo minimizado',
          'O PC não entra em descanso no expediente',
        ].map((label) => (
          <li key={label} className="flex items-center gap-2">
            <i className="fas fa-check w-4 text-center text-xs text-[#7f22fe]" aria-hidden="true"></i>
            <span>{label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2">
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#7f22fe] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#6b1de0] focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40"
        >
          <i className="fas fa-download" aria-hidden="true"></i>
          Baixar para Windows
        </a>
        <button
          type="button"
          onClick={fechar}
          className="rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
        >
          Agora não
        </button>
      </div>

      <p className="mt-2.5 text-[11px] leading-snug text-gray-400">
        Se o Windows mostrar um aviso, clique em <strong className="font-semibold text-gray-500">Mais informações</strong> e
        depois em <strong className="font-semibold text-gray-500">Executar mesmo assim</strong>.
      </p>
    </aside>
  )
}

function AccordionSection({ id, icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const sectionRef = useRef(null)
  const abriuPeloUsuario = useRef(false)

  // Ao abrir uma seção no fim da gaveta (Conta, Sobre, Sistema…), o conteúdo nascia abaixo da dobra
  // e era preciso rolar à mão. Rola só o necessário para a seção inteira aparecer ('nearest'); se ela
  // for maior que a gaveta, o cabeçalho fica no topo.
  useEffect(() => {
    if (!open || !abriuPeloUsuario.current) return
    const el = sectionRef.current
    if (!el) return
    const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', behavior: reduzir ? 'auto' : 'smooth' })
  }, [open])

  return (
    <div ref={sectionRef} className="rounded-xl border border-gray-200 overflow-hidden scroll-my-4">
      <button
        type="button"
        onClick={() => { abriuPeloUsuario.current = true; setOpen(!open) }}
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

// Pedido com aviso do cliente aberto prestes a sair: confirma, não bloqueia
function AvisoSaidaModal({ pedido, avisos, onVerPedido, onSair, onClose }) {
  const modalRef = useFocusTrap(true, onClose)
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={modalRef}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aviso-saida-titulo"
      >
        <h2 id="aviso-saida-titulo" className="flex items-center gap-2 text-lg font-bold text-gray-900">
          <i className="fas fa-bell text-violet-700" aria-hidden="true"></i>
          Pedido #{getOrderNumber(pedido)} tem aviso do cliente
        </h2>
        <ul className="mt-3 space-y-2">
          {avisos.map((aviso) => (
            <li key={aviso.id} className="rounded-lg bg-violet-50 px-3 py-2 text-sm font-bold text-violet-900">
              {aviso.recado || 'Cliente precisa de atendimento'}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-gray-600">Ninguém respondeu nem marcou como resolvido. Quer conferir antes de o pedido sair?</p>
        <button
          type="button"
          autoFocus
          onClick={onVerPedido}
          className="mt-5 w-full rounded-xl bg-violet-600 px-4 py-3 font-bold text-white hover:bg-violet-700 focus:outline-none focus:ring-4 focus:ring-violet-300"
        >
          Ver pedido
        </button>
        <button
          type="button"
          onClick={onSair}
          className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-gray-200"
        >
          Sair assim mesmo
        </button>
      </div>
    </div>
  )
}

function LogoutConfirmModal({ onConfirm, onClose }) {
  const trapRef = useFocusTrap(true, onClose)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <div
        ref={trapRef}
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <i className="fas fa-right-from-bracket" aria-hidden="true"></i>
              </div>
              <div>
                <h3 id="logout-modal-title" className="text-base font-bold text-gray-900">
                  Encerrar sessão?
                </h3>
                <p className="text-xs font-medium text-gray-500">
                  Você precisará fazer login novamente para voltar ao gestor.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
              aria-label="Cancelar encerramento de sessão"
              type="button"
            >
              <i className="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-gray-600">
            Os pedidos deixam de sincronizar nesta tela assim que a sessão for encerrada.
          </p>

          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
            Confirme apenas se realmente deseja sair da conta atual.
          </div>
        </div>

        <div className="flex gap-3 border-t border-gray-200 px-5 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
            type="button"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-[1.4] rounded-xl bg-red-600 py-3 text-sm font-black text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            type="button"
          >
            Encerrar sessão
          </button>
        </div>
      </div>
    </div>
  )
}

function ClearLocalDataModal({ onConfirm, onClose }) {
  const trapRef = useFocusTrap(true, onClose)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <div
        ref={trapRef}
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-data-modal-title"
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <i className="fas fa-broom" aria-hidden="true"></i>
              </div>
              <div>
                <h3 id="clear-data-modal-title" className="text-base font-bold text-gray-900">
                  Limpar cache e dados locais?
                </h3>
                <p className="text-xs font-medium text-gray-500">
                  Esta ação limpa as preferências salvas neste computador.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
              aria-label="Cancelar limpeza de dados locais"
              type="button"
            >
              <i className="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-gray-600">
            Isso apaga sessão, cache de pedidos, impressora escolhida, filtros e outras configurações locais. Depois será necessário fazer login novamente.
          </p>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
            Use quando o gestor estiver com dados antigos, configuração travada ou comportamento estranho.
          </div>
        </div>

        <div className="flex gap-3 border-t border-gray-200 px-5 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
            type="button"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-[1.4] rounded-xl bg-amber-600 py-3 text-sm font-black text-white transition-colors hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            type="button"
          >
            Limpar dados
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BagCountModal — seletor de quantidade de sacolas para impressão de etiquetas
// ─────────────────────────────────────────────────────────────────────────────

function BagCountModal({ pedido, onConfirm, onClose }) {
  const [count, setCount] = useState(2)
  const trapRef = useFocusTrap(true, onClose)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <div
        ref={trapRef}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bag-modal-title"
      >
        {/* Header */}
        <div className="bg-[#7f22fe] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
              <i className="fas fa-shopping-bag text-white" aria-hidden="true"></i>
            </div>
            <div>
              <h3 id="bag-modal-title" className="font-bold text-base leading-tight">
                Etiquetas de Sacola
              </h3>
              <p className="text-purple-200 text-xs">Pedido #{getOrderNumber(pedido)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors focus:outline-none"
            aria-label="Fechar"
            type="button"
          >
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <p className="text-sm text-gray-500 text-center leading-relaxed">
            Quantas sacolas neste pedido?<br />
            <span className="text-xs text-gray-400">Uma etiqueta impressa por sacola</span>
          </p>

          {/* Contador grande */}
          <div className="flex items-center justify-center gap-5">
            <button
              onClick={() => setCount((c) => Math.max(1, c - 1))}
              className="w-12 h-12 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-2xl transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
              aria-label="Diminuir"
              type="button"
            >−</button>

            <div className="flex flex-col items-center w-20">
              <span className="text-6xl font-black text-gray-900 leading-none tabular-nums">
                {count}
              </span>
              <span className="text-xs text-gray-400 mt-1">
                {count === 1 ? 'sacola' : 'sacolas'}
              </span>
            </div>

            <button
              onClick={() => setCount((c) => Math.min(10, c + 1))}
              className="w-12 h-12 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-2xl transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-gray-400/40"
              aria-label="Aumentar"
              type="button"
            >+</button>
          </div>

          {/* Atalhos rápidos */}
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                type="button"
                className={`py-2.5 rounded-xl text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40 ${
                  count === n
                    ? 'bg-[#7f22fe] text-white shadow-md scale-105'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
                aria-pressed={count === n}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Info contextual */}
          <div className={`p-3 rounded-xl text-xs flex items-start gap-2 transition-all ${
            count > 1
              ? 'bg-purple-50 border border-purple-100 text-purple-700'
              : 'bg-gray-50 border border-gray-200 text-gray-500'
          }`}>
            <i className="fas fa-tag mt-0.5 shrink-0" aria-hidden="true"></i>
            <span>
              {count === 1
                ? 'Será impressa 1 etiqueta com o número do pedido em destaque.'
                : `Serão impressas ${count} etiquetas — cada uma mostra o número do pedido e a identificação da sacola (ex: SACOLA 2 DE ${count}).`}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400/40"
            type="button"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(count)}
            className="flex-[2] py-3 rounded-xl bg-[#7f22fe] hover:bg-[#6b1de0] text-white font-bold transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40 flex items-center justify-center gap-2"
            type="button"
          >
            <i className="fas fa-print" aria-hidden="true"></i>
            Imprimir {count} {count === 1 ? 'Etiqueta' : 'Etiquetas'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SlugInputModal({ onConfirm, onClose }) {
  const [slug, setSlug] = useState('')
  const [erro, setErro] = useState('')
  const inputRef = useRef(null)

  // Foca o input uma única vez ao montar — sem trap agressivo
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [])

  // Fecha com Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleConfirm = () => {
    const valor = slug.trim().toLowerCase()
    if (!valor) { setErro('Informe o slug do restaurante.'); return }
    if (/[^a-z0-9-]/.test(valor)) { setErro('Slug inválido — use apenas letras, números e hífens.'); return }
    onConfirm(valor)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slug-modal-title"
      >
        {/* Header */}
        <div className="bg-[#7f22fe] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
              <i className="fas fa-motorcycle"></i>
            </div>
            <div>
              <h3 id="slug-modal-title" className="font-bold text-base leading-tight">
                Configurar App do Entregador
              </h3>
              <p className="text-purple-200 text-xs">Identificação do restaurante</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white" type="button" aria-label="Fechar">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
            <i className="fas fa-info-circle text-blue-500 mt-0.5 shrink-0"></i>
            <div className="text-sm text-blue-800 leading-relaxed">
              <p className="font-bold mb-1">Onde encontrar o slug?</p>
              <p>Acesse o <strong>Painel NexFood → seção Entregador</strong>. O código está exibido em destaque na tela.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="slug-input" className="text-sm font-bold text-gray-700 block">
              Código do restaurante (slug)
            </label>
            <input
              ref={inputRef}
              id="slug-input"
              type="text"
              value={slug}
              onChange={(e) => { setSlug(e.target.value.toLowerCase()); setErro('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              placeholder="ex: pizzaria-marcos"
              className={`w-full px-4 py-3 rounded-xl border-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/30 transition-all ${
                erro ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-[#7f22fe]'
              }`}
              spellCheck={false}
              autoComplete="off"
            />
            {erro && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <i className="fas fa-exclamation-circle"></i> {erro}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors text-sm"
            type="button"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!slug.trim()}
            className="flex-[2] py-3 rounded-xl bg-[#7f22fe] hover:bg-[#6b1de0] disabled:bg-gray-300 text-white font-bold transition-all text-sm focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/40"
            type="button"
          >
            <i className="fas fa-check mr-2"></i>Salvar e Ativar
          </button>
        </div>
      </div>
    </div>
  )
}
