import { useState, useCallback, useId, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const API_URL = 'http://localhost:3000/api/login'

// ============================================================================
// UTILITIES
// ============================================================================

const formatPhone = (value = '') => {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

const storage = {
  set: (key, value, persistent = true) => {
    try {
      const store = persistent ? localStorage : sessionStorage
      store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
      return true
    } catch {
      console.warn('Storage não disponível')
      return false
    }
  }
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function Login() {
  const [telefone, setTelefone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [state, setState] = useState({ loading: false, success: false, error: '' })
  
  const navigate = useNavigate()

  useEffect(() => {
    // Verifica se já existe um token salvo (Seja fixo ou temporário)
    const token = localStorage.getItem('nexfood_token') || sessionStorage.getItem('nexfood_token')
    
    // Se tiver token, manda para pedidos e não renderiza o form
    if (token) {
      navigate('/pedidos', { replace: true })
    }
  }, [navigate])
  
  const phoneId = useId()
  const passwordId = useId()
  const errorId = useId()

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handlePhoneChange = useCallback((e) => {
    setTelefone(formatPhone(e.target.value))
  }, [])

  const handlePasswordChange = useCallback((e) => {
    setPassword(e.target.value)
  }, [])

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword(prev => !prev)
  }, [])

  const toggleRemember = useCallback(() => {
    setRemember(prev => !prev)
  }, [])

  // ============================================================================
  // SUBMIT
  // ============================================================================

  const handleSubmit = async (e) => {
    e.preventDefault()
    setState({ loading: false, success: false, error: '' })

    if (!telefone.trim()) {
      setState({ loading: false, success: false, error: 'Por favor, informe seu telefone.' })
      return
    }
    if (!password) {
      setState({ loading: false, success: false, error: 'Por favor, informe sua senha.' })
      return
    }

    setState({ loading: true, success: false, error: '' })

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: telefone.replace(/\D/g, ''),
          password
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          response.status === 401 
            ? 'Telefone ou senha incorretos.' 
            : 'Erro ao conectar. Tente novamente.'
        )
      }

            // DEPOIS
      const { assinatura, endereco } = data

      // ✅ Verifica assinatura antes de deixar entrar
      const statusBloqueado = ['cancelado', 'atrasado'].includes(assinatura?.status)
      const trialExpirado = assinatura?.status === 'trial' && 
        assinatura?.dataFimTrial && 
        new Date(assinatura.dataFimTrial) < new Date()

      if (statusBloqueado || trialExpirado) {
        setState({
          loading: false,
          success: false,
          error: '__BLOCKED__' // flag especial, tratada no render
        })
        return
      }

      // ✅ Salva credenciais
      storage.set('nexfood_user', data, remember)
      if (data.token) storage.set('nexfood_token', data.token, remember)
      if (data.refreshToken) storage.set('nexfood_refresh_token', data.refreshToken, remember)

        console.log('Dados de integrações recebidos no login:', data.integracoes)

      if (data.integracoes) storage.set('nexfood_integracoes', data.integracoes, remember)

      if (endereco?.logradouro) {
        const enderecoFormatado = `${endereco.logradouro}, ${endereco.numero}, ${endereco.bairro}, ${endereco.cidade}, ${endereco.estado}`
        localStorage.setItem('enderecoRestaurante', enderecoFormatado)
      }
      if(data.cnpj) {
        localStorage.setItem('cnpjRestaurante', data.cnpj)
      }
      if (data.nomeRestaurante) {
        localStorage.setItem('nomeRestaurante', data.nomeRestaurante)
      }

      setState({ loading: false, success: true, error: '' })
      setTimeout(() => navigate('/pedidos'), 1200)

    } catch (err) {
      setState({ 
        loading: false, 
        success: false, 
        error: err.message || 'Erro de conexão. Verifique sua internet.' 
      })
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans antialiased">
      
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        
        {/* ========================================================================
            SEÇÃO ESQUERDA - Branding
        ======================================================================== */}
        <aside className="hidden lg:flex flex-col justify-center p-12">
          
          {/* Logo */}
          <div className="flex items-center gap-4 mb-12">
            <div className="w-16 h-16 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-lg">
              <i className="fas fa-bolt text-white text-2xl"></i>
            </div>
            <div>
              <h2 className="text-gray-900 text-3xl font-bold tracking-tight">NEX
                <i className="fas fa-bolt"></i>
                FOOD</h2>
              <p className="text-gray-500 text-sm font-medium">Gestão de Pedidos Premium</p>
            </div>
          </div>

          <h3 className="text-4xl text-gray-900 font-bold mb-4 leading-tight">
            Transforme a gestão do seu restaurante
          </h3>
          <p className="text-gray-600 text-lg mb-12 leading-relaxed">
            Controle total sobre pedidos, equipe e clientes em tempo real.
          </p>

          {/* Features */}
          <ul className="space-y-6" role="list">
            {[
              { icon: 'bolt', title: 'Tempo Real', desc: 'Acompanhe todos os pedidos instantaneamente', color: 'purple' },
              { icon: 'chart-line', title: 'Análises Detalhadas', desc: 'Relatórios completos de vendas', color: 'blue' },
              { icon: 'users', title: 'Gestão de Equipe', desc: 'Organize toda sua operação', color: 'emerald' }
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-4">
                <div className={`flex-shrink-0 w-12 h-12 rounded-lg bg-${item.color}-50 border border-${item.color}-200 flex items-center justify-center`}>
                  <i className={`fas fa-${item.icon} text-${item.color}-600 text-lg`}></i>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 text-base">{item.title}</h4>
                  <p className="text-sm text-gray-600 mt-0.5">{item.desc}</p>
                </div>
              </li>
            ))}
          </ul>

          {/* Depoimento */}
          <div className="mt-12 pt-8 border-t border-gray-200">
            <div className="flex gap-4">
              <div className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-quote-left text-gray-400 text-sm"></i>
              </div>
              <div>
                <p className="text-gray-700 italic leading-relaxed mb-2">
                  "Melhor sistema que já usamos. Revolucionou nosso atendimento!"
                </p>
                <p className="text-gray-500 text-sm font-medium">— Restaurante Sabor Divino</p>
                <div className="flex gap-0.5 mt-2" aria-label="5 estrelas">
                  {[...Array(5)].map((_, i) => (
                    <i key={i} className="fas fa-star text-yellow-400 text-xs"></i>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ========================================================================
            FORMULÁRIO PRINCIPAL
        ======================================================================== */}
        <main className="flex flex-col justify-center">
          
          <div className="bg-white border border-gray-200 rounded-2xl p-8 md:p-10 shadow-sm">
            
            {/* Logo Mobile */}
            <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
              <div className="w-14 h-14 rounded-xl bg-[#7f22fe] flex items-center justify-center shadow-lg">
                <i className="fas fa-utensils text-white text-xl"></i>
              </div>
              <div>
                <h2 className="text-gray-900 text-2xl font-bold">NEXFOOD</h2>
                <p className="text-gray-500 text-xs font-medium">Gestão de Pedidos</p>
              </div>
            </div>

            {/* Header */}
            <header className="mb-8 text-center lg:text-left">
              <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">
                Bem-vindo de volta
              </h1>
              <p className="text-gray-600">Digite suas credenciais para continuar</p>
            </header>

            <form onSubmit={handleSubmit} noValidate>
              
              {/* DEPOIS — erro normal + tela de bloqueio */}
              {state.error === '__BLOCKED__' ? (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                      <i className="fas fa-lock text-red-500 text-3xl"></i>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Acesso Suspenso</h2>
                    <p className="text-gray-500 text-sm mb-6 leading-relaxed">
                      Sua assinatura não está ativa. Regularize pelo sistema ou fale com o suporte.
                    </p>
                    <div className="space-y-3">
                      <a
                        href="https://painel.nexfood.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-3 bg-[#7f22fe] hover:bg-[#6b1de0] text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                      >
                        <i className="fas fa-globe"></i>
                        Acessar Sistema NexFood
                      </a>
                      <a
                        href="https://wa.me/5511968337522?text=Olá, minha conta NexFood está suspensa e preciso de ajuda."
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                      >
                        <i className="fab fa-whatsapp text-xl"></i>
                        Falar com Suporte
                      </a>
                      <button
                        onClick={() => setState({ loading: false, success: false, error: '' })}
                        className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                </div>
              ) : state.error ? (
                <div
                  id={errorId}
                  role="alert"
                  aria-live="assertive"
                  className="flex items-start gap-3 p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm animate-fadeIn"
                >
                  <i className="fas fa-exclamation-circle text-red-500 text-lg flex-shrink-0 mt-0.5"></i>
                  <span className="font-medium">{state.error}</span>
                </div>
              ) : null}

              {/* Mensagem de Sucesso */}
              {state.success && (
                <div 
                  role="status" 
                  aria-live="polite"
                  className="flex items-center gap-3 p-4 mb-6 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm animate-fadeIn"
                >
                  <i className="fas fa-check-circle text-emerald-500 text-lg"></i>
                  <span className="font-medium">Login aprovado! Redirecionando...</span>
                </div>
              )}

              <div className="space-y-5">
                
                {/* INPUT TELEFONE */}
                <div>
                  <label 
                    htmlFor={phoneId} 
                    className="block text-gray-700 text-sm font-semibold mb-2"
                  >
                    Telefone
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <i className="fas fa-mobile-alt text-lg"></i>
                    </div>
                    <input
                      id={phoneId}
                      type="tel"
                      inputMode="numeric"
                      value={telefone}
                      onChange={handlePhoneChange}
                      placeholder="(11) 99999-9999"
                      aria-invalid={state.error ? 'true' : 'false'}
                      aria-describedby={state.error ? errorId : undefined}
                      autoComplete="tel"
                      required
                      className="w-full h-14 pl-12 pr-4 rounded-lg bg-gray-50 border-2 border-gray-200 text-gray-900 placeholder:text-gray-400 
                        focus:bg-white focus:border-[#7f22fe] focus:ring-4 focus:ring-purple-100 
                        outline-none transition-all text-base
                        hover:border-gray-300"
                    />
                  </div>
                </div>

                {/* INPUT SENHA */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label 
                      htmlFor={passwordId} 
                      className="text-gray-700 text-sm font-semibold"
                    >
                      Senha
                    </label>
                    <a 
                      href="#recuperar" 
                      className="text-[#7f22fe] hover:text-[#6b1de0] text-xs font-medium hover:underline transition"
                    >
                      Esqueceu?
                    </a>
                  </div>
                  
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <i className="fas fa-lock text-lg"></i>
                    </div>
                    <input
                      id={passwordId}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={handlePasswordChange}
                      placeholder="••••••••"
                      aria-invalid={state.error ? 'true' : 'false'}
                      aria-describedby={state.error ? errorId : undefined}
                      autoComplete="current-password"
                      required
                      className="w-full h-14 pl-12 pr-14 rounded-lg bg-gray-50 border-2 border-gray-200 text-gray-900 placeholder:text-gray-400 
                        focus:bg-white focus:border-[#7f22fe] focus:ring-4 focus:ring-purple-100 
                        outline-none transition-all text-base
                        hover:border-gray-300"
                    />
                    <button
                      type="button"
                      onClick={togglePasswordVisibility}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100 transition focus:outline-none focus:ring-2 focus:ring-[#7f22fe]/50"
                    >
                      <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-base`}></i>
                    </button>
                  </div>
                </div>

                {/* Checkbox */}
                <div className="flex items-center justify-between pt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={toggleRemember}
                      className="w-5 h-5 rounded border-2 border-gray-300 text-[#7f22fe] focus:ring-2 focus:ring-[#7f22fe]/50 focus:ring-offset-2 cursor-pointer transition-all"
                    />
                    <span className="text-gray-700 group-hover:text-gray-900 transition text-sm font-medium">
                      Manter conectado
                    </span>
                  </label>
                </div>

                {/* BOTÃO SUBMIT */}
                <button
                  type="submit"
                  disabled={state.loading || state.success}
                  className="
                    w-full h-14 rounded-lg font-semibold text-base text-white 
                    bg-[#7f22fe] hover:bg-[#6b1de0]
                    shadow-sm hover:shadow-md
                    disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-[#7f22fe]
                    transition-all duration-200
                    focus:outline-none focus:ring-4 focus:ring-purple-200
                    flex items-center justify-center gap-2
                    active:scale-[0.98]
                  "
                >
                  {state.loading ? (
                    <>
                      <i className="fas fa-spinner fa-spin text-lg"></i>
                      <span>Autenticando...</span>
                    </>
                  ) : state.success ? (
                    <>
                      <i className="fas fa-check-circle text-lg"></i>
                      <span>Login aprovado!</span>
                    </>
                  ) : (
                    <>
                      <span>Entrar no Sistema</span>
                      <i className="fas fa-arrow-right"></i>
                    </>
                  )}
                </button>
              </div>

              {/* Footer */}
              <div className="pt-6 mt-6 text-center border-t border-gray-200">
                <p className="text-gray-500 text-sm mb-2">Ainda não tem uma conta?</p>
                
                {/* Link modificado para WhatsApp */}
                <a 
                  href="https://wa.me/5511968337522?text=Ol%C3%A1%2C%20gostaria%20de%20saber%20mais%20sobre%20o%20sistema%20NexFood%20e%20solicitar%20acesso%21" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#7f22fe] hover:text-[#6b1de0] font-semibold text-sm transition hover:underline"
                >
                  <span>Solicitar acesso via WhatsApp</span>
                  <i className="fab fa-whatsapp text-sm ml-1"></i>
                </a>
              </div>

            </form>
          </div>
          
          {/* Copyright */}
          <div className="text-center mt-8">
            <div className="inline-flex items-center gap-3 text-gray-400 text-xs bg-white border border-gray-200 px-4 py-3 rounded-lg">
              <i className="fas fa-shield-alt text-emerald-500"></i>
              <span>&copy; 2024 NexFood • Desenvolvido por Nadin Garcia</span>
            </div>
          </div>
        </main>

      </div>

      {/* Animações */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        
        /* Custom checkbox styling */
        input[type="checkbox"]:checked {
          background-color: #7f22fe;
          border-color: #7f22fe;
          background-image: url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e");
        }
      `}</style>
    </div>
  )
}