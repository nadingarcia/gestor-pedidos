// Canal de avisos do servidor: "um pedido mudou", "a loja foi pausada", "o celular pediu para imprimir".
// O aviso só antecipa a busca: se o canal cair, o gestor segue com a consulta periódica de sempre.
import { apiFetch, API_PRINCIPAL } from './apiFetch'
import { cabecalhosDoGestor } from './gestorIdentidade'

const SEM_DADOS_MS = 60 * 1000 // o servidor manda sinal a cada 25 s
const ESPERA_MIN_MS = 2000
const ESPERA_MAX_MS = 30 * 1000
const ESPERA_INDISPONIVEL_MS = 5 * 60 * 1000
const ESPERA_REINICIO_MS = 30 * 1000

const lerToken = () => localStorage.getItem('nexfood_token') || sessionStorage.getItem('nexfood_token')

/**
 * Abre a conexão e reconecta sozinho. Retorna a função para parar.
 * Só usa o VPS: a Vercel não mantém conexão aberta, e uma queda do canal não pode
 * mandar o resto do gestor para a reserva.
 */
export function conectarCanal({ aoAviso, aoMudarConexao }) {
  let parado = false
  let controle = null
  let timerReabrir = null
  let timerSilencio = null
  let espera = ESPERA_MIN_MS

  const vigiar = () => {
    clearTimeout(timerSilencio)
    timerSilencio = setTimeout(() => controle?.abort(), SEM_DADOS_MS)
  }

  const ler = async (corpo, atual) => {
    const leitor = corpo.getReader()
    const decodificador = new TextDecoder()
    let resto = ''
    espera = ESPERA_MIN_MS
    aoMudarConexao(true)
    vigiar()
    while (!atual.signal.aborted) {
      const { value, done } = await leitor.read()
      if (done) return
      vigiar()
      resto += decodificador.decode(value, { stream: true })
      let fim
      while ((fim = resto.indexOf('\n\n')) >= 0) {
        const bloco = resto.slice(0, fim)
        resto = resto.slice(fim + 2)
        const tipo = /^event: (\w+)/m.exec(bloco)?.[1]
        if (tipo) aoAviso(tipo)
      }
    }
  }

  const abrir = async () => {
    if (parado) return
    const token = lerToken()
    const atual = new AbortController()
    controle = atual
    let proxima = espera
    try {
      const res = await fetch(`${API_PRINCIPAL}/api/eventos`, {
        headers: { ...cabecalhosDoGestor(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: atual.signal,
      })
      if (res.status === 401) {
        await apiFetch(`${API_PRINCIPAL}/api/gestor/status`) // renova o token pelo caminho de sempre
      } else if (res.status === 503) {
        proxima = ESPERA_REINICIO_MS // escuta do banco reiniciando: enquanto isso, consulta a cada 10 s
      } else if (!res.ok || !res.body) {
        proxima = ESPERA_INDISPONIVEL_MS // servidor sem o canal: não insiste
      } else {
        await ler(res.body, atual)
      }
    } catch { /* queda de rede: tenta de novo */ }

    clearTimeout(timerSilencio)
    aoMudarConexao(false)
    espera = Math.min(espera * 2, ESPERA_MAX_MS)
    if (!parado) timerReabrir = setTimeout(abrir, proxima)
  }

  abrir()
  return () => {
    parado = true
    clearTimeout(timerReabrir)
    clearTimeout(timerSilencio)
    controle?.abort()
  }
}
