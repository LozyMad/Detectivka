(function () {
    const storageKey = 'detectum-theme';
    const root = document.documentElement;

    try {
        root.classList.toggle('theme-dark', localStorage.getItem(storageKey) === 'dark');
    } catch (_) {
        // The switch still works for this page if browser storage is unavailable.
    }

    function updateButtons() {
        const isDark = root.classList.contains('theme-dark');
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            const label = isDark ? 'Светлая тема' : 'Тёмная тема';
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            const icon = button.querySelector('[data-theme-icon]');
            const text = button.querySelector('[data-theme-label]');
            if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
            if (text) text.textContent = label;
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateButtons();
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.addEventListener('click', () => {
                const isDark = root.classList.toggle('theme-dark');
                try {
                    localStorage.setItem(storageKey, isDark ? 'dark' : 'light');
                } catch (_) {
                    // Keep the current page in the chosen theme.
                }
                updateButtons();
            });
        });
    });

    window.addEventListener('storage', (event) => {
        if (event.key !== storageKey) return;
        root.classList.toggle('theme-dark', event.newValue === 'dark');
        updateButtons();
    });
})();
