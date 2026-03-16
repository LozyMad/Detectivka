/**
 * SSE: подписчики по room_id. При новой поездке в комнате шлём событие всем подключённым клиентам.
 */
const roomClients = new Map(); // roomId -> Set<res>

function subscribe(roomId, res) {
  const id = parseInt(roomId, 10);
  if (Number.isNaN(id) || id < 1) return;
  if (!roomClients.has(id)) roomClients.set(id, new Set());
  roomClients.get(id).add(res);
  res.on('close', () => {
    const set = roomClients.get(id);
    if (set) {
      set.delete(res);
      if (set.size === 0) roomClients.delete(id);
    }
  });
}

function broadcastNewTrip(roomId) {
  const id = parseInt(roomId, 10);
  if (Number.isNaN(id) || id < 1) return;
  const set = roomClients.get(id);
  if (!set || set.size === 0) return;
  const data = JSON.stringify({ type: 'new_trip' });
  const payload = `data: ${data}\n\n`;
  set.forEach((res) => {
    try {
      if (!res.writableEnded) res.write(payload);
    } catch (e) {
      set.delete(res);
    }
  });
}

module.exports = { subscribe, broadcastNewTrip };
