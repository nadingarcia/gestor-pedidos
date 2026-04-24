import React from 'react'
import { Navigate } from 'react-router-dom'

export default function ProtectedRoute({ children }) {
  if (typeof window === 'undefined') return null

  // Verifica se existe o token principal OU o refresh token (em qualquer storage)
  const hasToken = localStorage.getItem('nexfood_token') || sessionStorage.getItem('nexfood_token')
  const hasRefreshToken = localStorage.getItem('nexfood_refresh_token') || sessionStorage.getItem('nexfood_refresh_token')

  // Se o usuário não tiver NENHUM dos dois, aí sim ele é deslogado
  if (!hasToken && !hasRefreshToken) {
    // Nota: coloquei "/login", se a sua rota de login for "/", basta alterar
    return <Navigate to="/login" replace /> 
  }

  // Se tiver algum token, deixa a tela abrir. 
  // O seu novo 'apiFetch' fará o trabalho pesado: se o token estiver vencido, 
  // ele usa o refresh token de forma invisível. Se o refresh falhar, 
  // o próprio apiFetch redireciona o usuário para o login.
  return children
}