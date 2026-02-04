import React from 'react'
import { Navigate } from 'react-router-dom'


export default function ProtectedRoute({ children }) {
if (typeof window === 'undefined') return null
const token = localStorage.getItem('nexfood_token') || (JSON.parse(localStorage.getItem('nexfood_user') || 'null')?.token)
if (!token) return <Navigate to="/login" replace />
return children
}