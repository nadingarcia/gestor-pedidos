import React from 'react'
import { createRoot } from 'react-dom/client'
// 1. Troque BrowserRouter por HashRouter aqui
import { HashRouter } from 'react-router-dom' 
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* 2. Use o HashRouter */}
    <HashRouter>
      {/* 
         Dica Extra: Você não precisa envolver o App em <Routes> aqui 
         se o seu App.jsx já tem as <Routes> definidas.
         Basta chamar o App direto.
      */}
      <App />
    </HashRouter>
  </React.StrictMode>
)