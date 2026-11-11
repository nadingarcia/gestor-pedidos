// Resposta do caixa a um alarme do NexBot, sem sair do Gestor: frases prontas que preenchem o campo
// (dá para ajustar o texto) e um envio só. É uma mensagem, não uma conversa: se o cliente responder,
// segue no WhatsApp da loja. Se o NexBot não enviar, o aviso continua aberto.
import { useState } from 'react'
import { frasesDoRecado, MAX_RESPOSTA } from '../utils/respostasChamado'

export function RespostaChamado({ recado, numero, onEnviar, onComecar }) {
  const frases = frasesDoRecado(recado, numero)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(null)

  const escolher = (frase) => {
    setTexto(frase.texto)
    setErro(null)
    onComecar?.()
  }

  const enviar = async () => {
    const mensagem = texto.trim()
    if (!mensagem || enviando) return
    setEnviando(true)
    setErro(null)
    const resposta = await onEnviar(mensagem)
    setEnviando(false)
    if (!resposta?.ok) setErro(resposta?.erro || 'Não foi enviado. Responda pelo WhatsApp da loja.')
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-white p-3 text-left">
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-800">
        <i className="fab fa-whatsapp" aria-hidden="true" />
        Responder ao cliente
      </p>
      {frases.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {frases.map((frase) => (
            <button
              key={frase.rotulo}
              type="button"
              onClick={() => escolher(frase)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-300 ${
                texto === frase.texto
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100'
              }`}
            >
              {frase.rotulo}
            </button>
          ))}
        </div>
      )}
      <label className="sr-only" htmlFor="resposta-chamado-texto">Mensagem para o cliente</label>
      <textarea
        id="resposta-chamado-texto"
        value={texto}
        onChange={(e) => { setTexto(e.target.value.slice(0, MAX_RESPOSTA)); setErro(null) }}
        onFocus={() => onComecar?.()}
        rows={3}
        maxLength={MAX_RESPOSTA}
        placeholder={frases.length ? 'Escolha uma frase acima ou escreva a mensagem' : 'Escreva a mensagem para o cliente'}
        className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
      />
      {erro && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">
          <i className="fas fa-triangle-exclamation mr-1" aria-hidden="true" />
          {erro}
        </p>
      )}
      <button
        type="button"
        onClick={enviar}
        disabled={!texto.trim() || enviando}
        className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {enviando ? 'Enviando…' : 'Enviar ao cliente pelo WhatsApp'}
      </button>
    </div>
  )
}
