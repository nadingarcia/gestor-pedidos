import React from 'react'
import { Navigate } from 'react-router-dom'

export default function ProtectedRoute({ children }) {
  if (typeof window === 'undefined') return null

  // 1. Verifica token no LocalStorage (Login persistente)
  const localToken = localStorage.getItem('nexfood_token')
  const localUserToken = JSON.parse(localStorage.getItem('nexfood_user') || 'null')?.token

  // 2. Verifica token no SessionStorage (Login temporário - O QUE FALTAVA)
  const sessionToken = sessionStorage.getItem('nexfood_token')
  const sessionUserToken = JSON.parse(sessionStorage.getItem('nexfood_user') || 'null')?.token

  // Se encontrar em QUALQUER um dos lugares, libera o acesso
  const token = localToken || localUserToken || sessionToken || sessionUserToken

  // Se não tiver token nenhum, manda para o login
  if (!token) return <Navigate to="/" replace />

  return children
}