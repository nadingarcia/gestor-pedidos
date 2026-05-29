import { useMemo } from 'react'
import { isDelivery } from '@utils/orderType'

// Gera uma cor consistente baseada no ID do cluster (Hashed Color)
// Garante que o Cluster A sempre tenha a mesma cor, sem limitar a 8 opções.
const getClusterColor = (id) => {
  const colors = [
    { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-900', badge: 'bg-blue-600' },
    { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-900', badge: 'bg-purple-600' },
    { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-900', badge: 'bg-emerald-600' },
    { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-900', badge: 'bg-amber-600' },
    { bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-900', badge: 'bg-rose-600' },
    { bg: 'bg-cyan-100', border: 'border-cyan-300', text: 'text-cyan-900', badge: 'bg-cyan-600' },
    { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-900', badge: 'bg-indigo-600' },
    { bg: 'bg-lime-100', border: 'border-lime-300', text: 'text-lime-900', badge: 'bg-lime-600' },
    { bg: 'bg-fuchsia-100', border: 'border-fuchsia-300', text: 'text-fuchsia-900', badge: 'bg-fuchsia-600' },
  ]
  
  // Hash simples para escolher a cor
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  const index = Math.abs(hash) % colors.length
  return colors[index]
}

// Cálculo de distância Haversine (Km)
const getDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity
  const R = 6371 
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

/**
 * Hook Inteligente de Clusterização
 * @param {Array} pedidos - Lista de pedidos
 * @param {Boolean} enabled - Se a funcionalidade está ativa
 * @param {Number} radiusKm - Distância máxima entre pontos (ex: 2km)
 * @param {Number} maxTimeWindowMinutes - Diferença máxima de tempo entre o 1º e o último pedido do grupo (ex: 30min)
 * @param {Number} maxOrdersPerCluster - Capacidade máxima da bag do motoboy (ex: 4 ou 5)
 */
export function useOrderClustering(
  pedidos, 
  enabled, 
  radiusKm = 2, 
  maxTimeWindowMinutes = 40, 
  maxOrdersPerCluster = 5
) {
  return useMemo(() => {
    // 1. Reset inicial: Se desativado ou vazio
    if (!enabled || !pedidos.length) {
      return pedidos.map(p => ({ ...p, clusterId: null, clusterSize: 1, clusterColor: null }))
    }

    // 2. Separar pedidos que PODEM ser agrupados (Delivery + Pendente/Preparo + Com LatLong)
    // Ignoramos pedidos que já saíram para entrega para não bagunçar a lógica ativa
    const activeDeliveryOrders = pedidos.filter(p => 
      isDelivery(p) && 
      p.enderecoEntrega?.latitude && 
      p.enderecoEntrega?.longitude &&
      ['Recebido', 'Em preparação'].includes(p.status)
    ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) // Ordena por antiguidade (FIFO)

    const clusters = []
    const processedIds = new Set()

    // 3. Algoritmo Greedy com Restrições (Tempo + Espaço + Capacidade)
    activeDeliveryOrders.forEach((baseOrder) => {
      if (processedIds.has(baseOrder._id)) return

      // Inicia um novo cluster com o pedido mais antigo disponível
      const currentCluster = [baseOrder]
      processedIds.add(baseOrder._id)
      const baseTime = new Date(baseOrder.createdAt).getTime()

      // Tenta encher a "bag" (cluster) com pedidos próximos
      // Itera sobre os outros pedidos para ver quem encaixa
      for (const candidate of activeDeliveryOrders) {
        // Se já foi processado ou cluster cheio, pula
        if (processedIds.has(candidate._id)) continue
        if (currentCluster.length >= maxOrdersPerCluster) break 

        // Checagem de Tempo: O candidato chegou muito depois do pedido base?
        const candidateTime = new Date(candidate.createdAt).getTime()
        const timeDiffMinutes = (candidateTime - baseTime) / 60000
        
        if (timeDiffMinutes > maxTimeWindowMinutes) continue // Candidato muito novo para o grupo antigo

        // Checagem de Distância: O candidato está perto de ALGUÉM do grupo?
        // (Isso permite uma rota "corrente": A perto de B, B perto de C)
        const isNearCluster = currentCluster.some(clusterMember => {
          const dist = getDistance(
            parseFloat(clusterMember.enderecoEntrega.latitude),
            parseFloat(clusterMember.enderecoEntrega.longitude),
            parseFloat(candidate.enderecoEntrega.latitude),
            parseFloat(candidate.enderecoEntrega.longitude)
          )
          return dist <= radiusKm
        })

        if (isNearCluster) {
          currentCluster.push(candidate)
          processedIds.add(candidate._id)
        }
      }

      // Só consideramos cluster se tiver mais de 1 pedido
      if (currentCluster.length > 1) {
        clusters.push(currentCluster)
      }
    })

    // 4. Remontar a lista original enriquecida com dados do cluster
    // Mapa rápido para acesso O(1)
    const clusterMap = new Map()
    
    clusters.forEach((cluster, idx) => {
      // ID único baseado no pedido mais antigo (Líder) + timestamp
      const leaderId = cluster[0]._id.slice(-4)
      const clusterId = `rota-${leaderId}-${idx}`
      const color = getClusterColor(clusterId)

      cluster.forEach(order => {
        // Calcular distâncias relativas para UI
        const distances = cluster
          .filter(o => o._id !== order._id)
          .map(o => ({
            orderId: o._id,
            orderNumber: o.numeroPedido || o._id.slice(-4).toUpperCase(),
            address: `${o.enderecoEntrega.rua}, ${o.enderecoEntrega.numero}`,
            distance: getDistance(
              parseFloat(order.enderecoEntrega.latitude),
              parseFloat(order.enderecoEntrega.longitude),
              parseFloat(o.enderecoEntrega.latitude),
              parseFloat(o.enderecoEntrega.longitude)
            )
          })).sort((a,b) => a.distance - b.distance)

        clusterMap.set(order._id, {
          clusterId,
          clusterSize: cluster.length,
          clusterColor: color,
          clusterDistances: distances
        })
      })
    })

    // Retorna a lista original com os metadados injetados
    return pedidos.map(p => {
      const clusterData = clusterMap.get(p._id)
      if (clusterData) {
        return { ...p, ...clusterData }
      }
      return { ...p, clusterId: null, clusterSize: 1, clusterColor: null }
    })

  }, [pedidos, enabled, radiusKm, maxTimeWindowMinutes, maxOrdersPerCluster])
}