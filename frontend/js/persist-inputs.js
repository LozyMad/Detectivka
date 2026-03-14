/**
 * Сохранение текста полей ввода в localStorage и восстановление при перезагрузке страницы.
 * Не сохраняет пароли (type="password") и поля с атрибутом data-no-persist.
 */
(function () {
    const PREFIX = 'persist_';
    const DEBOUNCE_MS = 400;

    function pageKey() {
        const path = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
        return (path || '/').replace(/\//g, '_') || '_index';
    }

    function storageKey(el, index) {
        const id = el.id || el.name || ('field' + index);
        return PREFIX + pageKey() + '_' + id;
    }

    function persistValue(key, value) {
        try {
            if (value == null || value === '') {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, String(value));
            }
        } catch (e) {
            console.warn('persist-inputs: localStorage error', e);
        }
    }

    function restoreValue(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function setup() {
        const page = pageKey();
        const selector = 'input[type="text"], input[type="number"], input[type="email"], textarea';
        const inputs = document.querySelectorAll(selector);
        let debounceTimers = {};

        inputs.forEach(function (el, index) {
            if (el.type === 'password' || el.getAttribute('data-no-persist') !== null) return;
            if (el.closest('[data-no-persist]')) return;

            const key = storageKey(el, index);
            const saved = restoreValue(key);
            if (saved !== null) {
                el.value = saved;
            }

            function save() {
                const k = key;
                if (debounceTimers[k]) clearTimeout(debounceTimers[k]);
                debounceTimers[k] = setTimeout(function () {
                    persistValue(k, el.value);
                    debounceTimers[k] = null;
                }, DEBOUNCE_MS);
            }

            el.addEventListener('input', save);
            el.addEventListener('change', save);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }
})();
