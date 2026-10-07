// A room keeps its identity in this tab; admin logins use their existing storage.
(() => {
    const key = 'detectum-player-session-v1';
    const authKeys = ['token', 'roomUser', 'room', 'room_id', 'user'];
    const read = (store, name) => {
        try { return JSON.parse(store.getItem(name) || 'null'); } catch (_) { return null; }
    };
    const snapshot = store => Object.fromEntries(authKeys.map(name => [name, store.getItem(name)]));
    const legacyRoom = read(sessionStorage, 'room');
    const requestedTestRoom = new URLSearchParams(window.location.search).get('test-room');
    const isTest = window.location.pathname === '/game' && sessionStorage.getItem('testRoomSession') === '1' &&
        legacyRoom?.is_test === true && String(legacyRoom.id) === requestedTestRoom;
    let record = read(sessionStorage, key) || read(localStorage, key);
    if (!record) {
        record = snapshot(localStorage);
        if (!record.roomUser && !read(localStorage, 'user')?.id) record = {};
        if (record.roomUser) localStorage.setItem(key, JSON.stringify(record));
    }
    sessionStorage.setItem(key, JSON.stringify(record));
    let expired = false;

    function persist(previousToken) {
        sessionStorage.setItem(key, JSON.stringify(record));
        const saved = read(localStorage, key);
        if (saved?.token === previousToken && saved?.roomUser === record.roomUser) {
            localStorage.setItem(key, JSON.stringify(record));
        }
    }
    function clearLegacy(token) {
        if (localStorage.getItem('token') === token && localStorage.getItem('roomUser') && !read(localStorage, 'user')?.is_admin) {
            authKeys.forEach(name => localStorage.removeItem(name));
        }
    }
    const storage = isTest ? sessionStorage : {
        getItem(name) { return authKeys.includes(name) ? record[name] ?? null : localStorage.getItem(name); },
        setItem(name, value) {
            if (!authKeys.includes(name)) return localStorage.setItem(name, value);
            const previous = record.token;
            record[name] = String(value);
            persist(previous);
        },
        removeItem(name) {
            if (!authKeys.includes(name)) return localStorage.removeItem(name);
            const previous = record.token;
            delete record[name];
            persist(previous);
        }
    };
    function routeKey() {
        const player = read(storage, 'roomUser');
        return player?.id && player?.room_id ? `detectum-route-${player.room_id}-${player.id}` : null;
    }
    const session = {
        storage, isTest, testRequested: !!requestedTestRoom,
        get expired() { return expired; },
        saveLogin(data) {
            const previous = localStorage.getItem('token');
            record = { token: data.token, roomUser: JSON.stringify({ ...data.user, room_id: data.room.id }),
                room: JSON.stringify(data.room), room_id: String(data.room.id) };
            sessionStorage.setItem(key, JSON.stringify(record));
            localStorage.setItem(key, JSON.stringify(record));
            clearLegacy(previous);
            sessionStorage.removeItem('testRoomSession');
            expired = false;
        },
        hasExpiredToken() {
            try {
                const part = storage.getItem('token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                const payload = JSON.parse(atob(part));
                return Number.isFinite(payload.exp) && payload.exp * 1000 <= Date.now();
            } catch (_) { return false; } // The server validates the signature and malformed tokens.
        },
        saveRoute(route) { const name = routeKey(); if (name) sessionStorage.setItem(name, JSON.stringify(route)); },
        restoreRoute() { const name = routeKey(); return name ? read(sessionStorage, name) : null; },
        clearRoute() { const name = routeKey(); if (name) sessionStorage.removeItem(name); },
        invalidate() {
            if (expired) return;
            expired = true;
            const token = storage.getItem('token');
            storage.removeItem('token');
            if (!isTest) clearLegacy(token);
            session.onExpired?.();
        },
        clear() {
            const token = storage.getItem('token');
            if (isTest) {
                authKeys.forEach(name => sessionStorage.removeItem(name));
                sessionStorage.removeItem('testRoomSession');
            } else {
                const saved = read(localStorage, key);
                if (saved?.token === token && saved?.roomUser === record.roomUser) localStorage.removeItem(key);
                clearLegacy(token);
                record = {};
                sessionStorage.removeItem(key);
            }
        },
        async checkResponse(response, options) {
            if (response.status !== 401 && response.status !== 403) return;
            const token = storage.getItem('token');
            if (!token || new Headers(options.headers).get('Authorization') !== `Bearer ${token}`) return;
            const data = await response.clone().json().catch(() => ({}));
            const authError = response.status === 401 || String(data.code || '').startsWith('AUTH_') ||
                ['Invalid token', 'Invalid token payload', 'User not found', 'Access token required'].includes(data.error);
            if (authError && storage.getItem('token') === token) session.invalidate();
        }
    };
    window.gameSession = session;
})();
