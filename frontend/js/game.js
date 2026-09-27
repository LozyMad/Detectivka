const gameStorage = sessionStorage.getItem('testRoomSession') === '1' ? sessionStorage : localStorage;
const API_BASE = '/api';
let selectedDistrict = null;
let roomState = null;
let roomTimerInterval = null;
let tripCount = 0;
let tripHistory = [];
let receivedApplications = new Map();
let receivedApplicationAddresses = new Map();
const collapsedTripKeys = new Set();
let freshTripTimer = null;
let cachedScenarioName = null; // Кэш для имени сценария
let lastScenarioCheck = 0; // Время последней проверки сценария
let roomEventSource = null;
let currentCafeAddressId = null;
let currentCafePage = null;
let cafeViewMode = 'home'; // 'home' | 'page' | 'error'
let applicationObjectUrl = null;
let applicationRequestId = 0;

function setScenarioTitle(text) {
    const el = document.getElementById('scenarioTitle');
    if (el) el.textContent = text;
    const caseTitle = document.getElementById('caseTitle');
    if (caseTitle) caseTitle.textContent = text && !/^(ошибка|нет |сценарий не)/i.test(text)
        ? text : 'Дело расследуется';
}

function setScenarioBanner(scenarioId) {
    const image = document.getElementById('caseBannerImage');
    if (!image || !scenarioId) return;
    if (image.dataset.scenarioId === String(scenarioId)) return;
    image.dataset.scenarioId = String(scenarioId);
    image.hidden = true;
    image.onload = () => { image.hidden = false; };
    image.onerror = () => { image.hidden = true; };
    image.src = `${API_BASE}/scenarios/${encodeURIComponent(scenarioId)}/banner`;
}

function setupMobileGameLayout() {
    const toolbar = document.getElementById('playerMobileToolbar');
    const collapse = document.getElementById('navbarCollapse');
    const tabs = document.getElementById('playerNavTabs');
    const stats = document.getElementById('playerNavStats');
    const sidebar = document.querySelector('.dossier-sidebar');
    if (!toolbar || !collapse || !tabs || !stats || !sidebar) return;

    const tabHome = tabs.parentElement;
    const statHome = stats.parentElement;
    const sidebarHome = sidebar.parentElement;
    const toolbarHome = toolbar.parentElement;
    const toolbarNext = toolbar.nextSibling;
    const mobile = window.matchMedia('(max-width: 767.98px)');
    const arrange = () => {
        if (mobile.matches) {
            toolbar.append(tabs, stats);
            const activePane = document.querySelector('#gameTabContent .tab-pane.active') || document.getElementById('game');
            placeMobileToolbar(activePane);
            collapse.append(sidebar);
        } else {
            tabHome.insertBefore(tabs, statHome);
            statHome.prepend(stats);
            sidebarHome.append(sidebar);
            toolbarHome.insertBefore(toolbar, toolbarNext);
        }
    };
    arrange();
    if (mobile.addEventListener) mobile.addEventListener('change', arrange);
    else mobile.addListener(arrange);
}

function placeMobileToolbar(pane) {
    const toolbar = document.getElementById('playerMobileToolbar');
    if (!toolbar || !pane || !window.matchMedia('(max-width: 767.98px)').matches) return;
    if (pane.id === 'game') pane.querySelector('.case-banner')?.after(toolbar);
    else pane.prepend(toolbar);
}

function tripCollapseStorageKey() {
    try {
        const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
        if (roomUser?.id && roomUser?.room_id) return `detectum-collapsed-trips-room-${roomUser.room_id}-player-${roomUser.id}`;
        const user = JSON.parse(gameStorage.getItem('user') || 'null');
        return user?.id ? `detectum-collapsed-trips-user-${user.id}` : null;
    } catch (_) {
        return null;
    }
}

function restoreCollapsedTrips() {
    const key = tripCollapseStorageKey();
    if (!key) return;
    try {
        const saved = JSON.parse(gameStorage.getItem(key) || '[]');
        if (Array.isArray(saved)) saved.filter(value => typeof value === 'string').forEach(value => collapsedTripKeys.add(value));
    } catch (_) {}
}

function saveCollapsedTrips() {
    const key = tripCollapseStorageKey();
    if (!key) return;
    try { gameStorage.setItem(key, JSON.stringify([...collapsedTripKeys])); } catch (_) {}
}

function getPlayerNotesKey() {
    const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
    if (roomUser?.id && roomUser?.room_id) {
        const room = JSON.parse(gameStorage.getItem('room') || 'null');
        if (room?.is_test) return `detectum-notes-room-${roomUser.room_id}-scenario-${room.scenario_id}-player-${roomUser.id}`;
        return `detectum-notes-room-${roomUser.room_id}-player-${roomUser.id}`;
    }
    const user = JSON.parse(gameStorage.getItem('user') || 'null');
    return user?.id ? `detectum-notes-user-${user.id}` : null;
}

function setupPlayerNotes() {
    const field = document.getElementById('playerNotesText');
    const status = document.getElementById('playerNotesStatus');
    const key = getPlayerNotesKey();
    if (!field || !key) return;
    try { field.value = gameStorage.getItem(key) || ''; } catch (_) {}
    field.addEventListener('input', () => {
        try {
            gameStorage.setItem(key, field.value);
            if (status) status.textContent = 'Заметки сохранены';
        } catch (_) {
            if (status) status.textContent = 'Не удалось сохранить заметки';
        }
    });
}

function connectRoomSSE(roomId, token) {
    if (roomEventSource) {
        roomEventSource.close();
        roomEventSource = null;
    }
    const url = `${API_BASE}/game/room/${roomId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    roomEventSource = es;
    es.onmessage = (e) => {
        try {
            const d = JSON.parse(e.data || '{}');
            if (d.type === 'new_trip') {
                loadTripCount();
                loadTripHistory();
            }
        } catch (_) {}
    };
    es.onerror = () => {
        es.close();
        roomEventSource = null;
        setTimeout(() => {
            const ru = JSON.parse(gameStorage.getItem('roomUser') || 'null');
            const t = gameStorage.getItem('token');
            if (ru && ru.room_id && t) connectRoomSSE(ru.room_id, t);
        }, 5000);
    };
}

// Initialize game
document.addEventListener('DOMContentLoaded', () => {
    setupMobileGameLayout();
    checkAuth();
    restoreCollapsedTrips();
    // Start the banner request while room state and trip history are loading.
    try {
        const room = JSON.parse(gameStorage.getItem('room') || 'null');
        setScenarioBanner(room?.scenario_id);
    } catch (_) {}
    setupDistrictSelect();
    loadTripCount();
    loadTripHistory();
    loadScenarioInfo();
    setupPlayerNotes();
    document.getElementById('tripSearch')?.addEventListener('input', updateTripHistory);
    
    const collapseEl = document.getElementById('navbarCollapse');
    const iconEl = document.getElementById('navbarToggleIcon');
    const menuButton = document.querySelector('[data-bs-target="#navbarCollapse"]');
    if (collapseEl && iconEl) {
        collapseEl.addEventListener('show.bs.collapse', () => {
            iconEl.classList.remove('fa-chevron-down'); iconEl.classList.add('fa-chevron-up');
            menuButton?.setAttribute('aria-label', 'Закрыть приложения и заметки');
        });
        collapseEl.addEventListener('hide.bs.collapse', () => {
            iconEl.classList.remove('fa-chevron-up'); iconEl.classList.add('fa-chevron-down');
            menuButton?.setAttribute('aria-label', 'Открыть приложения и заметки');
        });
    }
    
    // Setup tab switching
    setupTabSwitching();
    
    // Update every 30 seconds
    setInterval(() => {
        if (gameStorage.getItem('roomUser')) {
            refreshRoomState();
        }
    }, 30000);
    
    // SSE: мгновенное обновление истории при поездке с другого устройства
    const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
    const token = gameStorage.getItem('token');
    if (roomUser && roomUser.room_id && token) {
        connectRoomSSE(roomUser.room_id, token);
    }
    // Резервный опрос раз в 60 сек на случай обрыва SSE
    setInterval(() => {
        loadTripCount();
        loadTripHistory();
    }, 60000);
    
    // Принудительно обновляем имя сценария каждые 10 минут (на случай изменений админом)
    setInterval(() => {
        if (gameStorage.getItem('roomUser')) {
            lastScenarioCheck = 0; // Сбрасываем кэш для принудительного обновления
        }
    }, 10 * 60 * 1000); // 10 минут
});

function checkAuth() {
    const token = gameStorage.getItem('token');
    const user = JSON.parse(gameStorage.getItem('user') || '{}');
    const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
    
    console.log('Auth check:', { token: !!token, user, roomUser });
    
    if (!token || (!user.id && !roomUser?.id)) {
        console.log('Auth failed, redirecting to home');
        window.location.href = '/';
        return;
    }
    
    document.getElementById('usernameDisplay').textContent = (roomUser ? roomUser.username : user.username);
    if (roomUser) {
        initRoomTimer();
    }
}

function setupDistrictSelect() {
    const sel = document.getElementById('districtSelect');
    if (!sel) return;
    sel.addEventListener('change', () => {
        selectedDistrict = sel.value || null;
    });
}

async function visitLocation() {
    if (roomState?.state === 'paused') {
        showRoomPausedPopup();
        return;
    }
    if (roomState && roomState.state !== 'running') {
        alert('Игра еще не началась или уже завершилась');
        return;
    }
    selectedDistrict = (document.getElementById('districtSelect') && document.getElementById('districtSelect').value) || null;
    if (!selectedDistrict) {
        alert('Пожалуйста, выберите район');
        return;
    }
    
    const houseNumber = document.getElementById('houseNumber').value.trim();
    if (!houseNumber) {
        alert('Пожалуйста, введите номер дома');
        return;
    }
    const apartmentNumber = (document.getElementById('apartmentNumber') && document.getElementById('apartmentNumber').value) ? document.getElementById('apartmentNumber').value.trim() : '';
    
    // Проверяем, не была ли уже совершена поездка в эту локацию
    const existingTrip = tripHistory.find(trip => 
        trip.district === selectedDistrict && 
        trip.houseNumber === houseNumber &&
        (trip.apartment || '') === apartmentNumber
    );
    
    if (existingTrip) {
        alert('Вы уже посещали эту локацию! Проверьте записи о поездках.');
        return;
    }
    
    const resultDiv = document.getElementById('result');
    const resultText = document.getElementById('resultText');
    
    try {
        const token = gameStorage.getItem('token');
        const response = await fetch(`${API_BASE}/game/visit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                district: selectedDistrict,
                house_number: houseNumber,
                apartment: apartmentNumber
            })
        });
        
        const data = await response.json();

        if (response.status === 403 && data.error === 'Game is paused') {
            await refreshRoomState();
            renderTimer();
            if (roomState?.state !== 'paused') showRoomPausedPopup();
            return;
        }
        
        // Увеличиваем счетчик поездок независимо от результата
        tripCount++;
        updateTripCounter();
        
        if (response.ok) {
            const trip = {
                id: data.attempt_id || null,
                district: selectedDistrict,
                houseNumber: houseNumber,
                apartment: (data.location && data.location.apartment) ? data.location.apartment : apartmentNumber,
                success: data.success,
                description: data.description || null,
                timestamp: new Date().toISOString(),
                alreadyVisited: false,
                address_id: data.address_id || null,
                visited_location_id: data.visited_location_id || null,
                is_internet_cafe: !!data.is_internet_cafe,
                locationNames: Array.isArray(data.location_names) ? data.location_names : []
            };
            tripHistory.unshift(trip);
            updateTripHistory();
            refreshAvailableApplications();
            
            document.getElementById('houseNumber').value = '';
            if (document.getElementById('apartmentNumber')) document.getElementById('apartmentNumber').value = '';
            
            // Интернет-кафе открывается только по ссылке в истории поездок.
            // Проверяем интерактивные выборы для остальных адресов.
            if (data.success && data.address_id && !data.is_internet_cafe) {
                console.log('Visit successful, checking for choices:', data);
                checkForInteractiveChoices(data.address_id, data.description, data.visited_location_id);
            }
            
        } else {
            const trip = {
                id: data.attempt_id || null,
                district: selectedDistrict,
                houseNumber: houseNumber,
                apartment: apartmentNumber,
                success: false,
                description: data.error || 'Произошла ошибка',
                timestamp: new Date().toISOString(),
                alreadyVisited: false,
                locationNames: Array.isArray(data.location_names) ? data.location_names : []
            };
            tripHistory.unshift(trip);
            updateTripHistory();
            document.getElementById('houseNumber').value = '';
            if (document.getElementById('apartmentNumber')) document.getElementById('apartmentNumber').value = '';
        }
    } catch (error) {
        console.error('Error visiting location:', error);
        tripCount++;
        updateTripCounter();
        const trip = {
            district: selectedDistrict,
            houseNumber: houseNumber,
            apartment: apartmentNumber,
            success: false,
            description: 'Ошибка соединения',
            timestamp: new Date().toISOString(),
            alreadyVisited: false
        };
        tripHistory.unshift(trip);
        updateTripHistory();
        document.getElementById('houseNumber').value = '';
        if (document.getElementById('apartmentNumber')) document.getElementById('apartmentNumber').value = '';
    }
}

function showRoomPausedPopup() {
    const modal = document.getElementById('roomPausedModal');
    if (modal && window.bootstrap?.Modal) {
        bootstrap.Modal.getOrCreateInstance(modal).show();
    } else {
        alert('Игра на паузе. Новые поездки пока недоступны.');
    }
}

// Загрузка счетчика поездок
async function loadTripCount() {
    try {
        const token = gameStorage.getItem('token');
        const response = await fetch(`${API_BASE}/game/attempts`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load attempts');
        }
        
        const data = await response.json();
        const attempts = data.attempts || [];
        tripCount = attempts.length;
        updateTripCounter();
        
    } catch (error) {
        console.error('Error loading trip count:', error);
        tripCount = 0;
        updateTripCounter();
    }
}

// Обновление счетчика поездок
function updateTripCounter() {
    const counter = document.getElementById('tripCounter');
    if (counter) {
        counter.textContent = `Поездок: ${tripCount}`;
    }
}

// Загрузка истории поездок
async function loadTripHistory() {
    try {
        const token = gameStorage.getItem('token');
        const response = await fetch(`${API_BASE}/game/attempts`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load attempts');
        }

        const data = await response.json();
        const attempts = data.attempts || [];
        
        // Преобразуем попытки в формат истории поездок
        tripHistory = await Promise.all(attempts.map(async (attempt) => {
            let description = attempt.found ? (attempt.address_description || 'Локация найдена') : 'По этому адресу нет информации';
            
            // Если это успешная поездка с address_id, проверяем, есть ли сделанные выборы
            if (attempt.found && attempt.address_id && attempt.visited_location_id) {
                try {
                    const roomUser = JSON.parse(gameStorage.getItem('roomUser'));
                    const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
                    
                    if (roomUser && roomUser.id && scenarioId) {
                        const choiceResponse = await fetch(`${API_BASE}/choices/game/players/${roomUser.id}/scenarios/${scenarioId}/addresses/${attempt.address_id}/choice`, {
                            headers: {
                                'Authorization': `Bearer ${gameStorage.getItem('token')}`
                            }
                        });
                        
                        if (choiceResponse.ok) {
                            const choiceData = await choiceResponse.json();
                            if (choiceData.choice && choiceData.choice.response_text) {
                                description = choiceData.choice.response_text;
                            }
                        }
                    }
                } catch (error) {
                    console.log('Could not load choice for address:', attempt.address_id, error);
                }
            }
            
            return {
                id: attempt.id,
                district: attempt.district,
                houseNumber: attempt.house_number,
                apartment: attempt.apartment || '',
                success: attempt.found,
                description: description,
                timestamp: attempt.attempted_at,
                alreadyVisited: false,
                address_id: attempt.address_id || null,
                visited_location_id: attempt.visited_location_id || null,
                hasChoices: !!attempt.has_choices,
                is_internet_cafe: !!attempt.is_internet_cafe,
                locationNames: Array.isArray(attempt.location_names) ? attempt.location_names : []
            };
        }));
        
        updateTripHistory();
        await refreshAvailableApplications();
        
    } catch (error) {
        console.error('Error loading trip history:', error);
        tripHistory = [];
        updateTripHistory();
    }
}

function formatTripAddressLabel(trip) {
    const address = `Дом ${trip.houseNumber}${trip.apartment ? ', кв. ' + trip.apartment : ''}`;
    const names = Array.isArray(trip.locationNames) ? trip.locationNames.filter(Boolean) : [];
    if (names.length === 0) return address;
    return `${address} — ${names.join(' / ')}`;
}

function tripKey(trip) {
    return trip.id ? `attempt-${trip.id}` : `${trip.district}|${trip.houseNumber}|${trip.apartment}|${trip.timestamp}`;
}

function tripTimestampMs(timestamp) {
    if (!timestamp) return NaN;
    const normalized = typeof timestamp === 'string' && !/Z|[+-]\d{2}:?\d{2}$/.test(timestamp.trim())
        ? timestamp.trim().replace(' ', 'T') + 'Z' : timestamp;
    return new Date(normalized).getTime();
}

async function refreshAvailableApplications() {
    const token = gameStorage.getItem('token');
    if (!token) return;
    try {
        const response = await fetch(`${API_BASE}/applications/game/available`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Не удалось загрузить приложения');
        const data = await response.json();
        receivedApplications = new Map((data.addresses || []).map(item => [Number(item.address_id), item.applications || []]));
        receivedApplicationAddresses = new Map((data.addresses || []).map(item => [Number(item.address_id), item]));
        updateTripHistory();
    } catch (error) {
        console.error('Error loading available applications:', error);
    }
}

function updateReceivedApplications() {
    const target = document.getElementById('receivedApplicationsList');
    if (!target) return;
    const items = [];
    for (const [addressId, applications] of receivedApplications) {
        const address = receivedApplicationAddresses.get(addressId) || {};
        const label = `${address.district || ''} · Дом ${address.house_number || ''}${address.apartment ? ', кв. ' + address.apartment : ''}`;
        for (const app of applications) {
            items.push({ ...app, addressId, address: label });
        }
    }
    items.sort((a, b) => a.number - b.number);
    if (!items.length) {
        target.textContent = 'Пока нет приложений';
        return;
    }
    target.innerHTML = items.map(app => `<button type="button" class="received-application scenario-application-link" data-address-id="${app.addressId}" data-number="${app.number}">
        <i class="far fa-folder-open" aria-hidden="true"></i> Приложение ${app.number}
        <small>${escapeHtmlPlayer(app.address)} · ${app.file_count} файл(ов)</small>
    </button>`).join('');
}

// Обновление отображения истории поездок
function updateTripHistory() {
    const container = document.getElementById('tripHistory');
    if (!container) return;
    updateReceivedApplications();
    const query = (document.getElementById('tripSearch')?.value || '').trim().toLocaleLowerCase('ru-RU');
    const matchingTrips = query ? tripHistory.filter(trip =>
        [trip.district, formatTripAddressLabel(trip), trip.description, trip.success ? 'найдено' : 'не найдено']
            .join(' ').toLocaleLowerCase('ru-RU').includes(query)) : tripHistory;
    
    if (tripHistory.length === 0) {
        container.innerHTML = '<p class="trip-empty">История поездок пуста</p>';
        return;
    }
    if (matchingTrips.length === 0) {
        container.innerHTML = '<p class="trip-empty">По вашему запросу поездок не найдено</p>';
        return;
    }

    let nextFreshExpiry = Infinity;
    const items = matchingTrips.map(trip => {
        const key = tripKey(trip);
        const apps = trip.success && trip.address_id ? (receivedApplications.get(Number(trip.address_id)) || []) : [];
        const collapsed = collapsedTripKeys.has(key);
        const elapsed = Date.now() - tripTimestampMs(trip.timestamp);
        const isFresh = trip.success && elapsed >= 0 && elapsed < 9000;
        if (isFresh) nextFreshExpiry = Math.min(nextFreshExpiry, 9000 - elapsed);
        return `
        <article class="trip-item ${trip.success ? 'success' : 'failure'} ${collapsed ? 'is-collapsed' : ''} ${isFresh ? 'is-fresh' : ''}" ${isFresh ? `style="animation-delay:-${Math.max(0, elapsed)}ms"` : ''}>
            <i class="far fa-building trip-icon" aria-hidden="true"></i>
            <div class="trip-body"><div class="trip-info">
                <span class="trip-address">${escapeHtmlPlayer(trip.district)} · ${escapeHtmlPlayer(formatTripAddressLabel(trip))}</span>
                <span class="trip-time">${escapeHtmlPlayer(formatTripTime(trip.timestamp))}</span>
                <span class="trip-status">${trip.success ? 'Найдено' : 'Не найдено'}</span>
                ${apps.map(app => `<button type="button" class="trip-app-badge scenario-application-link" data-address-id="${Number(trip.address_id)}" data-number="${app.number}" title="Открыть приложение ${app.number}"><i class="far fa-folder-open" aria-hidden="true"></i> №${app.number}</button>`).join('')}
                ${trip.success && trip.address_id && trip.hasChoices ? 
                    `<button type="button" class="btn btn-sm btn-outline-warning ms-2 trip-choice-btn" title="Развилка по выборам"
                        data-address-id="${trip.address_id}"
                        data-description="${encodeURIComponent(trip.description || '')}"
                        data-visited-location-id="${trip.visited_location_id || ''}">
                        <i class="fas fa-code-branch"></i>
                    </button>` : ''
                }
            </div>
            <div class="trip-description">${trip.success
                ? `<div class="trip-description-text">${renderScenarioText(trip.description || '', trip.address_id)}</div>`
                : `<strong>По этому адресу нет информации</strong>`
            }${apps.length
                ? `<div class="trip-application-links">${apps.map(app =>
                    `<button type="button" class="trip-application-button scenario-application-link" data-address-id="${Number(trip.address_id)}" data-number="${app.number}"><i class="far fa-folder-open" aria-hidden="true"></i> Приложение ${app.number}</button>`
                ).join('')}</div>`
                : ''
            }${trip.success && trip.is_internet_cafe && trip.address_id
                ? `<div><a href="#" class="trip-cafe-link" data-cafe-address-id="${trip.address_id}">Сесть за компьютер</a></div>`
                : ''
            }</div></div>
            <button type="button" class="trip-toggle" data-trip-key="${escapeHtmlPlayer(key)}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Развернуть' : 'Свернуть'} поездку: ${escapeHtmlPlayer(formatTripAddressLabel(trip))}"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>
        </article>
    `; }).join('');

    container.innerHTML = items;
    container.querySelectorAll('.trip-toggle').forEach(button => {
        button.addEventListener('click', () => {
            const key = button.dataset.tripKey;
            if (collapsedTripKeys.has(key)) collapsedTripKeys.delete(key);
            else collapsedTripKeys.add(key);
            saveCollapsedTrips();
            updateTripHistory();
        });
    });
    if (freshTripTimer) clearTimeout(freshTripTimer);
    if (nextFreshExpiry !== Infinity) freshTripTimer = setTimeout(updateTripHistory, Math.max(100, nextFreshExpiry + 20));
    container.querySelectorAll('.trip-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.addressId, 10);
            const desc = btn.dataset.description ? decodeURIComponent(btn.dataset.description) : '';
            const vid = btn.dataset.visitedLocationId ? parseInt(btn.dataset.visitedLocationId, 10) : null;
            openChoiceHistory(id, desc, vid);
        });
    });
    container.querySelectorAll('.trip-cafe-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const id = parseInt(link.dataset.cafeAddressId, 10);
            if (id) openInternetCafe(id);
        });
    });
}

// Время поездки — всегда дата и время совершения (без «X мин. назад»)
function formatTripTime(timestamp) {
    let ts = timestamp;
    if (typeof ts === 'string' && ts && !/Z|[+-]\d{2}:?\d{2}$/.test(ts.trim())) {
        ts = ts.trim().replace(' ', 'T') + 'Z';
    }
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
        return String(timestamp || '');
    }
    return date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Загрузка информации о сценарии
async function loadScenarioInfo() {
    try {
        const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
        const room = JSON.parse(gameStorage.getItem('room') || 'null');
        
        if (roomUser && roomUser.room_id) {
            // Для игроков комнаты получаем информацию о сценарии из комнаты
            const token = gameStorage.getItem('token');
            const response = await fetch(`${API_BASE}/room/${roomUser.room_id}/state`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Room state data:', data);
                
                // Проверяем различные возможные источники названия сценария
                let scenarioName = null;
                if (data.scenario_name) {
                    scenarioName = data.scenario_name;
                } else if (data.room && data.room.scenario_name) {
                    scenarioName = data.room.scenario_name;
                } else if (data.scenario && data.scenario.name) {
                    scenarioName = data.scenario.name;
                } else if (room && room.scenario_name) {
                    scenarioName = room.scenario_name;
                }
                
                console.log('Available scenario sources:', {
                    'data.scenario_name': data.scenario_name,
                    'data.room.scenario_name': data.room?.scenario_name,
                    'data.scenario.name': data.scenario?.name,
                    'room.scenario_name': room?.scenario_name
                });
                
                if (scenarioName) {
                    setScenarioTitle(scenarioName);
                    setScenarioBanner(data.room?.scenario_id || data.scenario_id || room?.scenario_id);
                    cachedScenarioName = scenarioName;
                    lastScenarioCheck = Date.now();
                    console.log('Scenario name loaded:', scenarioName);
                } else {
                    setScenarioTitle('Сценарий не определен');
                    console.log('No scenario name found in data:', data);
                }
            } else {
                setScenarioTitle('Ошибка загрузки комнаты');
                console.error('Failed to load room state:', response.status);
            }
        } else {
            // Для обычных пользователей получаем активный сценарий
            const response = await fetch(`${API_BASE}/scenarios/active`);
            
            if (response.ok) {
                const data = await response.json();
                setScenarioTitle(data.scenario.name);
                setScenarioBanner(data.scenario.id);
                cachedScenarioName = data.scenario.name;
                lastScenarioCheck = Date.now();
            } else {
                setScenarioTitle('Нет активного сценария');
            }
        }
    } catch (error) {
        console.error('Error loading scenario info:', error);
        setScenarioTitle('Ошибка загрузки');
    }
}

// ===== Room timer =====
async function initRoomTimer() {
    await refreshRoomState();
    renderTimer();
    if (roomTimerInterval) clearInterval(roomTimerInterval);
    roomTimerInterval = setInterval(async () => {
        await refreshRoomState();
        renderTimer();
    }, 1000);
}

async function refreshRoomState() {
    try {
        const room = JSON.parse(gameStorage.getItem('room') || 'null');
        if (!room) return;
        const token = gameStorage.getItem('token');
        const res = await fetch(`${API_BASE}/room/${room.id}/state`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!res.ok) return;
        const previousState = roomState?.state;
        roomState = await res.json();
        if (roomState.state === 'paused' && previousState !== 'paused') {
            showRoomPausedPopup();
        }
        if (roomState?.room?.is_test && String(roomState.room.scenario_id) !== String(room.scenario_id)) {
            gameStorage.setItem('room', JSON.stringify({ ...room, scenario_id: roomState.room.scenario_id }));
            window.location.reload();
            return;
        }
        
        // Проверяем имя сценария только если прошло больше 5 минут с последней проверки
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000; // 5 минут в миллисекундах
        
        if (roomState && (now - lastScenarioCheck > fiveMinutes || !cachedScenarioName)) {
            let scenarioName = null;
            if (roomState.scenario_name) {
                scenarioName = roomState.scenario_name;
            } else if (roomState.room && roomState.room.scenario_name) {
                scenarioName = roomState.room.scenario_name;
            }
            
            // Обновляем только если имя сценария изменилось
            if (scenarioName && scenarioName !== cachedScenarioName) {
                setScenarioTitle(scenarioName);
                cachedScenarioName = scenarioName;
                lastScenarioCheck = now;
                console.log('Scenario name updated from room state:', scenarioName);
            } else if (!cachedScenarioName && scenarioName) {
                // Первоначальная загрузка
                setScenarioTitle(scenarioName);
                cachedScenarioName = scenarioName;
                lastScenarioCheck = now;
                console.log('Scenario name initially loaded:', scenarioName);
            }
        }
    } catch (e) {
        // ignore
    }
}

function renderTimer() {
    const timerDisplay = document.getElementById('timerDisplay');
    const roomTimer = document.getElementById('roomTimer');
    
    if (!timerDisplay || !roomTimer) return;
    if (!roomState) return;
    
    const state = roomState.state;
    const remaining = roomState.remaining;

    if (roomState.room?.is_test) {
        timerDisplay.textContent = '∞ Без ограничений';
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-success text-dark fs-6';
        return;
    }
    
    if (state === 'pending') {
        timerDisplay.textContent = 'Ожидание';
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-secondary text-dark fs-6';
    } else if (state === 'running') {
        const minutes = Math.floor((remaining || 0) / 60);
        const seconds = (remaining || 0) % 60;
        timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-success text-dark fs-6';
    } else if (state === 'paused') {
        const minutes = Math.floor((remaining || 0) / 60);
        const seconds = (remaining || 0) % 60;
        timerDisplay.textContent = `Пауза ${minutes}:${seconds.toString().padStart(2, '0')}`;
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-warning text-dark fs-6';
    } else if (state === 'finished') {
        timerDisplay.textContent = 'Завершено';
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-danger text-dark fs-6';
    }
}


function logout() {
    gameStorage.removeItem('token');
    gameStorage.removeItem('user');
    gameStorage.removeItem('roomUser');
    gameStorage.removeItem('room');
    if (gameStorage === sessionStorage) {
        gameStorage.removeItem('testRoomSession');
        window.location.href = '/admin';
    } else {
        window.location.href = '/';
    }
}

// ===== Tab Switching =====
function setupTabSwitching() {
    const gameTab = document.getElementById('game-tab');
    const questionsTab = document.getElementById('questions-tab');
    const addressbookTab = document.getElementById('addressbook-tab');
    const gameContent = document.getElementById('game');
    const questionsContent = document.getElementById('questions');
    const addressbookContent = document.getElementById('addressbook');

    function showPane(pane) {
        [gameContent, questionsContent, addressbookContent].forEach(el => {
            if (!el) return;
            if (el === pane) {
                el.classList.add('show', 'active');
                el.classList.remove('fade');
            } else {
                el.classList.remove('show', 'active');
                el.classList.add('fade');
            }
        });
        [gameTab, questionsTab, addressbookTab].forEach((btn, i) => {
            if (!btn) return;
            const panes = [gameContent, questionsContent, addressbookContent];
            btn.classList.toggle('active', panes[i] === pane);
        });
        placeMobileToolbar(pane);
    }

    if (gameTab && questionsTab && gameContent && questionsContent) {
        gameTab.addEventListener('click', (e) => {
            e.preventDefault();
            showPane(gameContent);
        });

        questionsTab.addEventListener('click', (e) => {
            e.preventDefault();
            showPane(questionsContent);
            loadQuestions();
        });

        if (addressbookTab && addressbookContent) {
            addressbookTab.addEventListener('click', (e) => {
                e.preventDefault();
                showPane(addressbookContent);
                loadPlayerAddressBookSectionsAndEntries();
            });
        }
    }
}

// ===== Address Book (players, read-only) =====
let playerAddressBookSections = null;
let playerAddressBookSectionsLoaded = false;
let playerAddressBookFilter = { category: 'Частные лица', letter_group: 'А-Б', q: '' };

function escapeHtmlPlayer(s) {
    if (s == null || s === undefined) return '';
    const t = String(s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function displayApplicationFileName(file, index) {
    const base = String(file?.name || '').replace(/\.(?:png|jpe?g|webp|pdf)$/i, '').trim();
    return !base || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)
        ? `Материал ${index + 1}` : base;
}

function applicationLink(number, addressId, fallbackUrl = '') {
    return `<a href="#" class="scenario-application-link" data-address-id="${Number(addressId)}" data-number="${Number(number)}"${fallbackUrl ? ` data-fallback-url="${escapeHtmlPlayer(fallbackUrl)}"` : ''}>Приложение ${Number(number)}</a>`;
}

function renderScenarioText(text, addressId = null) {
    const source = String(text || '');
    const anchorPattern = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
    let result = '';
    let offset = 0;

    const renderPlainText = value => {
        if (!addressId) return escapeHtmlPlayer(value);
        return value.replace(/Приложение\s*№?\s*(\d+)/gi, (match, number, index) => {
            const before = value.slice(0, index).slice(-1);
            if (before && /[\p{L}\p{N}]/u.test(before)) return match;
            return `\u0000${number}\u0000`;
        }).split(/(\u0000\d+\u0000)/).map(part => /^\u0000\d+\u0000$/.test(part)
            ? applicationLink(part.slice(1, -1), addressId) : escapeHtmlPlayer(part)).join('');
    };

    for (const match of source.matchAll(anchorPattern)) {
        result += renderPlainText(source.slice(offset, match.index));
        const anchor = match[0];
        const openingTag = anchor.match(/^<a\b[^>]*>/i)?.[0] || '';
        const href = openingTag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
        const label = anchor.slice(openingTag.length).replace(/<\/a\s*>$/i, '').replace(/<[^>]*>/g, '').trim();
        const number = label.match(/^Приложение\s*№?\s*(\d+)$/i)?.[1];
        let url;
        try { if (href) url = new URL(href.replace(/&amp;/gi, '&')); } catch (_) {}

        result += number && addressId
            ? applicationLink(number, addressId, url && /^https?:$/.test(url.protocol) ? url.href : '')
            : number && url && /^https?:$/.test(url.protocol)
            ? `<a href="${escapeHtmlPlayer(url.href)}" target="_blank" rel="noopener noreferrer">Приложение ${number}</a>`
            : escapeHtmlPlayer(anchor);
        offset = match.index + anchor.length;
    }

    return result + renderPlainText(source.slice(offset));
}

function clearApplicationPreview() {
    document.getElementById('applicationPreview').replaceChildren();
    if (applicationObjectUrl) URL.revokeObjectURL(applicationObjectUrl);
    applicationObjectUrl = null;
}

function closeApplicationFolder() {
    applicationRequestId++;
    clearApplicationPreview();
    const overlay = document.getElementById('applicationOverlay');
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = overlay.dataset.previousOverflow || '';
}

function showApplicationFiles() {
    clearApplicationPreview();
    document.getElementById('applicationPreview').style.display = 'none';
    document.getElementById('applicationFiles').style.display = 'block';
    document.getElementById('applicationBackBtn').disabled = true;
    document.getElementById('applicationTitle').textContent = document.getElementById('applicationOverlay').dataset.title || 'Приложение';
}

async function openApplicationFolder(addressId, number, fallbackUrl = '') {
    const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
    const token = gameStorage.getItem('token');
    if (!scenarioId || !token) return;
    const requestId = ++applicationRequestId;
    const overlay = document.getElementById('applicationOverlay');
    overlay.dataset.title = `Приложение ${number}`;
    if (!overlay.classList.contains('is-open')) overlay.dataset.previousOverflow = document.body.style.overflow;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    showApplicationFiles();
    const list = document.getElementById('applicationFiles');
    list.textContent = 'Загрузка файлов…';
    const base = `${API_BASE}/applications/game/scenarios/${encodeURIComponent(scenarioId)}/addresses/${encodeURIComponent(addressId)}/${encodeURIComponent(number)}`;
    try {
        const response = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 404 && fallbackUrl) {
            if (requestId === applicationRequestId) {
                list.innerHTML = `<p>Эта папка ещё не загружена в сценарий.</p><a href="${escapeHtmlPlayer(fallbackUrl)}" target="_blank" rel="noopener noreferrer">Открыть прежнюю ссылку</a>`;
            }
            return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось открыть приложение');
        if (requestId !== applicationRequestId) return;
        const files = data.application.files || [];
        list.innerHTML = files.length ? files.map((file, index) => `
            <button type="button" class="application-file" data-file-index="${index}">
                <i class="fas ${file.type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-image'}" aria-hidden="true"></i>
                <span>${escapeHtmlPlayer(displayApplicationFileName(file, index))}</span>
            </button>`).join('') : 'В этой папке пока нет файлов';
        list.querySelectorAll('.application-file').forEach(button => button.addEventListener('click', () =>
            openApplicationFile(base, files[Number(button.dataset.fileIndex)], Number(button.dataset.fileIndex), token)));
    } catch (error) {
        if (requestId === applicationRequestId) list.textContent = error.message;
    }
}

async function openApplicationFile(base, file, index, token) {
    const requestId = ++applicationRequestId;
    const preview = document.getElementById('applicationPreview');
    preview.style.display = 'block';
    document.getElementById('applicationFiles').style.display = 'none';
    document.getElementById('applicationBackBtn').disabled = false;
    const displayName = displayApplicationFileName(file, index);
    document.getElementById('applicationTitle').textContent = displayName;
    clearApplicationPreview();
    preview.textContent = 'Загрузка файла…';
    try {
        const response = await fetch(`${base}/files/${encodeURIComponent(file.id)}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Не удалось загрузить файл');
        const blob = await response.blob();
        if (requestId !== applicationRequestId) return;
        clearApplicationPreview();
        applicationObjectUrl = URL.createObjectURL(blob);
        const viewer = document.createElement(file.type === 'application/pdf' ? 'iframe' : 'img');
        viewer.src = applicationObjectUrl;
        viewer.title = displayName;
        viewer.alt = displayName;
        preview.append(viewer);
    } catch (error) {
        if (requestId === applicationRequestId) preview.textContent = error.message;
    }
}

document.addEventListener('click', event => {
    const link = event.target.closest('.scenario-application-link');
    if (!link) return;
    event.preventDefault();
    openApplicationFolder(link.dataset.addressId, link.dataset.number, link.dataset.fallbackUrl || '');
});
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('applicationCloseBtn')?.addEventListener('click', closeApplicationFolder);
    document.getElementById('applicationBackBtn')?.addEventListener('click', () => { applicationRequestId++; showApplicationFiles(); });
    document.getElementById('applicationOverlay')?.addEventListener('click', event => {
        if (event.target.id === 'applicationOverlay') closeApplicationFolder();
    });
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('applicationOverlay')?.classList.contains('is-open')) closeApplicationFolder();
});

async function loadPlayerAddressBookSectionsAndEntries() {
    const token = gameStorage.getItem('token');
    if (!token) return;
    try {
        const response = await fetch(`${API_BASE}/game/address-book/sections`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Ошибка загрузки (' + response.status + ')');
        playerAddressBookSections = data;
        playerAddressBookSectionsLoaded = true;

        const privateWrap = document.getElementById('playerAddressBookPrivateTabs');
        const enterpriseWrap = document.getElementById('playerAddressBookEnterpriseTabs');
        if (privateWrap && data.private_letter_groups) {
            privateWrap.innerHTML = '';
            data.private_letter_groups.forEach(group => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm ' + (playerAddressBookFilter.category === 'Частные лица' && playerAddressBookFilter.letter_group === group ? 'active' : '');
                btn.textContent = group;
                btn.addEventListener('click', () => {
                    playerAddressBookFilter.category = data.private_category || 'Частные лица';
                    playerAddressBookFilter.letter_group = group;
                    document.querySelectorAll('#playerAddressBookPrivateTabs .btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    document.querySelectorAll('#playerAddressBookEnterpriseTabs .btn').forEach(b => b.classList.remove('active'));
                    loadPlayerAddressBookEntries();
                });
                privateWrap.appendChild(btn);
            });
        }
        if (enterpriseWrap && data.enterprise_categories) {
            enterpriseWrap.innerHTML = '';
            data.enterprise_categories.forEach(cat => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm ' + (playerAddressBookFilter.category === cat ? 'active' : '');
                btn.textContent = cat;
                btn.addEventListener('click', () => {
                    playerAddressBookFilter.category = cat;
                    playerAddressBookFilter.letter_group = null;
                    document.querySelectorAll('#playerAddressBookEnterpriseTabs .btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    document.querySelectorAll('#playerAddressBookPrivateTabs .btn').forEach(b => b.classList.remove('active'));
                    loadPlayerAddressBookEntries();
                });
                enterpriseWrap.appendChild(btn);
            });
        }
        if (playerAddressBookSections.private_letter_groups && playerAddressBookSections.private_letter_groups.length && !playerAddressBookFilter.letter_group) {
            playerAddressBookFilter.category = playerAddressBookSections.private_category || 'Частные лица';
            playerAddressBookFilter.letter_group = playerAddressBookSections.private_letter_groups[0];
        }
        const searchEl = document.getElementById('playerAddressBookSearch');
        if (searchEl) {
            searchEl.value = playerAddressBookFilter.q || '';
            searchEl.oninput = () => {
                playerAddressBookFilter.q = searchEl.value.trim();
                loadPlayerAddressBookEntries();
            };
        }
        await loadPlayerAddressBookEntries();
    } catch (err) {
        console.error('loadPlayerAddressBookSectionsAndEntries:', err);
        const tbody = document.getElementById('playerAddressBookTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Ошибка загрузки адресной книги</td></tr>';
    }
}

async function loadPlayerAddressBookEntries() {
    const token = gameStorage.getItem('token');
    const tbody = document.getElementById('playerAddressBookTableBody');
    const labelEl = document.getElementById('playerAddressBookActiveLabel');
    const apartmentHeader = document.getElementById('playerAddressBookApartmentHeader');
    if (!tbody || !playerAddressBookSectionsLoaded) return;

    const category = playerAddressBookFilter.category;
    if (labelEl) labelEl.textContent = category === 'Частные лица' && playerAddressBookFilter.letter_group
        ? `Частные лица: ${playerAddressBookFilter.letter_group}` : category;

    const showApartment = category === 'Частные лица' || (playerAddressBookFilter.q && playerAddressBookFilter.q.length > 0);
    if (apartmentHeader) apartmentHeader.style.display = showApartment ? '' : 'none';

    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Загрузка...</td></tr>';
    const qs = new URLSearchParams();
    qs.set('category', category);
    if (category === 'Частные лица' && playerAddressBookFilter.letter_group) {
        qs.set('letter_group', playerAddressBookFilter.letter_group);
    }
    if (playerAddressBookFilter.q) qs.set('q', playerAddressBookFilter.q);

    try {
        const response = await fetch(`${API_BASE}/game/address-book/entries?${qs}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Ошибка загрузки (' + response.status + ')');
        const entries = data.entries || [];

        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Ничего не найдено</td></tr>';
            return;
        }

        tbody.innerHTML = entries.map(e => {
            const apartmentCell = `<td>${showApartment ? escapeHtmlPlayer(e.apartment) : ''}</td>`;
            return `<tr>
                <td>${escapeHtmlPlayer(e.district)}</td>
                <td>${escapeHtmlPlayer(e.house_number)}</td>
                ${apartmentCell}
                <td>${escapeHtmlPlayer(e.name)}</td>
                <td>${escapeHtmlPlayer(e.note)}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('loadPlayerAddressBookEntries:', err);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Ошибка загрузки</td></tr>';
    }
}

// ===== Questions =====
async function loadQuestions() {
    try {
        const questionsListElement = document.getElementById('questionsList');
        if (!questionsListElement) {
            console.error('Questions list element not found');
            return;
        }
        
        questionsListElement.innerHTML = '<p class="text-muted text-center">Загрузка вопросов...</p>';
        
        const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
        let scenarioId;
        
        if (roomUser && roomUser.room_id) {
            // Для игроков комнаты получаем scenario_id из комнаты
            const token = gameStorage.getItem('token');
            const response = await fetch(`${API_BASE}/room/${roomUser.room_id}/state`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                scenarioId = data.room.scenario_id;
            }
        } else {
            // Для обычных пользователей получаем активный сценарий
            const response = await fetch(`${API_BASE}/scenarios/active`);
            if (response.ok) {
                const data = await response.json();
                scenarioId = data.scenario.id;
            }
        }
        
        if (!scenarioId) {
            questionsListElement.innerHTML = '<p class="text-muted text-center">Нет активного сценария</p>';
            return;
        }
        
        // Загружаем вопросы для сценария
        const questionsResponse = await fetch(`${API_BASE}/questions/scenario/${scenarioId}`);
        if (questionsResponse.ok) {
            const questionsData = await questionsResponse.json();
            displayQuestions(questionsData.questions, scenarioId, roomUser);
        } else {
            questionsListElement.innerHTML = '<p class="text-muted text-center">Ошибка загрузки вопросов</p>';
        }
    } catch (error) {
        console.error('Error loading questions:', error);
        const questionsListElement = document.getElementById('questionsList');
        if (questionsListElement) {
            questionsListElement.innerHTML = '<p class="text-muted text-center">Ошибка загрузки вопросов</p>';
        }
    }
}

let currentQuestions = [];
let lastAnswersScenarioId = null;
let lastAnswersRoomUser = undefined;

const ANSWERS_STORAGE_PREFIX = 'detectivka_answers_';

function escapeHtmlForTextarea(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getAnswersStorageKey(scenarioId, roomUser) {
    const user = JSON.parse(gameStorage.getItem('user') || '{}');
    const id = roomUser && roomUser.room_id != null
        ? 'room_' + roomUser.room_id + '_' + roomUser.id
        : 'user_' + (user.id || 'anon');
    return ANSWERS_STORAGE_PREFIX + scenarioId + '_' + id;
}

function loadSavedAnswers(scenarioId, roomUser) {
    try {
        const key = getAnswersStorageKey(scenarioId, roomUser);
        const raw = gameStorage.getItem(key);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function saveAnswer(scenarioId, roomUser, questionId, text) {
    const key = getAnswersStorageKey(scenarioId, roomUser);
    const saved = loadSavedAnswers(scenarioId, roomUser);
    if (text) {
        saved[questionId] = text;
    } else {
        delete saved[questionId];
    }
    try {
        gameStorage.setItem(key, JSON.stringify(saved));
    } catch (e) {}
}

function displayQuestions(questions, scenarioId, roomUser) {
    const container = document.getElementById('questionsList');
    
    if (!questions || questions.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">Нет вопросов для этого сценария</p>';
        currentQuestions = [];
        return;
    }
    
    currentQuestions = questions;
    lastAnswersScenarioId = scenarioId || null;
    lastAnswersRoomUser = roomUser;
    const saved = scenarioId && roomUser !== undefined ? loadSavedAnswers(scenarioId, roomUser) : {};
    
    const questionsHtml = questions.map(question => `
        <div class="question-item mb-4 p-3 border rounded">
            <h5 class="mb-3">${question.question_text}</h5>
            <div class="mb-3">
                <label for="answer_${question.id}" class="form-label">Ваш ответ:</label>
                <textarea class="form-control answer-input" id="answer_${question.id}" data-question-id="${question.id}" rows="3" placeholder="Введите ваш ответ...">${escapeHtmlForTextarea(saved[question.id] || '')}</textarea>
            </div>
        </div>
    `).join('');
    
    const bulkControlsHtml = `
        <div class="text-center mt-4">
            <button class="btn" id="submitAllAnswersBtn" onclick="submitAllAnswers()">
                <i class="fas fa-paper-plane me-1"></i>Отправить все ответы
            </button>
            <div id="answers_global_status" class="mt-2"></div>
        </div>
    `;
    
    container.innerHTML = questionsHtml + bulkControlsHtml;
    
    if (scenarioId && roomUser !== undefined) {
        container.querySelectorAll('.answer-input').forEach(textarea => {
            const questionId = textarea.dataset.questionId;
            textarea.addEventListener('input', () => {
                saveAnswer(scenarioId, roomUser, questionId, textarea.value);
            });
        });
    }
}

async function submitAllAnswers() {
    const globalStatusDiv = document.getElementById('answers_global_status');
    
    if (!currentQuestions || currentQuestions.length === 0) {
        globalStatusDiv.innerHTML = '<div class="alert alert-warning">Нет вопросов для отправки ответов</div>';
        return;
    }
    
    const token = gameStorage.getItem('token');
    const results = [];
    
    for (const question of currentQuestions) {
        const textarea = document.getElementById(`answer_${question.id}`);
        if (!textarea) {
            continue;
        }
        
        const answerText = textarea.value; // пустые ответы разрешены
        
        try {
            const response = await fetch(`${API_BASE}/questions/answer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    question_id: question.id,
                    answer_text: answerText
                })
            });
            
            if (response.ok) {
                results.push({ questionId: question.id, ok: true });
            } else {
                const errorBody = await response.json().catch(() => ({}));
                const msg = errorBody.error || (response.status === 401 ? 'Требуется авторизация. Зайдите в комнату заново.' : `Ошибка ${response.status}`);
                results.push({ questionId: question.id, ok: false, error: msg });
            }
        } catch (error) {
            console.error('Error submitting answer:', error);
            results.push({ questionId: question.id, ok: false, error: 'Сеть недоступна или сервер не отвечает' });
        }
    }
    
    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;
    const firstError = results.find(r => !r.ok);
    const errorMessage = firstError ? firstError.error : '';
    
    if (successCount > 0 && failCount === 0) {
        globalStatusDiv.innerHTML = '<div class="alert alert-success">Все ответы отправлены</div>';
        if (lastAnswersScenarioId && lastAnswersRoomUser !== undefined) {
            try {
                gameStorage.removeItem(getAnswersStorageKey(lastAnswersScenarioId, lastAnswersRoomUser));
            } catch (e) {}
        }
    } else if (successCount > 0 && failCount > 0) {
        globalStatusDiv.innerHTML = `<div class="alert alert-warning">Часть ответов отправлена успешно (${successCount}), часть с ошибками (${failCount}). ${errorMessage ? errorMessage : ''}</div>`;
    } else {
        globalStatusDiv.innerHTML = `<div class="alert alert-danger">Не удалось отправить ответы. ${errorMessage || 'Проверьте подключение и авторизацию.'}</div>`;
    }
}

// ===== ИНТЕРАКТИВНЫЕ ВЫБОРЫ =====

// Глобальные переменные для выборов
let currentAddressId = null;
let currentVisitedLocationId = null;
let currentScenarioId = null;

// Проверяем, есть ли интерактивные выборы для адреса
async function checkForInteractiveChoices(addressId, description, visitedLocationId) {
    try {
        // Получаем ID сценария из состояния комнаты
        const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
        if (!roomState || !scenarioId) {
            console.log('No scenario ID available', roomState);
            return;
        }
        
        currentAddressId = addressId;
        currentVisitedLocationId = visitedLocationId;
        currentScenarioId = scenarioId;
        
        console.log('Checking for choices:', { scenarioId: currentScenarioId, addressId });
        const token = gameStorage.getItem('token');
        console.log('Making request to:', `${API_BASE}/choices/game/scenarios/${currentScenarioId}/addresses/${addressId}/choices`);
        const response = await fetch(`${API_BASE}/choices/game/scenarios/${currentScenarioId}/addresses/${addressId}/choices`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            console.log('No choices available or error loading choices', response.status);
            return;
        }
        
        const data = await response.json();
        console.log('Choices data received:', data);
        
        if (data.choices && data.choices.length > 0) {
            console.log('Showing choice modal with', data.choices.length, 'choices');
            showInteractiveChoiceModal(data.choices, description);
        } else {
            console.log('No choices available for this address');
        }
        
    } catch (error) {
        console.error('Error checking for interactive choices:', error);
    }
}

// Показать модальное окно с интерактивными выбором
function showInteractiveChoiceModal(choices, description) {
    console.log('showInteractiveChoiceModal called with:', { choices, description });
    
    // Обновляем описание адреса
    const addressDescElement = document.getElementById('addressDescription');
    if (addressDescElement) {
        addressDescElement.innerHTML = renderScenarioText(description || 'Вы нашли интересное место...', currentAddressId);
    }
    
    // Создаем кнопки выборов
    const choiceButtons = document.getElementById('choiceButtons');
    if (!choiceButtons) {
        console.error('choiceButtons element not found');
        return;
    }
    
    choiceButtons.innerHTML = '';
    
    choices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.className = 'btn btn-outline-light btn-lg choice-btn';
        button.style.cssText = `
            border: 2px solid var(--noir-gold);
            color: var(--noir-gold);
            background: transparent;
            transition: all 0.3s ease;
        `;
        button.innerHTML = `
            <div class="d-flex align-items-center">
                <span class="badge bg-primary me-3 fs-6">${String.fromCharCode(65 + index)}</span>
                <span>${choice.choice_text}</span>
            </div>
        `;
        
        // Добавляем hover эффекты
        button.addEventListener('mouseenter', () => {
            button.style.background = 'var(--noir-gold)';
            button.style.color = 'var(--noir-dark)';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.background = 'transparent';
            button.style.color = 'var(--noir-gold)';
        });
        
        button.addEventListener('click', () => makePlayerChoice(choice.id));
        
        choiceButtons.appendChild(button);
    });
    
    // Показываем модальное окно
    const modalElement = document.getElementById('choiceModal');
    if (!modalElement) {
        console.error('choiceModal element not found');
        return;
    }
    
    const modal = new bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
    console.log('Modal shown successfully');
}

// Сделать выбор игрока
async function makePlayerChoice(choiceId) {
    try {
        const token = gameStorage.getItem('token');
        const roomUser = JSON.parse(gameStorage.getItem('roomUser'));
        
        if (!roomUser || !roomUser.id) {
            throw new Error('Room user not found');
        }
        
        const response = await fetch(`${API_BASE}/choices/game/make-choice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                room_user_id: roomUser.id,
                scenario_id: currentScenarioId,
                address_id: currentAddressId,
                choice_id: choiceId,
                visited_location_id: currentVisitedLocationId
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to make choice');
        }
        
        const data = await response.json();
        
        // Показываем результат выбора
        showChoiceResponse(data.response);
        
    } catch (error) {
        console.error('Error making choice:', error);
        
        // Показываем ошибку
        document.getElementById('choiceOptions').style.display = 'none';
        document.getElementById('choiceResponse').style.display = 'block';
        document.getElementById('responseText').textContent = 'Произошла ошибка при обработке вашего выбора.';
    }
}

// Показать результат выбора
function showChoiceResponse(responseText) {
    // Скрываем варианты выбора
    document.getElementById('choiceOptions').style.display = 'none';
    
    // Показываем результат
    document.getElementById('choiceResponse').style.display = 'block';
    document.getElementById('responseText').innerHTML = renderScenarioText(responseText, currentAddressId);
}

// Открыть выборы из истории поездок
async function openChoiceHistory(addressId, description, visitedLocationId) {
    try {
        currentAddressId = addressId;
        const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
        if (!scenarioId) {
            console.log('No scenario ID available');
            return;
        }
        
        const roomUser = JSON.parse(gameStorage.getItem('roomUser'));
        if (!roomUser || !roomUser.id) {
            console.log('No room user found');
            return;
        }
        
        // Проверяем, есть ли уже сделанные выборы
        const token = gameStorage.getItem('token');
        const choiceResponse = await fetch(`${API_BASE}/choices/game/players/${roomUser.id}/scenarios/${scenarioId}/addresses/${addressId}/choice`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (choiceResponse.ok) {
            const choiceData = await choiceResponse.json();
            
            if (choiceData.choice) {
                // Показываем уже сделанные выборы
                showExistingChoice(choiceData.choice, description);
                return;
            }
        }
        
        // Если выбор не был сделан, показываем доступные варианты
        const response = await fetch(`${API_BASE}/choices/game/scenarios/${scenarioId}/addresses/${addressId}/choices`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.choices && data.choices.length > 0) {
                currentAddressId = addressId;
                currentVisitedLocationId = visitedLocationId;
                currentScenarioId = scenarioId;
                showInteractiveChoiceModal(data.choices, description);
            } else {
                alert('Для этой локации нет интерактивных выборов');
            }
        } else {
            alert('Не удалось загрузить варианты выбора');
        }
        
    } catch (error) {
        console.error('Error opening choice history:', error);
        alert('Произошла ошибка при загрузке выборов');
    }
}

// Показать уже сделанные выборы
function showExistingChoice(choice, description) {
    // Обновляем описание адреса
    document.getElementById('addressDescription').innerHTML = renderScenarioText(description || 'Локация найдена', currentAddressId);
    
    // Скрываем варианты выбора
    document.getElementById('choiceOptions').style.display = 'none';
    
    // Показываем результат
    document.getElementById('choiceResponse').style.display = 'block';
    document.getElementById('responseText').innerHTML =
        `<strong>Ваш выбор:</strong> ${renderScenarioText(choice.choice_text, currentAddressId)}\n\n<strong>Результат:</strong> ${renderScenarioText(choice.response_text, currentAddressId)}`;
    
    // Показываем модальное окно
    const modal = new bootstrap.Modal(document.getElementById('choiceModal'));
    modal.show();
}

// Сброс модального окна при закрытии
document.getElementById('choiceModal').addEventListener('hidden.bs.modal', function () {
    // Сброс состояния модального окна
    document.getElementById('choiceOptions').style.display = 'block';
    document.getElementById('choiceResponse').style.display = 'none';
    document.getElementById('choiceButtons').innerHTML = '';
    
    // Сброс переменных
    currentAddressId = null;
    currentVisitedLocationId = null;
    currentScenarioId = null;
});

// ===== Интернет-кафе =====

async function openInternetCafe(cafeAddressId) {
    currentCafeAddressId = cafeAddressId;
    currentCafePage = null;
    cafeViewMode = 'home';

    const overlay = document.getElementById('internetCafeOverlay');
    const content = document.getElementById('ieCafeContent');
    const addressBar = document.getElementById('ieCafeAddressBar');
    const backBtn = document.getElementById('ieCafeBackBtn');
    const titleEl = document.getElementById('ieCafeTitle');

    if (!overlay || !content) return;

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    if (titleEl) titleEl.textContent = 'Internet Explorer — Интернет-кафе «Облако»';
    if (addressBar) addressBar.value = 'http://localhost/';
    if (backBtn) backBtn.disabled = true;
    content.innerHTML = '<div class="ie-cafe-home"><p>Подключение...</p></div>';

    try {
        const token = gameStorage.getItem('token');
        const response = await fetch(`${API_BASE}/internet-cafe/game/${cafeAddressId}/pages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!response.ok) {
            content.innerHTML = `<div class="ie-cafe-home"><p>${data.error || 'Ошибка загрузки'}</p></div>`;
            return;
        }

        renderCafeHome(data.pages || [], data.empty_message);
    } catch (error) {
        console.error('Error opening internet cafe:', error);
        content.innerHTML = '<div class="ie-cafe-home"><p>Ошибка соединения</p></div>';
    }
}

function renderCafeHome(pages, emptyMessage) {
    const content = document.getElementById('ieCafeContent');
    const addressBar = document.getElementById('ieCafeAddressBar');
    const backBtn = document.getElementById('ieCafeBackBtn');
    cafeViewMode = 'home';

    if (addressBar) addressBar.value = 'http://localhost/';
    if (backBtn) backBtn.disabled = true;

    if (!pages || pages.length === 0) {
        content.innerHTML = `
            <div class="ie-cafe-home">
                <p>${escapeCafeHtml(emptyMessage || 'Вам нечего искать в сети интернет')}</p>
            </div>`;
        return;
    }

    const results = pages.map(page =>
        `<button type="button" class="ie-cafe-search-result">${escapeCafeHtml(page.title)}</button>`
    ).join('');

    content.innerHTML = `
        <div class="ie-cafe-home">
            <div class="ie-cafe-search">
                <h2>Поиск в интернете</h2>
                <button type="button" class="ie-cafe-search-trigger" aria-expanded="false" aria-controls="ieCafeSearchResults">
                    <span>Выберите страницу</span><span aria-hidden="true">▾</span>
                </button>
                <div class="ie-cafe-search-results" id="ieCafeSearchResults" hidden>
                    ${results}
                </div>
            </div>
        </div>`;

    const trigger = content.querySelector('.ie-cafe-search-trigger');
    const resultList = content.querySelector('.ie-cafe-search-results');
    trigger.addEventListener('click', () => {
        resultList.hidden = !resultList.hidden;
        trigger.setAttribute('aria-expanded', String(!resultList.hidden));
    });
    content.querySelectorAll('.ie-cafe-search-result').forEach((button, index) => {
        button.addEventListener('click', () => openCafePage(pages[index].id));
    });
}

async function openCafePage(pageId) {
    const content = document.getElementById('ieCafeContent');

    content.innerHTML = '<div class="ie-cafe-home"><p>Загрузка страницы...</p></div>';

    try {
        const token = gameStorage.getItem('token');
        const response = await fetch(`${API_BASE}/internet-cafe/game/pages/${pageId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!response.ok) {
            content.innerHTML = `<div class="ie-cafe-home"><p>${data.error || 'Страница недоступна'}</p></div>`;
            return;
        }

        currentCafePage = data.page;
        renderCafePage(data.page);
    } catch (error) {
        console.error('Error opening cafe page:', error);
        content.innerHTML = '<div class="ie-cafe-home"><p>Ошибка соединения</p></div>';
    }
}

function renderCafePage(page) {
    const content = document.getElementById('ieCafeContent');
    const addressBar = document.getElementById('ieCafeAddressBar');
    const backBtn = document.getElementById('ieCafeBackBtn');
    const titleEl = document.getElementById('ieCafeTitle');

    cafeViewMode = 'page';
    if (backBtn) backBtn.disabled = false;
    if (titleEl) titleEl.textContent = `Internet Explorer — ${page.title}`;
    if (addressBar) {
        const slug = (page.title || 'page')
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-zа-яё0-9\-]/gi, '');
        addressBar.value = `http://www.${slug || 'site'}.ru/`;
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'ie-cafe-frame';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.addEventListener('load', () => {
        const pageDocument = iframe.contentDocument;
        if (!pageDocument) return;
        applyCafeBlogMobileLayout(pageDocument);
        window.protectPageFromCopy?.(pageDocument);
        pageDocument.addEventListener('click', (event) => {
            const link = event.target?.closest?.('a[href], area[href]');
            if (!link) return;
            event.preventDefault();
            showCafeNetworkError(link.getAttribute('href'));
        }, true);
    });
    iframe.srcdoc = page.content_html;
    content.replaceChildren(iframe);
}

function applyCafeBlogMobileLayout(pageDocument) {
    if (!pageDocument.querySelector('.wrap .main .post') ||
        !pageDocument.querySelector('.wrap .main .sidebar')) return;

    if (!pageDocument.querySelector('meta[name="viewport"]')) {
        const viewport = pageDocument.createElement('meta');
        viewport.name = 'viewport';
        viewport.content = 'width=device-width, initial-scale=1';
        pageDocument.head.appendChild(viewport);
    }

    const style = pageDocument.createElement('style');
    style.textContent = `
        @media (max-width: 700px) {
            .wrap { width: 100% !important; max-width: 100% !important; }
            .header { padding: 22px 16px !important; }
            .header h1 { font-size: 24px !important; line-height: 1.2 !important; }
            .nav { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; gap: 8px 18px !important; }
            .nav a { margin: 0 !important; }
            .main { display: block !important; padding: 18px 16px !important; }
            .post { width: 100% !important; padding-right: 0 !important; border-right: 0 !important; }
            .post h2, .post p { overflow-wrap: anywhere !important; }
            .post img { max-width: 100% !important; height: auto !important; }
            .sidebar { width: 100% !important; padding: 20px 0 0 !important; margin-top: 24px !important; border-top: 1px solid #ccc !important; }
        }
    `;
    pageDocument.head.appendChild(style);
}

function showCafeNetworkError(href) {
    const content = document.getElementById('ieCafeContent');
    const addressBar = document.getElementById('ieCafeAddressBar');
    const titleEl = document.getElementById('ieCafeTitle');
    if (addressBar && href) {
        try {
            addressBar.value = new URL(href, addressBar.value).href;
        } catch (_) {
            addressBar.value = href;
        }
    }
    cafeViewMode = 'error';
    if (titleEl) titleEl.textContent = 'Internet Explorer — Ошибка сети';
    content.innerHTML = `
        <div class="ie-cafe-network-error">
            <h2>Ошибка сети</h2>
            <p>Не удаётся открыть эту страницу.</p>
            <button type="button" class="ie-cafe-error-back">Вернуться назад</button>
        </div>`;
    content.querySelector('.ie-cafe-error-back').addEventListener('click', () => {
        if (currentCafePage) renderCafePage(currentCafePage);
    });
}

function closeInternetCafe() {
    const overlay = document.getElementById('internetCafeOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    }
    currentCafeAddressId = null;
    currentCafePage = null;
    cafeViewMode = 'home';
}

function escapeCafeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

(function initInternetCafeUi() {
    const closeBtn = document.getElementById('ieCafeCloseBtn');
    const backBtn = document.getElementById('ieCafeBackBtn');
    const overlay = document.getElementById('internetCafeOverlay');

    if (closeBtn) closeBtn.addEventListener('click', closeInternetCafe);
    if (backBtn) {
        backBtn.addEventListener('click', async () => {
            if (cafeViewMode === 'error' && currentCafePage) {
                renderCafePage(currentCafePage);
            } else if (cafeViewMode === 'page' && currentCafeAddressId) {
                await openInternetCafe(currentCafeAddressId);
            }
        });
    }
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeInternetCafe();
        });
    }
})();
