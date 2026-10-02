/**
 * SSE: подписчики по room_id. При новой поездке в комнате шлём событие всем подключённым клиентам.
 */
const roomClients = new Map(); // roomId -> Set<res>
const cleanups = new WeakMap();
let heartbeat = null;

function send(res, payload) {
  if (res.writableEnded || res.destroyed) {
    cleanups.get(res)?.();
    return;
  }
  try {
    // Do not accumulate an unbounded write buffer for disconnected/slow clients.
    if (res.write(payload) === false) {
      cleanups.get(res)?.();
      res.destroy();
    }
  } catch (_) {
    cleanups.get(res)?.();
    res.destroy();
  }
}

function subscribe(roomId, res, expiresAt) {
  const id = parseInt(roomId, 10);
  if (Number.isNaN(id) || id < 1) return;
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) { res.end(); return; }
  cleanups.get(res)?.();
  if (!roomClients.has(id)) roomClients.set(id, new Set());
  roomClients.get(id).add(res);
  let expiryTimer = null;
  const cleanup = () => {
    clearTimeout(expiryTimer);
    res.removeListener('close', cleanup);
    res.removeListener('finish', cleanup);
    res.removeListener('error', cleanup);
    cleanups.delete(res);
    const set = roomClients.get(id);
    if (set) {
      set.delete(res);
      if (set.size === 0) roomClients.delete(id);
    }
    if (!roomClients.size && heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  cleanups.set(res, cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);
  if (Number.isFinite(expiresAt)) {
    expiryTimer = setTimeout(() => { cleanup(); res.end(); }, Math.min(expiresAt - Date.now(), 2147483647));
    expiryTimer.unref?.();
  }
  if (heartbeat === null) {
    heartbeat = setInterval(() => {
      for (const clients of roomClients.values()) {
        for (const client of clients) send(client, ': heartbeat\n\nevent: ping\ndata: {}\n\n');
      }
    }, 25000);
    heartbeat.unref?.();
  }
  send(res, ': connected\n\n');
}

function broadcastNewTrip(roomId) {
  const id = parseInt(roomId, 10);
  if (Number.isNaN(id) || id < 1) return;
  const set = roomClients.get(id);
  if (!set || set.size === 0) return;
  const data = JSON.stringify({ type: 'new_trip' });
  const payload = `data: ${data}\n\n`;
  set.forEach(res => send(res, payload));
}

module.exports = { subscribe, broadcastNewTrip };
