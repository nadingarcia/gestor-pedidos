import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import ProtectedRoute from './components/ProtectedRoute'
import OrderManager from './pages/OrderManager'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* ← ADICIONE ESTA ROTA */}
      <Route
        path="/pedidos"
        element={
          <ProtectedRoute>
            <OrderManager />
          </ProtectedRoute>
        }
      />
      
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}