// Status da loja para o cliente (aberta / fechada / pausada) — a mesma regra do painel
// (resolverStatusFinal em nexfood/public/js/modules/minha-loja.js) e do app do cliente
// (nexfood-pro/src/utils/storeSchedule.js): o modo manual do painel vence o horário.

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

const periodos = (horario) => {
  if (horario?.periodos?.length > 0) return horario.periodos
  if (horario?.inicio && horario?.fim) return [{ inicio: horario.inicio, fim: horario.fim }]
  return []
}

const minutos = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null
}

export function abertaPeloHorario(horarios, agora = new Date()) {
  if (!Array.isArray(horarios) || horarios.length === 0) return false
  const atual = agora.getHours() * 60 + agora.getMinutes()

  const dentro = (horario, doDiaAnterior = false) => periodos(horario).some(({ inicio, fim }) => {
    const ini = minutos(inicio)
    const fimMin = minutos(fim)
    if (ini === null || fimMin === null) return false
    const viraMeiaNoite = fimMin <= ini
    if (doDiaAnterior) return viraMeiaNoite && atual < fimMin
    if (viraMeiaNoite) return atual >= ini
    return atual >= ini && atual < fimMin
  })

  return dentro(horarios.find(h => h.dia === DIAS[agora.getDay()]))
    || dentro(horarios.find(h => h.dia === DIAS[(agora.getDay() + 6) % 7]), true)
}

/**
 * @returns {{ estado: 'aberta'|'fechada'|'pausada', manual: boolean, pausaAte: Date|null }}
 */
export function resolverStatusLoja(horarios, statusLoja, agora = new Date()) {
  const modo = statusLoja?.modo || 'auto'
  const pausaAte = statusLoja?.pausaAte ? new Date(statusLoja.pausaAte) : null

  if (modo === 'pausado' && (!pausaAte || pausaAte > agora)) return { estado: 'pausada', manual: true, pausaAte }
  if (modo === 'aberto') return { estado: 'aberta', manual: true, pausaAte: null }
  if (modo === 'fechado') return { estado: 'fechada', manual: true, pausaAte: null }

  // auto (ou pausa que já venceu)
  return { estado: abertaPeloHorario(horarios, agora) ? 'aberta' : 'fechada', manual: false, pausaAte: null }
}

/**
 * Quando o status pode mudar a partir de `agora`: um horário de abrir ou fechar ou o fim da pausa.
 * O quadro agenda uma vez até lá, em vez de recalcular a cada 30 s. Horário de outro dia da semana só
 * causa uma conferência a mais; no máximo espera até a meia-noite.
 */
export function proximaTrocaStatusLoja(horarios, statusLoja, agora = new Date()) {
  const meiaNoite = new Date(agora)
  meiaNoite.setHours(24, 0, 0, 0)
  let proxima = meiaNoite
  const considerar = (data) => { if (data > agora && data < proxima) proxima = data }

  const pausaAte = statusLoja?.pausaAte ? new Date(statusLoja.pausaAte) : null
  if (pausaAte && !Number.isNaN(pausaAte.getTime())) considerar(pausaAte)
  ;(Array.isArray(horarios) ? horarios : []).forEach(horario => {
    periodos(horario).forEach(({ inicio, fim }) => {
      [inicio, fim].forEach(valor => {
        const m = minutos(valor)
        if (m === null) return
        const data = new Date(agora)
        data.setHours(Math.floor(m / 60), m % 60, 0, 0)
        considerar(data)
      })
    })
  })
  return proxima
}
