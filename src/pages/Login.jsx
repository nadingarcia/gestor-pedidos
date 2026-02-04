import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_URL = 'https://nexfood.vercel.app/api/login'

function formatPhone(value = '') {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

export default function Login() {
  const [telefone, setTelefone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(true)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    
    if (!telefone.trim() || !password) {
      setError('Por favor, preencha todos os campos.')
      return
    }

    setLoading(true)
    
    try {
      const body = { telefone: telefone.replace(/\D/g, ''), password }
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || data?.message || 'Credenciais inválidas.')

      // Login bem-sucedido
      if (remember) {
        localStorage.setItem('nexfood_user', JSON.stringify(data))
        if (data.token) localStorage.setItem('nexfood_token', data.token)
      } else {
        sessionStorage.setItem('nexfood_user', JSON.stringify(data))
        if (data.token) sessionStorage.setItem('nexfood_token', data.token)
      }

      setLoading(false)
      setSuccess(true)

      setTimeout(() => {
        navigate('/pedidos')
      }, 1500)

    } catch (err) {
      setLoading(false)
      setError(err.message || 'Erro desconhecido')
    }
  }

  return (
    <div className="min-h-screen bg-[#0f172a] overflow-hidden relative flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-rose-500/30 text-slate-200">
      
      {/* Background Decorativo (Glow Effects) */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-rose-600/20 rounded-full blur-[120px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-orange-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse" style={{animationDelay: '1s'}} />
      
      {/* Partículas flutuantes */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white/10 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${5 + Math.random() * 10}s`
            }}
          />
        ))}
      </div>

      <div className="w-full max-w-[1200px] grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12 items-stretch relative z-10">
        
        {/* Lado Esquerdo - Branding */}
        <aside className="hidden lg:flex flex-col justify-between p-12 rounded-[2.5rem] bg-gradient-to-br from-white/10 to-white/5 border border-white/10 backdrop-blur-2xl shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-orange-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-5 mb-12">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white font-black text-2xl flex items-center justify-center shadow-2xl shadow-rose-500/30 animate-pulse-glow">
                <i className="fas fa-utensils"></i>
              </div>
              <div>
                <h2 className="text-white text-3xl font-bold tracking-wide">NEXFOOD</h2>
                <p className="text-rose-200/80 font-medium text-sm">Gestor de Pedidos Premium</p>
              </div>
            </div>

            <h3 className="text-3xl text-white font-bold mb-4 leading-relaxed">
              Transforme a gestão do seu restaurante
            </h3>
            <p className="text-slate-300 text-lg mb-10 leading-relaxed">
              Controle total sobre pedidos, equipe e clientes em tempo real.
            </p>

            <ul className="space-y-6">
              <li className="flex items-start gap-4 text-slate-200 group/item">
                <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500/20 to-rose-500/10 text-rose-400 border border-rose-500/20 group-hover/item:scale-110 transition-transform">
                  <i className="fas fa-bolt text-lg"></i>
                </span>
                <div>
                  <h4 className="font-bold text-white mb-1">Tempo Real</h4>
                  <p className="text-sm text-slate-400">Acompanhe todos os pedidos instantaneamente</p>
                </div>
              </li>
              <li className="flex items-start gap-4 text-slate-200 group/item">
                <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-500/10 text-orange-400 border border-orange-500/20 group-hover/item:scale-110 transition-transform">
                  <i className="fas fa-chart-line text-lg"></i>
                </span>
                <div>
                  <h4 className="font-bold text-white mb-1">Análises Detalhadas</h4>
                  <p className="text-sm text-slate-400">Relatórios completos de vendas e performance</p>
                </div>
              </li>
              <li className="flex items-start gap-4 text-slate-200 group/item">
                <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover/item:scale-110 transition-transform">
                  <i className="fas fa-users text-lg"></i>
                </span>
                <div>
                  <h4 className="font-bold text-white mb-1">Gestão de Equipe</h4>
                  <p className="text-sm text-slate-400">Organize e acompanhe toda sua equipe</p>
                </div>
              </li>
            </ul>
          </div>
          
          <div className="relative z-10 mt-12 pt-8 border-t border-white/10">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-2xl">
              <i className="fas fa-quote-left text-slate-500 text-sm"></i>
              </div>
              <div>
                <p className="text-slate-300 italic mb-2">"Melhor sistema que já usamos. Revolucionou nosso atendimento!"</p>
                <p className="text-slate-500 text-sm font-semibold">— Restaurante Sabor Divino</p>
                <div className="flex gap-1 mt-2">
                  {[1,2,3,4,5].map(s => <i key={s} className="fas fa-star text-orange-400 text-xs"></i>)}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Lado Direito - Formulário */}
        <main className="flex flex-col justify-center">
          
          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 md:p-12 shadow-2xl">
            
            {/* Logo Mobile */}
            <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white font-black text-xl flex items-center justify-center shadow-lg shadow-rose-500/20">
                <i className="fas fa-utensils"></i>
              </div>
              <div>
                <h2 className="text-white text-2xl font-bold">NEXFOOD</h2>
              </div>
            </div>

            <header className="mb-10 text-center lg:text-left">
              <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
                Bem-vindo de volta
                <i className="fas fa-hand-wave text-yellow-400 ml-3 inline-block animate-bounce-short"></i>
              </h1>
              <p className="text-slate-400 text-lg">Digite suas credenciais para continuar</p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Mensagem de Erro */}
              {error && (
                <div className="animate-fadeInUp flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-200 text-sm font-medium backdrop-blur-sm">
                  <i className="fas fa-exclamation-circle text-red-400 text-lg"></i>
                  <span>{error}</span>
                </div>
              )}

              {/* Input Telefone */}
              <div className="group">
                <label className="block text-slate-300 text-sm font-semibold mb-3 ml-1" htmlFor="telefone">
                  <i className="fas fa-phone mr-2 text-rose-400"></i>
                  TELEFONE
                </label>
                <div className="relative transition-all duration-300 transform group-focus-within:scale-[1.01]">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-rose-400 transition-colors">
                    <i className="fas fa-mobile-alt text-xl"></i>
                  </div>
                  <input
                    id="telefone"
                    type="tel"
                    inputMode="numeric"
                    value={telefone}
                    onChange={(e) => setTelefone(formatPhone(e.target.value))}
                    placeholder="(11) 99999-9999"
                    className="w-full h-14 pl-14 pr-4 rounded-2xl bg-white/5 border-2 border-white/10 text-white placeholder:text-slate-500 focus:bg-white/10 focus:border-rose-500/50 focus:ring-4 focus:ring-rose-500/10 outline-none transition-all text-lg font-medium tracking-wide"
                  />
                </div>
              </div>

              {/* Input Senha */}
              <div className="group">
                <div className="flex justify-between items-center mb-3 ml-1">
                  <label className="text-slate-300 text-sm font-semibold" htmlFor="password">
                    <i className="fas fa-lock mr-2 text-rose-400"></i>
                    SENHA
                  </label>
                </div>
                
                <div className="relative transition-all duration-300 transform group-focus-within:scale-[1.01]">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-rose-400 transition-colors">
                    <i className="fas fa-key text-xl"></i>
                  </div>
                  <input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-14 pl-14 pr-14 rounded-2xl bg-white/5 border-2 border-white/10 text-white placeholder:text-slate-500 focus:bg-white/10 focus:border-rose-500/50 focus:ring-4 focus:ring-rose-500/10 outline-none transition-all text-lg font-medium tracking-wide"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/10 transition"
                  >
                    <i className={`fas ${showPwd ? 'fa-eye-slash' : 'fa-eye'} text-lg`}></i>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="inline-flex items-center gap-3 cursor-pointer group/check">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={() => setRemember(!remember)}
                      className="peer sr-only"
                    />
                    <div className="w-6 h-6 border-2 border-slate-600 rounded-lg peer-checked:bg-gradient-to-br peer-checked:from-rose-500 peer-checked:to-orange-500 peer-checked:border-transparent transition-all"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity">
                      <i className="fas fa-check text-sm"></i>
                    </div>
                  </div>
                  <span className="text-slate-300 group-hover/check:text-white transition text-base">Manter conectado</span>
                </label>

                <a href="#" className="text-rose-400 hover:text-rose-300 text-sm font-medium hover:underline decoration-rose-400/30 underline-offset-4 transition flex items-center gap-1">
                  <span>Esqueceu a senha?</span>
                  <i className="fas fa-arrow-right text-xs"></i>
                </a>
              </div>

              {/* Botão de Ação */}
              <div className="pt-6">
                <button
                  type="submit"
                  disabled={loading || success}
                  className={`
                    w-full h-16 rounded-2xl font-bold text-lg text-white shadow-2xl flex items-center justify-center gap-3 transition-all duration-500 relative overflow-hidden
                    ${success 
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 scale-100 shadow-emerald-500/50' 
                      : 'bg-gradient-to-r from-rose-600 to-orange-500 hover:scale-[1.02] hover:shadow-rose-500/40 active:scale-[0.98]'
                    }
                    disabled:opacity-80 disabled:cursor-not-allowed
                  `}
                >
                  <span className="relative z-10 flex items-center gap-3">
                    {loading ? (
                      <>
                        <i className="fas fa-spinner fa-spin text-xl"></i>
                        <span>Autenticando...</span>
                      </>
                    ) : success ? (
                      <>
                        <i className="fas fa-check-circle text-xl animate-bounce-short"></i>
                        <span>Login Aprovado!</span>
                      </>
                    ) : (
                      <>
                        <span>Entrar no Sistema</span>
                        <i className="fas fa-arrow-right"></i>
                      </>
                    )}
                  </span>
                  
                  {/* Efeito de brilho no hover */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                </button>
              </div>

              {/* Links adicionais */}
              <div className="pt-6 text-center border-t border-white/10">
                <p className="text-slate-400 text-sm mb-3">Ainda não tem uma conta?</p>
                <a href="#" className="inline-flex items-center gap-2 text-rose-400 hover:text-rose-300 font-semibold transition">
                  <span>Solicitar acesso</span>
                  <i className="fas fa-external-link-alt text-xs"></i>
                </a>
              </div>

            </form>
          </div>
          
          <p className="text-center text-slate-500 text-sm mt-8 flex items-center justify-center gap-2">
            <i className="fas fa-shield-alt text-emerald-500"></i>
            <span>&copy; 2024 NexFood. Desenvolvido com tecnologia de ponta.</span>
          </p>
        </main>
      </div>

      {/* Estilo adicional para animação de float */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0; }
          10% { opacity: 0.3; }
          50% { transform: translateY(-100px) translateX(50px); opacity: 0.6; }
          90% { opacity: 0.3; }
        }
        .animate-float {
          animation: float linear infinite;
        }
      `}</style>
    </div>
  )
}