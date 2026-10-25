// Protected files are fetched with the player's token; object URLs stay local.
// Only visible cards load previews, with at most two downloads/renders at once.
(() => {
  const cache = new Map(), pending = new Map(), failures = new Map();
  let observer, notes = [], active = 0, generation = 0;
  const key = note => [note.scenario_id, note.application_address_id, note.application_number, note.application_file_id].join(':');
  const hosts = note => document.querySelectorAll(`[data-board-preview-id="${Number(note.id)}"]`);
  const boardVisible = () => !document.hidden && document.getElementById('board')?.classList.contains('active');

  function paint(note, url, message) {
    for (const host of hosts(note)) {
      if (host.dataset.fileId !== note.application_file_id) continue;
      if (!url) { host.textContent = message; continue; }
      const image = document.createElement('img');
      image.onload = () => window.investigationBoard?.filePreviewReady?.(note.id, image.naturalWidth / image.naturalHeight);
      image.src = url; image.alt = note.title; image.draggable = false; image.decoding = 'async';
      host.replaceChildren(image);
    }
  }

  function clear() {
    generation++;
    observer?.disconnect();
    for (const item of pending.values()) item.controller.abort();
    pending.clear();
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear(); failures.clear(); notes = [];
  }

  function schedule(note) {
    const id = key(note);
    if (cache.has(id) || pending.has(id) || !boardVisible()) return;
    if ((failures.get(id) || 0) > Date.now()) {
      paint(note, null, 'Превью недоступно. Нажмите, чтобы открыть файл.'); return;
    }
    pending.set(id, { note, controller: new AbortController(), started: false, generation });
    pump();
  }

  function pump() {
    for (const [id, item] of pending) {
      if (active >= 2) break;
      if (item.started) continue;
      item.started = true; active++;
      (async () => {
        const note = item.note, signal = item.controller.signal;
        const scenario = Number(note.scenario_id);
        if (!Number.isSafeInteger(scenario) || scenario < 1) throw new Error('Нет сценария');
        const base = `/api/applications/game/scenarios/${scenario}` + (Number(note.application_number) === 0
          ? '/briefing' : `/addresses/${Number(note.application_address_id)}/${Number(note.application_number)}`);
        const pdf = note.application_file_type === 'application/pdf';
        const response = await window.gameNetwork.fetch(`${base}/files/${encodeURIComponent(note.application_file_id)}${pdf ? '' : '?preview=1&width=800'}`, {
          cache: 'no-store', timeoutMs: 60000, signal,
          headers: { Authorization: `Bearer ${gameStorage.getItem('token')}` }
        });
        if (!response.ok) throw new Error('Файл недоступен');
        let blob = await response.blob();
        if (pdf) blob = await window.gamePdfViewer.thumbnail(blob, signal);
        else if (!blob.type.startsWith('image/')) throw new Error('Не изображение');
        if (signal.aborted || item.generation !== generation) return;
        const url = URL.createObjectURL(blob);
        cache.set(id, url);
        // Keep memory bounded on large boards; visible images retain their pixels.
        while (cache.size > 40) { const first = cache.keys().next().value; URL.revokeObjectURL(cache.get(first)); cache.delete(first); }
        paint(note, url);
      })().catch(() => {
        if (!item.controller.signal.aborted && item.generation === generation) {
          failures.set(id, Date.now() + 30000);
          paint(item.note, null, 'Превью недоступно. Нажмите, чтобы открыть файл.');
        }
      }).finally(() => {
        active--;
        if (pending.get(id) === item) pending.delete(id);
        pump();
      });
    }
  }

  function render(currentNotes) {
    notes = currentNotes.filter(note => note.application_file_id);
    observer?.disconnect();
    if (!boardVisible()) return;
    const retained = new Set(notes.map(key));
    for (const [id, item] of pending) if (!retained.has(id)) { item.controller.abort(); pending.delete(id); }
    for (const [id, url] of cache) if (!retained.has(id)) { URL.revokeObjectURL(url); cache.delete(id); }
    observer ||= new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const note = notes.find(item => Number(item.id) === Number(entry.target.dataset.boardPreviewId));
        if (note) schedule(note);
      }
    }, { root: document.getElementById('boardViewport'), rootMargin: '150px' });
    for (const note of notes) {
      if (cache.has(key(note))) paint(note, cache.get(key(note)));
      else for (const host of hosts(note)) observer.observe(host);
    }
  }

  window.boardApplicationPreviews = { render, clear };
  function suspend() { const current = notes; clear(); notes = current; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else render(notes); });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', () => render(notes));
})();
