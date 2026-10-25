// Render documents locally: Android/iOS do not consistently support PDF iframes.
(() => {
    let library, generation = 0, loading, drawing, resize, resizeTimer, loadAttempt = 0;
    const ignore = promise => promise?.catch?.(() => {});
    function deadline(promise) {
        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Не удалось загрузить просмотр документа. Повторите после восстановления связи.')), 20000); });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }
    function close() {
        generation++;
        drawing?.cancel();
        drawing = null;
        ignore(loading?.destroy());
        loading = null;
        resize?.disconnect();
        resize = null;
        clearTimeout(resizeTimer);
    }
    function getLibrary() {
        library ||= deadline(import('/vendor/pdfjs/pdf.mjs?v=6.4.299&attempt=' + (++loadAttempt))).catch(error => { library = null; throw error; });
        return library;
    }
    // Independent render tasks let board thumbnails coexist with the full viewer.
    async function thumbnail(blob, signal) {
        let task, render;
        const abort = () => { render?.cancel(); ignore(task?.destroy()); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const pdfjs = await getLibrary();
            signal?.throwIfAborted();
            pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
            task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()),
                cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
                wasmUrl: '/vendor/pdfjs/wasm/', isEvalSupported: false, enableXfa: false });
            signal?.throwIfAborted();
            const pdf = await deadline(task.promise);
            const page = await pdf.getPage(1);
            signal?.throwIfAborted();
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(800 / base.width, 1200 / base.height) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            render = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
            await deadline(render.promise);
            signal?.throwIfAborted();
            return await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Не удалось создать превью')), 'image/png'));
        } finally {
            signal?.removeEventListener('abort', abort);
            await task?.destroy().catch(() => {});
        }
    }
    async function open(blob, host) {
        close();
        const current = generation;
        host.textContent = 'Готовим документ…';
        const pdfjs = await getLibrary();
        if (current !== generation) return;
        pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
        const data = new Uint8Array(await blob.arrayBuffer());
        if (current !== generation) return;
        loading = pdfjs.getDocument({ data, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
            standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/',
            isEvalSupported: false, enableXfa: false });
        const pdf = await deadline(loading.promise);
        if (current !== generation) return;
        const viewer = document.createElement('section'); viewer.className = 'game-pdf';
        const toolbar = document.createElement('div'); toolbar.className = 'game-pdf-toolbar';
        const label = document.createElement('span'); label.setAttribute('aria-live', 'polite');
        const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img');
        const paper = document.createElement('div'); paper.className = 'game-pdf-paper'; paper.append(canvas);
        const status = document.createElement('p'); status.className = 'game-pdf-status'; status.setAttribute('role', 'status');
        const button = (text, name) => { const item = document.createElement('button'); item.type = 'button';
            item.textContent = text; item.setAttribute('aria-label', name); return item; };
        const previous = button('←', 'Предыдущая страница'), next = button('→', 'Следующая страница');
        const zoom = button('Увеличить', 'Увеличить страницу');
        toolbar.append(previous, label, next, zoom); viewer.append(toolbar, status, paper); host.replaceChildren(viewer);
        let pageNumber = 1, enlarged = false, revision = 0, lastWidth = host.clientWidth;
        async function render() {
            const turn = ++revision;
            const before = drawing; before?.cancel();
            if (before) await before.promise.catch(() => {});
            if (current !== generation || turn !== revision) return;
            previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= pdf.numPages;
            label.textContent = `${pageNumber} / ${pdf.numPages}`;
            canvas.setAttribute('aria-label', `Страница ${pageNumber} из ${pdf.numPages}`);
            status.textContent = 'Загрузка страницы…';
            const page = await pdf.getPage(pageNumber);
            if (current !== generation || turn !== revision) return;
            lastWidth = host.clientWidth;
            const base = page.getViewport({ scale: 1 });
            const width = Math.max(240, Math.min(1400, lastWidth - 32)) * (enlarged ? 1.7 : 1);
            const viewport = page.getViewport({ scale: width / base.width });
            const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / viewport.width, 8192 / viewport.height);
            canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
            canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
            drawing = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport,
                transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
            await deadline(drawing.promise);
            if (current === generation && turn === revision) status.textContent = '';
        }
        const redraw = () => render().catch(error => {
            if (current === generation && error.name !== 'RenderingCancelledException') status.textContent = 'Не удалось показать страницу. Попробуйте ещё раз или скачайте PDF.';
        });
        previous.onclick = () => { if (pageNumber > 1) { pageNumber--; redraw(); } };
        next.onclick = () => { if (pageNumber < pdf.numPages) { pageNumber++; redraw(); } };
        zoom.onclick = () => { enlarged = !enlarged; zoom.textContent = enlarged ? 'Уместить' : 'Увеличить';
            zoom.setAttribute('aria-label', enlarged ? 'Уместить страницу' : 'Увеличить страницу'); redraw(); };
        resize = new ResizeObserver(() => {
            if (host.clientWidth === lastWidth) return;
            clearTimeout(resizeTimer); resizeTimer = setTimeout(redraw, 150);
        });
        resize.observe(host);
        try { await render(); } catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
    }
    window.gamePdfViewer = { open, close, thumbnail };
})();
