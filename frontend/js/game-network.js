// Shared by the game and the board. A slot stays occupied until the body is read.
(() => {
  const active = new Set();
  const queue = [];
  const reads = new Map();
  const limit = 3; // Leave room for SSE and navigation on HTTP/1.1.
  const queueLimit = 64;
  let suspended = false;

  function abortError(message = 'Запрос отменён') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  function pump() {
    if (suspended) return;
    while (active.size < limit && queue.length) {
      const job = queue.shift();
      if (job.settled) continue;
      if (job.expiresAt <= performance.now()) { job.timeout(); continue; }
      active.add(job);
      // Mutations are never retried: an interrupted response may already be committed.
      Promise.resolve().then(async () => {
        if (job.settled) throw abortError();
        const response = await fetch(job.url, { ...job.options, signal: job.controller.signal });
        const body = await response.arrayBuffer();
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: response.headers
        });
      }).then(response => finish(job, null, response), error => finish(job, error));
    }
  }

  function finish(job, error, response) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    job.options.signal?.removeEventListener('abort', job.externalAbort);
    active.delete(job);
    const index = queue.indexOf(job);
    if (index !== -1) queue.splice(index, 1);
    if (error) job.reject(error);
    else job.resolve(response);
    pump();
  }

  function cancel(job, error) {
    job.controller.abort();
    finish(job, error);
  }

  function request(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const read = method === 'GET' || method === 'HEAD';
    if (suspended || navigator.onLine === false || (read && document.hidden)) {
      return Promise.reject(abortError('Обновление приостановлено'));
    }
    if (options.signal?.aborted) return Promise.reject(abortError());
    const headers = new Headers(options.headers);
    const key = read && !options.signal ? JSON.stringify([url, method, [...headers].sort(),
      options.credentials || '', options.cache || '', options.mode || '']) : null;
    if (key && reads.has(key)) return reads.get(key).then(response => response.clone());
    if (queue.length >= queueLimit) return Promise.reject(new Error('Слишком много ожидающих запросов. Подождите завершения текущих действий.'));

    let job;
    const promise = new Promise((resolve, reject) => {
      const { timeoutMs = 15000, ...fetchOptions } = options;
      job = { url, read, options: fetchOptions, controller: new AbortController(), resolve, reject, settled: false };
      job.externalAbort = () => cancel(job, abortError());
      fetchOptions.signal?.addEventListener('abort', job.externalAbort, { once: true });
      job.expiresAt = performance.now() + timeoutMs;
      job.timeout = () => {
        const error = new Error('Сервер не ответил вовремя. Проверьте соединение.');
        error.name = 'TimeoutError';
        cancel(job, error);
      };
      job.timer = setTimeout(job.timeout, timeoutMs);
      // Preserve mutation order, but do not bury saves behind background reads.
      if (read) queue.push(job);
      else {
        const firstRead = queue.findIndex(item => item.read);
        queue.splice(firstRead === -1 ? queue.length : firstRead, 0, job);
      }
      pump();
    });
    if (!key) return promise;
    const shared = promise.finally(() => {
      if (reads.get(key) === shared) reads.delete(key);
    });
    reads.set(key, shared);
    return shared.then(response => response.clone());
  }

  function cancelReads() {
    for (const job of [...active, ...queue]) if (job.read) cancel(job, abortError('Обновление приостановлено'));
  }

  // Await each task before scheduling the next one; failures back off to one minute.
  function poll(task, interval) {
    let generation = 0, running = false, timer = null, failures = 0;
    async function run(current) {
      timer = null;
      let success = false;
      try { success = await task() !== false; } catch (_) {}
      if (!running || current !== generation) return;
      failures = success ? 0 : Math.min(failures + 1, 6);
      timer = setTimeout(() => run(current), Math.min(60000, interval * 2 ** failures));
    }
    return {
      start() {
        if (running) return;
        running = true;
        failures = 0;
        const current = ++generation;
        timer = setTimeout(() => run(current), 0);
      },
      stop() {
        running = false;
        generation++;
        clearTimeout(timer);
        timer = null;
      }
    };
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelReads(); });
  window.addEventListener('offline', cancelReads);
  window.addEventListener('pagehide', () => {
    suspended = true;
    for (const job of [...active, ...queue]) cancel(job, abortError());
  });
  window.addEventListener('pageshow', () => { suspended = false; });
  window.gameNetwork = { fetch: request, poll, cancelReads,
    stats: () => ({ active: active.size, queued: queue.length, reads: reads.size }) };
})();
