// Identidade deste computador para o servidor: um id fixo e um nome que a dona reconhece no celular
// ("Caixa", "Notebook"). Com dois gestores abertos, é por aqui que o servidor escolhe o principal.
import electronAPI from './electronBridge'
import packageInfo from '../../package.json'

const CHAVE_ID = 'nexfood_gestor_id'
const CHAVE_NOME = 'nexfood_gestor_nome'
let nomeDoSistema = ''

function lerOuCriarId() {
  try {
    let id = localStorage.getItem(CHAVE_ID)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(CHAVE_ID, id)
    }
    return id
  } catch {
    return ''
  }
}

const idDoComputador = lerOuCriarId()

export const getGestorId = () => idDoComputador

export function getNomeComputador() {
  try {
    return localStorage.getItem(CHAVE_NOME) || nomeDoSistema
  } catch {
    return nomeDoSistema
  }
}

export function salvarNomeComputador(nome) {
  try {
    const limpo = String(nome || '').trim().slice(0, 40)
    if (limpo) localStorage.setItem(CHAVE_NOME, limpo)
    else localStorage.removeItem(CHAVE_NOME)
  } catch { /* sem storage */ }
}

export const getNomeDoSistema = () => nomeDoSistema

// Nome do sistema operacional como padrão, até a dona dar um nome
electronAPI.getHostname?.().then((nome) => {
  if (typeof nome === 'string') nomeDoSistema = nome.slice(0, 40)
}).catch(() => {})

/** Cabeçalhos que identificam este computador em toda chamada à API. */
export function cabecalhosDoGestor() {
  const nome = getNomeComputador()
  return {
    'X-Gestor-Versao': packageInfo.version,
    ...(idDoComputador ? { 'X-Gestor-Id': idDoComputador } : {}),
    ...(nome ? { 'X-Gestor-Nome': encodeURIComponent(nome) } : {}),
  }
}
