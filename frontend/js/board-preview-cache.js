// Cache only rendered thumbnails, separately for each authenticated session.
// A hashed namespace avoids putting tokens or file names in cache URLs.
(() => {
  const cacheName = 'detectum-board-previews-v1';
  const maxAge = 6 * 60 * 60 * 1000, maxBytes = 20 * 1024 * 1024, maxEntries = 60;
  let identity, scopePromise, writes = Promise.resolve();

  function scope() {
    const token = gameStorage.getItem('token'), player = gameStorage.getItem('roomUser');
    if (!token || !player || !window.caches || !window.crypto?.subtle) return Promise.resolve(null);
    const current = `${token}|${player}`;
    if (current !== identity) {
      identity = current;
      scopePromise = window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(current)).then(buffer => {
        const hash = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        let expires = Date.now() + maxAge;
        try {
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (Number.isFinite(payload.exp)) expires = Math.min(expires, payload.exp * 1000);
        } catch (_) { /* The server is responsible for validating tokens. */ }
        return { prefix: `${window.location.origin}/__board-previews/${hash}/`, expires };
      }).catch(() => null);
    }
    return scopePromise;
  }

  async function read(key) {
    try {
      const session = await scope();
      if (!session || session.expires <= Date.now()) return null;
      const cache = await window.caches.open(cacheName);
      const url = session.prefix + encodeURIComponent(key);
      const response = await cache.match(url);
      if (!response) return null;
      if (Number(response.headers.get('X-Preview-Expires')) <= Date.now()) {
        await cache.delete(url); return null;
      }
      const blob = await response.blob();
      return blob.type.startsWith('image/') ? blob : null;
    } catch (_) { return null; } // Disabled storage must never prevent opening a file.
  }

  function get(key) {
    let timer;
    // A blocked or overloaded storage backend should not delay the network path.
    return Promise.race([read(key), new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); })])
      .finally(() => clearTimeout(timer));
  }

  function put(key, blob) {
    const sessionScope = scope();
    const savedIdentity = identity;
    if (!blob.type.startsWith('image/') || blob.size > 2 * 1024 * 1024) return Promise.resolve();
    writes = writes.catch(() => {}).then(async () => {
      const session = await sessionScope;
      if (!session || identity !== savedIdentity || session.expires <= Date.now()) return;
      const cache = await window.caches.open(cacheName);
      const url = session.prefix + encodeURIComponent(key);
      await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type,
        'X-Preview-Expires': String(Math.min(session.expires, Date.now() + maxAge)),
        'X-Preview-Created': String(Date.now()), 'X-Preview-Bytes': String(blob.size) } }));
      const entries = await Promise.all((await cache.keys()).map(async request => {
        const response = await cache.match(request);
        return { request, expires: Number(response?.headers.get('X-Preview-Expires')) || 0,
          created: Number(response?.headers.get('X-Preview-Created')) || 0,
          bytes: Number(response?.headers.get('X-Preview-Bytes')) || maxBytes };
      }));
      entries.sort((a, b) => a.created - b.created);
      let total = entries.reduce((sum, entry) => sum + entry.bytes, 0), count = entries.length;
      for (const entry of entries) if (entry.expires <= Date.now() || total > maxBytes || count > maxEntries) {
        await cache.delete(entry.request); total -= entry.bytes; count--;
      }
    }).catch(() => {});
    return writes;
  }

  function clearSession() {
    const previous = scopePromise || scope();
    identity = null; scopePromise = null;
    writes = writes.catch(() => {}).then(async () => {
      const session = await previous;
      if (!session) return;
      const cache = await window.caches.open(cacheName);
      for (const request of await cache.keys()) if (request.url.startsWith(session.prefix)) await cache.delete(request);
    }).catch(() => {});
    return writes;
  }

  window.boardPreviewCache = { get, put, clearSession };
})();
