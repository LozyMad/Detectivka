const gameStorage = window.gameSession.storage;
const API_BASE = '/api';
let selectedDistrict = null;
let roomState = null;
let roomTimerInterval = null;
let tripCount = 0;
let tripHistory = [];
let receivedApplications = new Map();
let receivedApplicationAddresses = new Map();
let scenarioBriefing = null;
let applicationScenarioId = null;
const collapsedTripKeys = new Set();
let freshTripTimer = null;
let cachedScenarioName = null; // Кэш для имени сценария
let lastScenarioCheck = 0; // Время последней проверки сценария
let roomEventSource = null;
let roomReconnectTimer = null;
let roomEventWatchdog = null;
let roomReconnectDelay = 5000;
let roomStateRequest = null;
let roomStateUpdatedAt = 0;
let tripHistoryRequest = null;
let tripHistoryVersion = 0;
let visitInFlight = false;
let backgroundReady = false;
let pageSuspended = false;
const roomStatePoll = window.gameNetwork.poll(async () => {
    const success = await refreshRoomState();
    renderTimer();
    return success;
}, 5000);
const tripHistoryPoll = window.gameNetwork.poll(() => loadTripHistory(), 60000);
let currentCafeAddressId = null;
let currentCafePage = null;
let cafeViewMode = 'home'; // 'home' | 'page' | 'error'
let applicationObjectUrl = null;
let applicationRequestId = 0;
let applicationController = null;
let arrangePlayerNavigation = () => {};
let activePlayerPane = 'game';
let applicationReturnFocus = null;
let applicationReturnAddress = null;
let playerRouteReady = false;
window.gameSession.onExpired = () => {
    savePlayerRoute();
    backgroundReady = false;
    updateBackgroundState();
    window.gameNetwork.cancelReads();
    window.location.href = window.gameSession.isTest ? '/admin?test-session=expired' : '/game-login?session=expired';
};

function savePlayerRoute() {
    const route = { district: document.getElementById('districtSelect')?.value || '',
        house: document.getElementById('houseNumber')?.value || '',
        apartment: document.getElementById('apartmentNumber')?.value || '' };
    if (playerRouteReady || route.district || route.house || route.apartment) window.gameSession.saveRoute(route);
}

function syncWorkspaceRail() {
    const toggle = document.getElementById('workspaceRailToggle');
    if (toggle) {
        const expanded = document.body.classList.contains('workspace-rail-expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Свернуть навигацию' : 'Развернуть навигацию');
    }
}

function isDesktopWorkspace() {
    return window.matchMedia('(min-width: 1280px) and (min-height: 501px)').matches &&
        !window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function syncWorkspacePanes() {
    const workspace = isDesktopWorkspace();
    const tool = ['questions', 'addressbook', 'applications'].includes(activePlayerPane);
    document.body.classList.toggle('desktop-workspace', workspace);
    document.body.classList.toggle('workspace-tool-open', workspace && tool);
    document.body.dataset.workspacePane = activePlayerPane;
    for (const id of ['game', 'questions', 'addressbook', 'applications', 'board']) {
        const pane = document.getElementById(id);
        if (!pane) continue;
        const visible = id === activePlayerPane || (workspace && tool && id === 'game');
        pane.classList.toggle('active', visible);
        pane.classList.toggle('show', visible);
        pane.classList.toggle('fade', !visible);
    }
}

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
    const bannerWidth = window.matchMedia('(max-width: 767.98px)').matches ? 960 : 1920;
    image.src = `${API_BASE}/scenarios/${encodeURIComponent(scenarioId)}/banner?width=${bannerWidth}`;
}

function setupMobileGameLayout() {
    const toolbar = document.getElementById('playerMobileToolbar');
    const bottomNav = document.getElementById('playerBottomNav');
    const collapse = document.getElementById('navbarCollapse');
    const tabs = document.getElementById('playerNavTabs');
    const stats = document.getElementById('playerNavStats');
    const controls = document.getElementById('playerNavControls');
    const timer = document.getElementById('roomTimer');
    const boardNav = document.getElementById('boardNavHost');
    const boardTimer = document.getElementById('boardTimerHost');
    const boardAccount = document.getElementById('boardAccount');
    const boardMenu = document.getElementById('boardAccountMenu');
    const sidebar = document.querySelector('.dossier-sidebar');
    const utilities = document.querySelector('.dossier-utilities');
    const journal = document.querySelector('.dossier-main');
    const applicationsTab = document.getElementById('applications-tab');
    const mobileDossier = document.getElementById('mobileDossierHost');
    const workspaceNav = document.getElementById('workspaceNavHost');
    if (!toolbar || !bottomNav || !collapse || !tabs || !stats || !sidebar) return;

    const tabHome = tabs.parentElement;
    const statHome = stats.parentElement;
    const sidebarHome = sidebar.parentElement;
    const toolbarHome = toolbar.parentElement;
    const toolbarNext = toolbar.nextSibling;
    const controlsHome = controls?.parentElement;
    const timerHome = timer?.parentElement;
    const mobile = window.matchMedia('(max-width: 767.98px)');
    const phone = window.matchMedia('(max-width: 767.98px), (max-width: 950px) and (max-height: 500px)');
    const bottomNavigation = window.matchMedia('(max-width: 1279.98px), (hover: none) and (pointer: coarse)');
    const desktopBoard = window.matchMedia('(min-width: 768px) and (min-height: 501px), (min-width: 951px)');
    const landscapeBoard = window.matchMedia('(orientation: landscape) and (max-height: 900px) and (max-width: 1279.98px)');
    const narrowLandscape = window.matchMedia('(max-width: 740px)');
    const workspaceSize = window.matchMedia('(min-width: 1280px) and (min-height: 501px)');
    const arrange = () => {
        const workspace = isDesktopWorkspace();
        syncWorkspacePanes();
        if (applicationsTab) applicationsTab.hidden = false;
        // Move the existing controls so timers, active tabs and click handlers stay in sync.
        if (controls && controlsHome) controlsHome.append(controls);
        statHome.prepend(stats);
        if (timer && timerHome) timerHome.prepend(timer);
        tabHome.insertBefore(tabs, statHome);
        const combined = document.body.classList.contains('board-open') && (bottomNavigation.matches || desktopBoard.matches || landscapeBoard.matches) &&
            !!(controls && timer && boardNav && boardTimer && boardMenu);
        document.body.classList.toggle('has-bottom-nav', bottomNavigation.matches);
        document.body.classList.toggle('board-desktop-header', combined);
        document.body.classList.toggle('board-landscape-header', combined && landscapeBoard.matches);
        document.body.classList.toggle('board-touch-header', combined && bottomNavigation.matches);
        if (boardAccount) boardAccount.open = false;
        if (combined) {
            if (!bottomNavigation.matches) (workspace && workspaceNav ? workspaceNav : boardNav).append(tabs);
            // On smaller landscape phones the live timer remains accessible in the account menu.
            if (!landscapeBoard.matches || !narrowLandscape.matches) boardTimer.append(timer);
            boardMenu.append(controls);
            toolbarHome.insertBefore(toolbar, toolbarNext);
        } else if (mobile.matches) {
            toolbar.append(stats);
            const activePane = document.getElementById(activePlayerPane) || document.getElementById('game');
            placeMobileToolbar(activePane);
        } else {
            tabHome.insertBefore(tabs, statHome);
            statHome.prepend(stats);
            toolbarHome.insertBefore(toolbar, toolbarNext);
        }
        const sidebarTarget = (phone.matches || activePlayerPane === 'applications') && mobileDossier ? mobileDossier : sidebarHome;
        // Preserve the notes input and its focus when only viewport height changes.
        if (sidebar.parentElement !== sidebarTarget) sidebarTarget.append(sidebar);
        // Reading and keyboard order follow the visible phone layout as well.
        if (utilities && journal && utilities.parentElement === journal.parentElement) {
            if (phone.matches && utilities.nextElementSibling !== journal) journal.before(utilities);
            else if (!phone.matches && journal.nextElementSibling !== utilities) journal.after(utilities);
        }
        // Keep the original buttons, their listeners and unique IDs across all four views.
        if (bottomNavigation.matches) bottomNav.append(tabs);
        else if (workspace && !combined && workspaceNav) workspaceNav.append(tabs);
        syncWorkspaceRail();
        updateBottomNavHeight();
        const navbar = document.getElementById('gameNavbar');
        if (navbar) document.body.style.setProperty('--board-nav-height', `${navbar.offsetHeight}px`);
    };
    function updateBottomNavHeight() {
        document.body.style.setProperty('--player-bottom-nav-height', `${bottomNavigation.matches ? bottomNav.offsetHeight : 0}px`);
    }
    arrangePlayerNavigation = arrange;
    arrange();
    for (const media of [mobile, phone, bottomNavigation, desktopBoard, landscapeBoard, narrowLandscape, workspaceSize]) {
        if (media.addEventListener) media.addEventListener('change', arrange);
        else media.addListener(arrange);
    }
    new ResizeObserver(updateBottomNavHeight).observe(bottomNav);
    document.querySelector('.workspace-brand')?.addEventListener('click', event => {
        event.preventDefault();
        document.getElementById('game-tab').click();
    });
    document.getElementById('workspaceRailToggle')?.addEventListener('click', () => {
        document.body.classList.toggle('workspace-rail-expanded');
        syncWorkspaceRail();
    });
    document.getElementById('workspaceRail')?.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.body.classList.contains('workspace-rail-expanded')) {
            event.preventDefault();
            event.stopPropagation();
            document.body.classList.remove('workspace-rail-expanded');
            syncWorkspaceRail();
            document.getElementById('workspaceRailToggle')?.focus();
        }
    });
    boardAccount?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            boardAccount.open = false;
            boardAccount.querySelector('summary').focus();
        }
    });
    document.addEventListener('pointerdown', event => {
        if (boardAccount?.open && !boardAccount.contains(event.target)) boardAccount.open = false;
    });
}

function placeMobileToolbar(pane) {
    const toolbar = document.getElementById('playerMobileToolbar');
    if (!toolbar || !pane || !window.matchMedia('(max-width: 767.98px)').matches) return;
    if (pane.id === 'board') return;
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

function stopRoomSSE() {
    clearTimeout(roomReconnectTimer);
    clearTimeout(roomEventWatchdog);
    roomReconnectTimer = roomEventWatchdog = null;
    const source = roomEventSource;
    roomEventSource = null;
    if (source) {
        source.onopen = source.onmessage = source.onerror = null;
        source.close();
    }
}

function backgroundAllowed() {
    return backgroundReady && !pageSuspended && !document.hidden && navigator.onLine !== false && !!gameStorage.getItem('token');
}

function connectRoomSSE(roomId, token) {
    if (!backgroundAllowed() || roomEventSource || roomReconnectTimer !== null) return;
    const url = `${API_BASE}/game/room/${roomId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    roomEventSource = es;
    const touch = () => {
        if (roomEventSource !== es) return;
        clearTimeout(roomEventWatchdog);
        roomEventWatchdog = setTimeout(reconnect, 70000);
    };
    const reconnect = () => {
        if (roomEventSource !== es) return;
        stopRoomSSE();
        if (!backgroundAllowed()) return;
        const delay = roomReconnectDelay + Math.floor(Math.random() * 1000);
        roomReconnectDelay = Math.min(roomReconnectDelay * 2, 60000);
        roomReconnectTimer = setTimeout(() => {
            roomReconnectTimer = null;
            const ru = JSON.parse(gameStorage.getItem('roomUser') || 'null');
            const currentToken = gameStorage.getItem('token');
            if (ru?.room_id && currentToken) connectRoomSSE(ru.room_id, currentToken);
        }, delay);
    };
    // Connecting can stall without an error callback on a broken network.
    roomEventWatchdog = setTimeout(reconnect, 15000);
    es.onopen = () => {
        if (roomEventSource !== es) return;
        roomReconnectDelay = 5000;
        touch();
    };
    es.addEventListener('ping', touch);
    es.onmessage = (e) => {
        if (roomEventSource !== es) return;
        touch();
        try {
            const d = JSON.parse(e.data || '{}');
            if (d.type === 'new_trip') {
                tripHistoryVersion++;
                loadTripHistory();
            }
        } catch (_) {}
    };
    es.onerror = reconnect;
}

function updateBackgroundState() {
    if (!backgroundAllowed()) {
        roomStatePoll.stop();
        tripHistoryPoll.stop();
        stopRoomSSE();
        if (roomTimerInterval !== null) clearInterval(roomTimerInterval);
        roomTimerInterval = null;
        return;
    }
    const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
    if (roomUser?.room_id) {
        initRoomTimer();
        roomStatePoll.start();
        connectRoomSSE(roomUser.room_id, gameStorage.getItem('token'));
    }
    tripHistoryPoll.start();
}

document.addEventListener('visibilitychange', updateBackgroundState);
window.addEventListener('offline', updateBackgroundState);
window.addEventListener('online', updateBackgroundState);
window.addEventListener('pagehide', () => { pageSuspended = true; updateBackgroundState(); });
window.addEventListener('pageshow', () => { pageSuspended = false; updateBackgroundState(); });

// Initialize game
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    setupMobileGameLayout();
    restoreCollapsedTrips();
    // Start the banner request while room state and trip history are loading.
    try {
        const room = JSON.parse(gameStorage.getItem('room') || 'null');
        setScenarioBanner(room?.scenario_id);
    } catch (_) {}
    setupDistrictSelect();
    const route = window.gameSession.restoreRoute();
    if (route) {
        document.getElementById('districtSelect').value = route.district;
        document.getElementById('houseNumber').value = route.house;
        document.getElementById('apartmentNumber').value = route.apartment;
    }
    playerRouteReady = true;
    for (const id of ['districtSelect', 'houseNumber', 'apartmentNumber']) {
        document.getElementById(id)?.addEventListener('input', () => {
            savePlayerRoute();
            const destination = document.getElementById('selectedDestination');
            if (destination) destination.hidden = true;
        });
        document.getElementById(id)?.addEventListener('change', savePlayerRoute);
    }
    loadTripHistory();
    // Initial materials do not have to wait for the trip history request.
    refreshAvailableApplications();
    loadScenarioInfo();
    setupPlayerNotes();
    document.getElementById('tripSearch')?.addEventListener('input', updateTripHistory);
    
    const collapseEl = document.getElementById('navbarCollapse');
    const iconEl = document.getElementById('navbarToggleIcon');
    const menuButton = document.querySelector('[data-bs-target="#navbarCollapse"]');
    if (collapseEl && iconEl) {
        collapseEl.addEventListener('show.bs.collapse', () => {
            iconEl.classList.remove('fa-chevron-down'); iconEl.classList.add('fa-chevron-up');
            menuButton?.setAttribute('aria-label', 'Закрыть параметры игры');
        });
        collapseEl.addEventListener('hide.bs.collapse', () => {
            iconEl.classList.remove('fa-chevron-up'); iconEl.classList.add('fa-chevron-down');
            menuButton?.setAttribute('aria-label', 'Открыть параметры игры');
        });
    }
    
    // Setup tab switching
    setupTabSwitching();
    
    backgroundReady = true;
    updateBackgroundState();
});

function checkAuth() {
    if (window.gameSession.testRequested && !window.gameSession.isTest) {
        window.location.href = '/admin?test-session=expired';
        return false;
    }
    const token = gameStorage.getItem('token');
    const user = JSON.parse(gameStorage.getItem('user') || '{}');
    const roomUser = JSON.parse(gameStorage.getItem('roomUser') || 'null');
    
    console.log('Auth check:', { token: !!token, user, roomUser });
    
    if (!token || (!user.id && !roomUser?.id)) {
        console.log('Auth failed, redirecting to home');
        window.location.href = '/game-login';
        return false;
    }
    if (window.gameSession.hasExpiredToken()) {
        window.gameSession.invalidate();
        return false;
    }
    
    document.getElementById('usernameDisplay').textContent = (roomUser ? roomUser.username : user.username);
    return true;
}

function setupDistrictSelect() {
    const sel = document.getElementById('districtSelect');
    if (!sel) return;
    sel.addEventListener('change', () => {
        selectedDistrict = sel.value || null;
    });
}

async function visitLocation() {
    if (visitInFlight || window.gameSession.expired) return;
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
    visitInFlight = true;
    const goButton = document.getElementById('goBtn');
    if (goButton) goButton.disabled = true;
    tripHistoryVersion++;
    
    try {
        const token = gameStorage.getItem('token');
        const response = await window.gameNetwork.fetch(`${API_BASE}/game/visit`, {
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
        if (window.gameSession.expired) return;

        if (response.status === 403 && data.error === 'Game is paused') {
            await refreshRoomState();
            renderTimer();
            if (roomState?.state !== 'paused') showRoomPausedPopup();
            return;
        }
        
        if (!response.ok && !data.attempt_id) {
            tripHistoryVersion++;
            alert(`${data.error || 'Не удалось выполнить поездку'}. Проверьте историю перед повторной попыткой. Введённый адрес сохранён.`);
            loadTripHistory();
            return;
        }

        // A recorded unsuccessful visit counts; an HTTP error without an attempt does not.
        tripHistoryVersion++;
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
            window.gameSession.clearRoute();
            const destination = document.getElementById('selectedDestination');
            if (destination) destination.hidden = true;
            
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
            window.gameSession.clearRoute();
            const destination = document.getElementById('selectedDestination');
            if (destination) destination.hidden = true;
        }
    } catch (error) {
        if (window.gameSession.expired) return;
        console.error('Error visiting location:', error);
        tripHistoryVersion++;
        alert('Ответ на поездку не получен. Проверьте историю перед повторной попыткой: поездка могла сохраниться. Введённый адрес сохранён.');
        loadTripHistory();
    } finally {
        visitInFlight = false;
        if (goButton) goButton.disabled = false;
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
    return loadTripHistory();
}

// Обновление счетчика поездок
function updateTripCounter() {
    const counter = document.getElementById('tripCounter');
    if (counter) {
        counter.textContent = `Поездок: ${tripCount}`;
    }
    const count = document.getElementById('journalCount');
    if (count) count.textContent = String(tripCount);
}

// Загрузка истории поездок
function loadTripHistory() {
    if (tripHistoryRequest) return tripHistoryRequest;
    const version = tripHistoryVersion;
    tripHistoryRequest = fetchTripHistory(version).finally(() => {
        tripHistoryRequest = null;
        if (version !== tripHistoryVersion && backgroundAllowed()) loadTripHistory();
    });
    return tripHistoryRequest;
}

async function fetchTripHistory(version) {
    try {
        const token = gameStorage.getItem('token');
        const response = await window.gameNetwork.fetch(`${API_BASE}/game/attempts`, {
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
        const nextHistory = await mapTripAttempts(attempts, async (attempt) => {
            let description = attempt.found ? (attempt.address_description || 'Локация найдена') : 'По этому адресу нет информации';
            if (attempt.found && attempt.choice_response) description = attempt.choice_response;
            
            // Если это успешная поездка с address_id, проверяем, есть ли сделанные выборы
            // Compatibility with an older server; the new server includes all choices in one response.
            if (!data.choices_included && attempt.found && attempt.has_choices && attempt.address_id && attempt.visited_location_id) {
                try {
                    const roomUser = JSON.parse(gameStorage.getItem('roomUser'));
                    const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
                    
                    if (roomUser && roomUser.id && scenarioId) {
                        const choiceResponse = await window.gameNetwork.fetch(`${API_BASE}/choices/game/players/${roomUser.id}/scenarios/${scenarioId}/addresses/${attempt.address_id}/choice`, {
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
        });
        if (version !== tripHistoryVersion) return true;
        tripHistory = nextHistory;
        tripCount = attempts.length;
        updateTripCounter();
        
        updateTripHistory();
        await refreshAvailableApplications();
        return true;
        
    } catch (error) {
        console.error('Error loading trip history:', error);
        // Keep the last confirmed history and counter on transient network errors.
        return false;
    }
}

async function mapTripAttempts(attempts, mapper) {
    const results = new Array(attempts.length);
    let next = 0;
    // Older servers need per-address lookups. Do not enqueue the whole history at once.
    await Promise.all(Array.from({ length: Math.min(2, attempts.length) }, async () => {
        while (next < attempts.length) {
            const index = next++;
            results[index] = await mapper(attempts[index]);
        }
    }));
    return results;
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
        const response = await window.gameNetwork.fetch(`${API_BASE}/applications/game/available`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Не удалось загрузить приложения');
        const data = await response.json();
        receivedApplications = new Map((data.addresses || []).map(item => [Number(item.address_id), item.applications || []]));
        receivedApplicationAddresses = new Map((data.addresses || []).map(item => [Number(item.address_id), item]));
        scenarioBriefing = data.briefing || null;
        applicationScenarioId = Number(data.scenario_id) || null;
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
    const count = document.getElementById('materialsCount');
    if (count) count.textContent = String(items.length + (scenarioBriefing ? 1 : 0));
    if (!items.length && !scenarioBriefing) {
        target.textContent = 'Пока нет приложений';
        return;
    }
    const briefing = scenarioBriefing ? `<button type="button" class="received-application scenario-application-link" data-briefing="true">
        <i class="far fa-file-alt" aria-hidden="true"></i> Брифинг дела
        <small>Начальные материалы · ${Number(scenarioBriefing.file_count) || 0} файл(ов)</small>
    </button>` : '';
    target.innerHTML = briefing + items.map(app => `<button type="button" class="received-application scenario-application-link" data-address-id="${app.addressId}" data-number="${app.number}">
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
            <div class="trip-description" aria-hidden="${collapsed}" ${collapsed ? 'inert' : ''}><div class="trip-description-inner">${trip.success
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
            }${trip.success && trip.address_id && gameStorage.getItem('roomUser')
                ? `<div><button type="button" class="trip-board-button" data-trip-id="${escapeHtmlPlayer(trip.id)}"><i class="fas fa-thumbtack" aria-hidden="true"></i> Добавить на доску</button></div>`
                : ''
            }</div></div></div>
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
            const collapsed = collapsedTripKeys.has(key);
            const card = button.closest('.trip-item');
            card.classList.toggle('is-collapsed', collapsed);
            const description = card.querySelector('.trip-description');
            description.setAttribute('aria-hidden', String(collapsed));
            description.toggleAttribute('inert', collapsed);
            button.setAttribute('aria-expanded', String(!collapsed));
            button.setAttribute('aria-label', button.getAttribute('aria-label').replace(/^(Развернуть|Свернуть)/, collapsed ? 'Развернуть' : 'Свернуть'));
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
    container.querySelectorAll('.trip-board-button').forEach(button => {
        button.addEventListener('click', () => {
            const trip = tripHistory.find(item => String(item.id) === button.dataset.tripId);
            if (trip) window.investigationBoard?.openFromTrip(trip);
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
            const response = await window.gameNetwork.fetch(`${API_BASE}/room/${roomUser.room_id}/state`, {
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
            const response = await window.gameNetwork.fetch(`${API_BASE}/scenarios/active`);
            
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
function initRoomTimer() {
    if (roomTimerInterval !== null) return;
    renderTimer();
    // The clock ticks locally; only the poller synchronizes with the server.
    roomTimerInterval = setInterval(renderTimer, 1000);
}

function refreshRoomState() {
    if (roomStateRequest) return roomStateRequest;
    roomStateRequest = fetchRoomState().finally(() => { roomStateRequest = null; });
    return roomStateRequest;
}

async function fetchRoomState() {
    try {
        const room = JSON.parse(gameStorage.getItem('room') || 'null');
        if (!room) return;
        const token = gameStorage.getItem('token');
        const res = await window.gameNetwork.fetch(`${API_BASE}/room/${room.id}/state`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!res.ok) return false;
        const previousState = roomState?.state;
        roomState = await res.json();
        roomStateUpdatedAt = performance.now();
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
        return true;
    } catch (e) {
        return false;
    }
}

function renderTimer() {
    const timerDisplay = document.getElementById('timerDisplay');
    const roomTimer = document.getElementById('roomTimer');
    
    if (!timerDisplay || !roomTimer) return;
    if (!roomState) return;
    
    const state = roomState.state;
    const elapsed = state === 'running' ? Math.max(0, Math.floor((performance.now() - roomStateUpdatedAt) / 1000)) : 0;
    const remaining = Math.max(0, (roomState.remaining || 0) - elapsed);

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
    backgroundReady = false;
    updateBackgroundState();
    window.gameNetwork.cancelReads();
    window.gameSession.clear();
    if (window.gameSession.isTest) {
        window.location.href = '/admin';
    } else {
        window.location.href = '/login';
    }
}

// ===== Tab Switching =====
function setupTabSwitching() {
    const gameTab = document.getElementById('game-tab');
    const questionsTab = document.getElementById('questions-tab');
    const addressbookTab = document.getElementById('addressbook-tab');
    const boardTab = document.getElementById('board-tab');
    const applicationsTab = document.getElementById('applications-tab');
    const gameContent = document.getElementById('game');
    const questionsContent = document.getElementById('questions');
    const addressbookContent = document.getElementById('addressbook');
    const boardContent = document.getElementById('board');
    const applicationsContent = document.getElementById('applications');
    const gameNavbar = document.getElementById('gameNavbar');
    let boardReturnScrollY = 0;

    function updateBoardNavHeight() {
        if (gameNavbar) document.body.style.setProperty('--board-nav-height', `${gameNavbar.offsetHeight}px`);
    }
    if (gameNavbar) new ResizeObserver(updateBoardNavHeight).observe(gameNavbar);
    window.addEventListener('resize', updateBoardNavHeight);

    function showPane(pane) {
        activePlayerPane = pane.id;
        const wasBoardOpen = document.body.classList.contains('board-open');
        const wasApplicationsOpen = applicationsContent?.classList.contains('active');
        if (wasBoardOpen && pane !== boardContent) window.investigationBoard?.hide();
        if (pane === applicationsContent) {
            const mobileMenu = document.getElementById('navbarCollapse');
            if (mobileMenu) window.bootstrap?.Collapse.getOrCreateInstance(mobileMenu, { toggle: false }).hide();
        }
        if (pane === boardContent && !wasBoardOpen) {
            boardReturnScrollY = window.scrollY;
            const mobileMenu = document.getElementById('navbarCollapse');
            if (mobileMenu && window.matchMedia('(max-width: 767.98px), (max-width: 950px) and (max-height: 500px)').matches) {
                window.bootstrap?.Collapse.getOrCreateInstance(mobileMenu, { toggle: false }).hide();
            }
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            updateBoardNavHeight();
        }
        [gameContent, questionsContent, addressbookContent, boardContent, applicationsContent].forEach(el => {
            if (!el) return;
            if (el === pane) {
                el.classList.add('show', 'active');
                el.classList.remove('fade');
            } else {
                el.classList.remove('show', 'active');
                el.classList.add('fade');
            }
        });
        [gameTab, questionsTab, addressbookTab, boardTab, applicationsTab].forEach((btn, i) => {
            if (!btn) return;
            const panes = [gameContent, questionsContent, addressbookContent, boardContent, applicationsContent];
            btn.classList.toggle('active', panes[i] === pane);
            if (panes[i] === pane) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        document.body.classList.toggle('board-open', pane === boardContent);
        arrangePlayerNavigation();
        updateBoardNavHeight();
        placeMobileToolbar(pane);
        if (wasBoardOpen && pane !== boardContent) window.scrollTo(0, boardReturnScrollY);
        if (pane === applicationsContent || (wasApplicationsOpen && pane !== boardContent)) window.scrollTo(0, 0);
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
        if (boardTab && boardContent) {
            boardTab.addEventListener('click', (e) => {
                e.preventDefault();
                showPane(boardContent);
                window.investigationBoard?.show();
            });
        }
        if (applicationsTab && applicationsContent) {
            applicationsTab.addEventListener('click', (e) => {
                e.preventDefault();
                showPane(applicationsContent);
            });
        }
    }
}

// ===== Address Book (players, read-only) =====
let playerAddressBookSections = null;
let playerAddressBookSectionsLoaded = false;
let playerAddressBookFilter = { category: 'Частные лица', letter_group: 'А-Б', q: '' };
let playerAddressBookRequestVersion = 0;
let playerAddressBookSearchTimer = null;

function choosePlayerDestination(entry) {
    const district = document.getElementById('districtSelect');
    const house = document.getElementById('houseNumber');
    const apartment = document.getElementById('apartmentNumber');
    if (!district || !house || !apartment) return;
    district.value = entry.district || '';
    selectedDistrict = district.value || null;
    house.value = String(entry.house_number || '');
    apartment.value = String(entry.apartment || '');
    const destination = document.getElementById('selectedDestination');
    if (destination) {
        destination.textContent = entry.name || `${entry.district} · Дом ${entry.house_number}`;
        destination.hidden = false;
    }
    document.getElementById('game-tab').click();
    document.querySelector('.location-search-card')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    document.getElementById('goBtn')?.focus({ preventScroll: true });
}

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
    const zoom = document.getElementById('applicationZoomBtn');
    if (zoom) { zoom.hidden = true; zoom.setAttribute('aria-pressed', 'false'); zoom.textContent = 'Увеличить'; }
    const download = document.getElementById('applicationDownloadBtn');
    if (download) { download.hidden = true; download.href = ''; download.download = ''; delete download.dataset.filename; }
    if (applicationObjectUrl) URL.revokeObjectURL(applicationObjectUrl);
    applicationObjectUrl = null;
}

function cancelApplicationRequest() {
    applicationController?.abort();
    applicationController = null;
}

function closeApplicationFolder() {
    applicationRequestId++;
    cancelApplicationRequest();
    clearApplicationPreview();
    const overlay = document.getElementById('applicationOverlay');
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = overlay.dataset.previousOverflow || '';
    if (applicationReturnFocus?.isConnected) applicationReturnFocus.focus({ preventScroll: true });
    else {
        const origin = [...document.querySelectorAll('.scenario-application-link')].find(element =>
            applicationReturnAddress && (applicationReturnAddress.briefing ? element.dataset.briefing === 'true' :
                element.dataset.addressId === String(applicationReturnAddress.addressId) &&
                element.dataset.number === String(applicationReturnAddress.number)) && element.getClientRects().length);
        (origin || document.getElementById(`${activePlayerPane}-tab`))?.focus({ preventScroll: true });
    }
    applicationReturnFocus = null;
    applicationReturnAddress = null;
}

function showApplicationFiles() {
    cancelApplicationRequest();
    clearApplicationPreview();
    document.getElementById('applicationPreview').style.display = 'none';
    document.getElementById('applicationFiles').style.display = 'block';
    document.getElementById('applicationBackBtn').disabled = true;
    document.getElementById('applicationTitle').textContent = document.getElementById('applicationOverlay').dataset.title || 'Приложение';
}

async function openApplicationFolder(addressId, number, fallbackUrl = '', briefing = false) {
    const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id || applicationScenarioId;
    const token = gameStorage.getItem('token');
    if (!scenarioId || !token) return;
    const requestId = ++applicationRequestId;
    const overlay = document.getElementById('applicationOverlay');
    overlay.dataset.title = briefing ? 'Брифинг дела' : `Приложение ${number}`;
    if (!overlay.classList.contains('is-open')) {
        overlay.dataset.previousOverflow = document.body.style.overflow;
        applicationReturnFocus = document.activeElement;
        applicationReturnAddress = { addressId, number, briefing };
    }
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    showApplicationFiles();
    document.getElementById('applicationCloseBtn')?.focus();
    const controller = applicationController = new AbortController();
    const list = document.getElementById('applicationFiles');
    list.textContent = 'Загрузка файлов…';
    const base = `${API_BASE}/applications/game/scenarios/${encodeURIComponent(scenarioId)}` +
        (briefing ? '/briefing' : `/addresses/${encodeURIComponent(addressId)}/${encodeURIComponent(number)}`);
    try {
        const response = await window.gameNetwork.fetch(base, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
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
    cancelApplicationRequest();
    const controller = applicationController = new AbortController();
    const preview = document.getElementById('applicationPreview');
    preview.style.display = 'block';
    document.getElementById('applicationFiles').style.display = 'none';
    document.getElementById('applicationBackBtn').disabled = false;
    const displayName = displayApplicationFileName(file, index);
    document.getElementById('applicationTitle').textContent = displayName;
    clearApplicationPreview();
    preview.textContent = 'Загрузка файла…';
    try {
        const response = await window.gameNetwork.fetch(`${base}/files/${encodeURIComponent(file.id)}${file.type.startsWith('image/') ? '?preview=1' : ''}`, {
            timeoutMs: 60000,
            signal: controller.signal,
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Не удалось загрузить файл');
        const blob = await response.blob();
        if (requestId !== applicationRequestId) return;
        clearApplicationPreview();
        applicationObjectUrl = URL.createObjectURL(blob);
        if (file.type === 'application/pdf') {
            const download = document.getElementById('applicationDownloadBtn');
            if (download) {
                download.href = applicationObjectUrl;
                download.download = download.dataset.filename = file.name || 'Материал.pdf';
                download.hidden = false;
            }
        }
        const viewer = document.createElement(file.type === 'application/pdf' ? 'iframe' : 'img');
        viewer.src = applicationObjectUrl;
        viewer.title = displayName;
        viewer.alt = displayName;
        if (viewer.tagName === 'IMG') {
            viewer.decoding = 'async';
            const zoom = document.getElementById('applicationZoomBtn');
            if (zoom) zoom.hidden = false;
            viewer.addEventListener('dblclick', toggleApplicationImageZoom);
        }
        preview.append(viewer);
    } catch (error) {
        if (requestId === applicationRequestId) preview.textContent = error.message;
    }
}

document.addEventListener('click', event => {
    const link = event.target.closest('.scenario-application-link');
    if (!link) return;
    event.preventDefault();
    openApplicationFolder(link.dataset.addressId, link.dataset.number, link.dataset.fallbackUrl || '', link.dataset.briefing === 'true');
});
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('applicationZoomBtn')?.addEventListener('click', toggleApplicationImageZoom);
    document.getElementById('applicationCloseBtn')?.addEventListener('click', closeApplicationFolder);
    document.getElementById('applicationBackBtn')?.addEventListener('click', () => { applicationRequestId++; showApplicationFiles(); });
    document.getElementById('applicationOverlay')?.addEventListener('click', event => {
        if (event.target.id === 'applicationOverlay') closeApplicationFolder();
    });
});
function toggleApplicationImageZoom() {
    const image = document.querySelector('#applicationPreview img');
    const button = document.getElementById('applicationZoomBtn');
    if (!image || !button) return;
    const enlarged = image.classList.toggle('is-enlarged');
    button.setAttribute('aria-pressed', String(enlarged));
    button.textContent = enlarged ? 'Вписать' : 'Увеличить';
}
document.addEventListener('keydown', event => {
    const overlay = document.getElementById('applicationOverlay');
    if (!overlay?.classList.contains('is-open')) return;
    if (event.key === 'Escape') closeApplicationFolder();
    if (event.key === 'Tab') {
        const controls = [...overlay.querySelectorAll('button:not(:disabled), a[href], iframe')].filter(element => element.getClientRects().length);
        if (!controls.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
});

async function loadPlayerAddressBookSectionsAndEntries() {
    const token = gameStorage.getItem('token');
    if (!token) return;
    try {
        const response = await window.gameNetwork.fetch(`${API_BASE}/game/address-book/sections`, {
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
                // Ignore older responses immediately, including while the debounce is pending.
                playerAddressBookRequestVersion++;
                clearTimeout(playerAddressBookSearchTimer);
                playerAddressBookSearchTimer = setTimeout(loadPlayerAddressBookEntries, 250);
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
    const requestVersion = ++playerAddressBookRequestVersion;
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
        const response = await window.gameNetwork.fetch(`${API_BASE}/game/address-book/entries?${qs}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (requestVersion !== playerAddressBookRequestVersion) return;
        if (!response.ok) throw new Error(data.error || 'Ошибка загрузки (' + response.status + ')');
        const entries = data.entries || [];

        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Ничего не найдено</td></tr>';
            return;
        }

        tbody.innerHTML = entries.map((e, index) => {
            const apartmentCell = `<td>${showApartment ? escapeHtmlPlayer(e.apartment) : ''}</td>`;
            return `<tr>
                <td>${escapeHtmlPlayer(e.district)}</td>
                <td>${escapeHtmlPlayer(e.house_number)}</td>
                ${apartmentCell}
                <td class="address-entry-main"><button type="button" class="address-entry-select" data-entry-index="${index}"><span>${escapeHtmlPlayer(e.name)}</span><span class="address-entry-location">${escapeHtmlPlayer(e.district)} · Дом ${escapeHtmlPlayer(e.house_number)}${e.apartment ? ', кв. ' + escapeHtmlPlayer(e.apartment) : ''}</span><span class="address-entry-action">Выбрать адрес <span aria-hidden="true">→</span></span></button></td>
                <td>${escapeHtmlPlayer(e.note)}</td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('.address-entry-select').forEach(button => {
            button.addEventListener('click', () => choosePlayerDestination(entries[Number(button.dataset.entryIndex)]));
        });
    } catch (err) {
        if (requestVersion !== playerAddressBookRequestVersion) return;
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
            const response = await window.gameNetwork.fetch(`${API_BASE}/room/${roomUser.room_id}/state`, {
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
            const response = await window.gameNetwork.fetch(`${API_BASE}/scenarios/active`);
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
        const questionsResponse = await window.gameNetwork.fetch(`${API_BASE}/questions/scenario/${scenarioId}`);
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
        return true;
    } catch (e) { return false; }
}

function updateAnswerDraftStatus() {
    const fields = document.querySelectorAll('#questionsList .answer-input');
    const filled = [...fields].filter(field => field.value.trim()).length;
    const summary = document.getElementById('answerDraftSummary');
    if (summary) summary.textContent = `${filled} из ${fields.length} заполнено`;
    const progress = document.getElementById('answerDraftProgress');
    if (progress) progress.value = filled;
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
    
    const questionsHtml = questions.map((question, index) => `
        <div class="question-item mb-4 p-3 border rounded">
            <div class="question-meta"><span>ВОПРОС ${String(index + 1).padStart(2, '0')}</span><span id="draftStatus_${question.id}" class="question-draft-status">${saved[question.id] ? 'Черновик сохранён' : 'Пока без ответа'}</span></div>
            <h5 class="mb-3">${escapeHtmlPlayer(question.question_text)}</h5>
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
    
    container.innerHTML = `<div class="answer-draft-summary"><span id="answerDraftSummary"></span><progress id="answerDraftProgress" max="${questions.length}" value="0" aria-label="Заполненные ответы"></progress></div>` + questionsHtml + bulkControlsHtml;
    updateAnswerDraftStatus();
    
    if (scenarioId && roomUser !== undefined) {
        container.querySelectorAll('.answer-input').forEach(textarea => {
            const questionId = textarea.dataset.questionId;
            textarea.addEventListener('input', () => {
                const savedSuccessfully = saveAnswer(scenarioId, roomUser, questionId, textarea.value);
                const status = document.getElementById(`draftStatus_${questionId}`);
                if (status) status.textContent = savedSuccessfully ? (textarea.value.trim() ? 'Черновик сохранён' : 'Пока без ответа') : 'Не удалось сохранить';
                updateAnswerDraftStatus();
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
            const response = await window.gameNetwork.fetch(`${API_BASE}/questions/answer`, {
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
        const response = await window.gameNetwork.fetch(`${API_BASE}/choices/game/scenarios/${currentScenarioId}/addresses/${addressId}/choices`, {
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
        
        const response = await window.gameNetwork.fetch(`${API_BASE}/choices/game/make-choice`, {
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
        tripHistoryVersion++;
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
        const choiceResponse = await window.gameNetwork.fetch(`${API_BASE}/choices/game/players/${roomUser.id}/scenarios/${scenarioId}/addresses/${addressId}/choice`, {
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
        const response = await window.gameNetwork.fetch(`${API_BASE}/choices/game/scenarios/${scenarioId}/addresses/${addressId}/choices`, {
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
        const response = await window.gameNetwork.fetch(`${API_BASE}/internet-cafe/game/${cafeAddressId}/pages`, {
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
        const response = await window.gameNetwork.fetch(`${API_BASE}/internet-cafe/game/pages/${pageId}`, {
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
