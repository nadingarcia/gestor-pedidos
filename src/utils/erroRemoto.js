// Avisa o servidor quando o gestor quebra numa loja (para ver: pm2 logs nexfood-api | grep GESTOR:ERRO).
// Nunca pode atrapalhar o gestor: falha em silêncio e usa fetch direto, sem renovar token nem trocar de servidor.
import { API_PRINCIPAL } from './apiFetch'
import { cabecalhosDoGestor } from './gestorIdentidade'

const MAXIMO_POR_SESSAO = 10
// Queda de internet o gestor já mostra; o resto é ruído do navegador
const IGNORAR = /failed to fetch|networkerror|load failed|aborterror|the operation was aborted|resizeobserver loop|^script error\.?$/i
const enviados = new Set()

function enviar({ mensagem, origem = '', linha = 0, coluna = 0, stack = '', tipo }) {
  const texto = String(mensagem || '').trim()
  if (!texto || IGNORAR.test(texto)) return
  if (enviados.has(texto) || enviados.size >= MAXIMO_POR_SESSAO) return
  const token = localStorage.getItem('nexfood_token') || sessionStorage.getItem('nexfood_token')
  if (!token) return
  enviados.add(texto)
  fetch(`${API_PRINCIPAL}/api/gestor/erros`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...cabecalhosDoGestor() },
    body: JSON.stringify({
      mensagem: texto.slice(0, 300),
      origem: String(origem).split('?')[0].slice(0, 200),
      linha,
      coluna,
      stack: String(stack || '').slice(0, 800),
      tipo,
      tela: location.hash.split('?')[0].slice(0, 40),
    }),
  }).catch(() => {})
}

window.addEventListener('error', (evento) => {
  if (!evento.message) return
  enviar({ mensagem: evento.message, origem: evento.filename, linha: evento.lineno, coluna: evento.colno, stack: evento.error?.stack, tipo: 'erro' })
})

window.addEventListener('unhandledrejection', (evento) => {
  const motivo = evento.reason
  enviar({ mensagem: motivo?.message || motivo, stack: motivo?.stack, tipo: 'promessa' })
})

// Muitos erros são capturados e só vão para console.error(e): sem isto, nunca chegariam ao servidor
const consoleErrorOriginal = console.error
console.error = (...args) => {
  const erro = args.find((arg) => arg instanceof Error)
  if (erro) enviar({ mensagem: erro.message, stack: erro.stack, tipo: 'capturado' })
  consoleErrorOriginal.apply(console, args)
}
