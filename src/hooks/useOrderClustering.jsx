import { useMemo } from 'react'

// Paleta de cores para clusters (até 8 grupos diferentes)
const CLUSTER_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-900', icon: 'text-blue-500', badge: 'bg-blue-500' },
  { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-900', icon: 'text-purple-500', badge: 'bg-purple-500' },
  { bg: 'bg-pink-50', border: 'border-pink-300', text: 'text-pink-900', icon: 'text-pink-500', badge: 'bg-pink-500' },
  { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-900', icon: 'text-indigo-500', badge: 'bg-indigo-500' },
  { bg: 'bg-cyan-50', border: 'border-cyan-300', text: 'text-cyan-900', icon: 'text-cyan-500', badge: 'bg-cyan-500' },
  { bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-900', icon: 'text-teal-500', badge: 'bg-teal-500' },
  { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-900', icon: 'text-emerald-500', badge: 'bg-emerald-500' },
  { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900', icon: 'text-amber-500', badge: 'bg-amber-500' },
]

export function useOrderClustering(pedidos, enabled, radiusKm = 2) {
  return useMemo(() => {
    if (!enabled || !pedidos.length) {
      return pedidos.map(p => ({ ...p, clusterId: null, clusterSize: 1, clusterColor: null, clusterOrders: [] }))
    }

    // Filtra apenas pedidos com delivery e endereço válido
    const deliveryOrders = pedidos.filter(p => 
      p.tipo === 'Delivery' && 
      p.enderecoEntrega?.latitude && 
      p.enderecoEntrega?.longitude
    )

    if (deliveryOrders.length < 2) {
      return pedidos.map(p => ({ ...p, clusterId: null, clusterSize: 1, clusterColor: null, clusterOrders: [] }))
    }

    // Calcula distância entre dois pontos (Haversine)
    const getDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371 // Raio da Terra em km
      const dLat = (lat2 - lat1) * Math.PI / 180
      const dLon = (lon2 - lon1) * Math.PI / 180
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
      return R * c
    }

    // Algoritmo de clusterização DBSCAN
    const clusters = []
    const visited = new Set()

    deliveryOrders.forEach((order, idx) => {
      if (visited.has(order._id)) return

      const cluster = [order]
      visited.add(order._id)

      // Busca vizinhos próximos
      deliveryOrders.forEach((otherOrder, otherIdx) => {
        if (idx === otherIdx || visited.has(otherOrder._id)) return

        const distance = getDistance(
          parseFloat(order.enderecoEntrega.latitude),
          parseFloat(order.enderecoEntrega.longitude),
          parseFloat(otherOrder.enderecoEntrega.latitude),
          parseFloat(otherOrder.enderecoEntrega.longitude)
        )

        if (distance <= radiusKm) {
          cluster.push(otherOrder)
          visited.add(otherOrder._id)
        }
      })

      if (cluster.length > 1) {
        clusters.push(cluster)
      }
    })

    // Mapeia pedidos com informação de cluster E COR
    const orderMap = new Map()
    pedidos.forEach(p => orderMap.set(p._id, { 
      ...p, 
      clusterId: null, 
      clusterSize: 1, 
      clusterColor: null,
      clusterOrders: [],
      clusterDistances: []
    }))

    clusters.forEach((cluster, clusterIdx) => {
      const clusterId = `cluster-${clusterIdx}`
      const clusterColor = CLUSTER_COLORS[clusterIdx % CLUSTER_COLORS.length] // Cor única por grupo
      
      cluster.forEach(order => {
        // Calcula distâncias para outros pedidos do mesmo cluster
        const distances = cluster
          .filter(o => o._id !== order._id)
          .map(otherOrder => {
            const dist = getDistance(
              parseFloat(order.enderecoEntrega.latitude),
              parseFloat(order.enderecoEntrega.longitude),
              parseFloat(otherOrder.enderecoEntrega.latitude),
              parseFloat(otherOrder.enderecoEntrega.longitude)
            )
            return {
              orderId: otherOrder._id,
              orderNumber: otherOrder._id.slice(-4).toUpperCase(),
              address: `${otherOrder.enderecoEntrega.rua}, ${otherOrder.enderecoEntrega.numero}`,
              distance: dist
            }
          })
          .sort((a, b) => a.distance - b.distance)

        orderMap.set(order._id, {
          ...order,
          clusterId,
          clusterSize: cluster.length,
          clusterColor,
          clusterOrders: cluster.map(o => o._id),
          clusterDistances: distances
        })
      })
    })

    return Array.from(orderMap.values())
  }, [pedidos, enabled, radiusKm])
}