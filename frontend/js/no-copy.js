// Player-facing pages only. Keep editable fields usable while blocking clipboard copies.
(function () {
    function protectDocument(doc) {
        if (!doc || doc.documentElement.dataset.noCopy === '1') return;
        doc.documentElement.dataset.noCopy = '1';

        const style = doc.createElement('style');
        style.textContent = `
            *, *::before, *::after {
                -webkit-user-select: none !important;
                user-select: none !important;
            }
            input, textarea, [contenteditable="true"], [contenteditable="true"] * {
                -webkit-user-select: text !important;
                user-select: text !important;
            }
        `;
        doc.head.appendChild(style);

        const block = (event) => event.preventDefault();
        doc.addEventListener('copy', block, true);
        doc.addEventListener('cut', block, true);
        doc.addEventListener('dragstart', block, true);
        doc.addEventListener('selectstart', (event) => {
            if (!event.target.closest?.('input, textarea, [contenteditable="true"]')) block(event);
        }, true);
        doc.addEventListener('contextmenu', (event) => {
            if (!event.target.closest?.('input, textarea, [contenteditable="true"]')) block(event);
        }, true);
        doc.addEventListener('keydown', (event) => {
            const key = event.key.toLowerCase();
            if (((event.ctrlKey || event.metaKey) && (key === 'c' || key === 'x')) ||
                (event.ctrlKey && key === 'insert')) block(event);
        }, true);
    }

    window.protectPageFromCopy = protectDocument;
    protectDocument(document);
})();
