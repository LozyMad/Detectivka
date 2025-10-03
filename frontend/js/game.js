const API_BASE = '/api';
let selectedDistrict = null;
let roomState = null;
let roomTimerInterval = null;
let tripCount = 0;
let tripHistory = [];

// Initialize game
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupDistrictButtons();
    loadTripCount();
    loadTripHistory();
    loadScenarioInfo();
    
    // Setup tab switching
    setupTabSwitching();
    
    // Update every 30 seconds
    setInterval(() => {
        if (localStorage.getItem('roomUser')) {
            refreshRoomState();
        }
    }, 30000);
});

function checkAuth() {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const roomUser = JSON.parse(localStorage.getItem('roomUser') || 'null');
    
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

function setupDistrictButtons() {
    document.querySelectorAll('.district-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove active class from all buttons
            document.querySelectorAll('.district-btn').forEach(b => {
                b.classList.remove('btn-primary');
                b.classList.add('btn-outline-primary');
            });
            
            // Add active class to clicked button
            e.target.classList.remove('btn-outline-primary');
            e.target.classList.add('btn-primary');
            
            selectedDistrict = e.target.dataset.district;
        });
    });
}

async function visitLocation() {
    if (roomState && roomState.state !== 'running') {
        alert('РРіСЂР° РµС‰С‘ РЅРµ РЅР°С‡Р°Р»Р°СЃСЊ РёР»Рё СѓР¶Рµ Р·Р°РІРµСЂС€РёР»Р°СЃСЊ');
        return;
    }
    if (!selectedDistrict) {
        alert('Please select a district');
        return;
    }
    
    const houseNumber = document.getElementById('houseNumber').value.trim();
    if (!houseNumber) {
        alert('Please enter house number');
        return;
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј, РЅРµ Р±С‹Р»Р° Р»Рё СѓР¶Рµ СЃРѕРІРµСЂС€РµРЅР° РїРѕРµР·РґРєР° РІ СЌС‚Сѓ Р»РѕРєР°С†РёСЋ
    const existingTrip = tripHistory.find(trip => 
        trip.district === selectedDistrict && 
        trip.houseNumber === houseNumber
    );
    
    if (existingTrip) {
        alert('Р’С‹ СѓР¶Рµ РїРѕСЃРµС‰Р°Р»Рё СЌС‚Сѓ Р»РѕРєР°С†РёСЋ! РџСЂРѕРІРµСЂСЊС‚Рµ Р·Р°РїРёСЃРё Рѕ РїРѕРµР·РґРєР°С….');
        return;
    }
    
    const resultDiv = document.getElementById('result');
    const resultText = document.getElementById('resultText');
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/game/visit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                district: selectedDistrict,
                house_number: houseNumber
            })
        });
        
        const data = await response.json();
        
        // РЈРІРµР»РёС‡РёРІР°РµРј СЃС‡РµС‚С‡РёРє РїРѕРµР·РґРѕРє РЅРµР·Р°РІРёСЃРёРјРѕ РѕС‚ СЂРµР·СѓР»СЊС‚Р°С‚Р°
        tripCount++;
        updateTripCounter();
        
        if (response.ok) {
            // Р”РѕР±Р°РІР»СЏРµРј РїРѕРµР·РґРєСѓ РІ РёСЃС‚РѕСЂРёСЋ
            const trip = {
                district: selectedDistrict,
                houseNumber: houseNumber,
                success: data.success,
                description: data.description || null,
                timestamp: new Date().toISOString(),
                alreadyVisited: false, // РўРµРїРµСЂСЊ РІСЃРµ РїРѕРµР·РґРєРё СѓРЅРёРєР°Р»СЊРЅС‹Рµ
                address_id: data.address_id || null,
                visited_location_id: data.visited_location_id || null
            };
            tripHistory.unshift(trip); // Р”РѕР±Р°РІР»СЏРµРј РІ РЅР°С‡Р°Р»Рѕ РјР°СЃСЃРёРІР°
            updateTripHistory();
            
            // Clear input
            document.getElementById('houseNumber').value = '';
            
            // РџСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹Рµ РІС‹Р±РѕСЂС‹ РґР»СЏ СЌС‚РѕРіРѕ Р°РґСЂРµСЃР°
            if (data.success && data.address_id) {
                console.log('Visit successful, checking for choices:', data);
                checkForInteractiveChoices(data.address_id, data.description, data.visited_location_id);
            }
            
        } else {
            // Р”РѕР±Р°РІР»СЏРµРј РЅРµСѓРґР°С‡РЅСѓСЋ РїРѕРµР·РґРєСѓ РІ РёСЃС‚РѕСЂРёСЋ
            const trip = {
                district: selectedDistrict,
                houseNumber: houseNumber,
                success: false,
                description: data.error || 'РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР°',
                timestamp: new Date().toISOString(),
                alreadyVisited: false
            };
            tripHistory.unshift(trip);
            updateTripHistory();
            
            // Clear input
            document.getElementById('houseNumber').value = '';
        }
    } catch (error) {
        console.error('Error visiting location:', error);
        
        // РЈРІРµР»РёС‡РёРІР°РµРј СЃС‡РµС‚С‡РёРє РїРѕРµР·РґРѕРє РґР°Р¶Рµ РїСЂРё РѕС€РёР±РєРµ
        tripCount++;
        updateTripCounter();
        
        // Р”РѕР±Р°РІР»СЏРµРј РїРѕРµР·РґРєСѓ СЃ РѕС€РёР±РєРѕР№ РІ РёСЃС‚РѕСЂРёСЋ
        const trip = {
            district: selectedDistrict,
            houseNumber: houseNumber,
            success: false,
            description: 'РћС€РёР±РєР° СЃРѕРµРґРёРЅРµРЅРёСЏ',
            timestamp: new Date().toISOString(),
            alreadyVisited: false
        };
        tripHistory.unshift(trip);
        updateTripHistory();
        
        // Clear input
        document.getElementById('houseNumber').value = '';
    }
}

// Р—Р°РіСЂСѓР·РєР° СЃС‡РµС‚С‡РёРєР° РїРѕРµР·РґРѕРє
async function loadTripCount() {
    try {
        const token = localStorage.getItem('token');
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

// РћР±РЅРѕРІР»РµРЅРёРµ СЃС‡РµС‚С‡РёРєР° РїРѕРµР·РґРѕРє
function updateTripCounter() {
    const counter = document.getElementById('tripCounter');
    if (counter) {
        counter.textContent = `Trips: ${tripCount}`;
    }
}

// Р—Р°РіСЂСѓР·РєР° РёСЃС‚РѕСЂРёРё РїРѕРµР·РґРѕРє
async function loadTripHistory() {
    try {
        const token = localStorage.getItem('token');
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
        
        // РџСЂРµРѕР±СЂР°Р·СѓРµРј РїРѕРїС‹С‚РєРё РІ С„РѕСЂРјР°С‚ РёСЃС‚РѕСЂРёРё РїРѕРµР·РґРѕРє
        tripHistory = await Promise.all(attempts.map(async (attempt) => {
            let description = attempt.found ? (attempt.address_description || 'Р›РѕРєР°С†РёСЏ РЅР°Р№РґРµРЅР°') : 'РЈР»РёРє РЅРµС‚';
            
            // Р•СЃР»Рё СЌС‚Рѕ СѓСЃРїРµС€РЅР°СЏ РїРѕРµР·РґРєР° СЃ address_id, РїСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё СЃРґРµР»Р°РЅРЅС‹Р№ РІС‹Р±РѕСЂ
            if (attempt.found && attempt.address_id && attempt.visited_location_id) {
                try {
                    const roomUser = JSON.parse(localStorage.getItem('roomUser'));
                    const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
                    
                    if (roomUser && roomUser.id && scenarioId) {
                        const choiceResponse = await fetch(`${API_BASE}/choices/game/players/${roomUser.id}/scenarios/${scenarioId}/addresses/${attempt.address_id}/choice`, {
                            headers: {
                                'Authorization': `Bearer ${localStorage.getItem('token')}`
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
                district: attempt.district,
                houseNumber: attempt.house_number,
                success: attempt.found,
                description: description,
                timestamp: attempt.attempted_at,
                alreadyVisited: false,
                address_id: attempt.address_id || null,
                visited_location_id: attempt.visited_location_id || null
            };
        }));
        
        updateTripHistory();
        
    } catch (error) {
        console.error('Error loading trip history:', error);
        tripHistory = [];
        updateTripHistory();
    }
}

// РћР±РЅРѕРІР»РµРЅРёРµ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РёСЃС‚РѕСЂРёРё РїРѕРµР·РґРѕРє
function updateTripHistory() {
    const container = document.getElementById('tripHistory');
    if (!container) return;
    
    if (tripHistory.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">РСЃС‚РѕСЂРёСЏ РїРѕРµР·РґРѕРє РїСѓСЃС‚Р°</p>';
        return;
    }

    const items = tripHistory.map(trip => `
        <div class="trip-item ${trip.success ? 'success' : 'failure'}">
            <div class="trip-info">
                <span class="badge district-badge bg-primary">${trip.district}</span>
                <span class="ms-2">Р”РѕРј ${trip.houseNumber}</span>
                <span class="ms-2 text-muted">${formatTripTime(trip.timestamp)}</span>
                ${trip.success && trip.address_id ? 
                    `<button class="btn btn-sm btn-outline-warning ms-2" onclick="openChoiceHistory(${trip.address_id}, '${trip.description}', ${trip.visited_location_id || 'null'})" title="РРЅС‚РµСЂР°РєС‚РёРІРЅС‹Рµ РІС‹Р±РѕСЂС‹">
                        <i class="fas fa-question-circle"></i>
                    </button>` : ''
                }
            </div>
            <div class="trip-description">
                ${trip.success ? 
                    `<strong>РќР°Р№РґРµРЅРѕ:</strong> ${trip.description}` : 
                    `<strong>РЈР»РёРє РЅРµС‚</strong>`
                }
            </div>
        </div>
    `).join('');

    container.innerHTML = items;
}

// Р¤РѕСЂРјР°С‚РёСЂРѕРІР°РЅРёРµ РІСЂРµРјРµРЅРё РїРѕРµР·РґРєРё
function formatTripTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'С‚РѕР»СЊРєРѕ С‡С‚Рѕ';
    if (diffMins < 60) return `${diffMins} РјРёРЅ. РЅР°Р·Р°Рґ`;
    if (diffHours < 24) return `${diffHours} С‡. РЅР°Р·Р°Рґ`;
    
    return date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Р—Р°РіСЂСѓР·РєР° РёРЅС„РѕСЂРјР°С†РёРё Рѕ СЃС†РµРЅР°СЂРёРё
async function loadScenarioInfo() {
    try {
        const roomUser = JSON.parse(localStorage.getItem('roomUser') || 'null');
        const room = JSON.parse(localStorage.getItem('room') || 'null');
        
        if (roomUser && roomUser.room_id) {
            // Р”Р»СЏ РёРіСЂРѕРєРѕРІ РєРѕРјРЅР°С‚С‹ РїРѕР»СѓС‡Р°РµРј РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ СЃС†РµРЅР°СЂРёРё РёР· РєРѕРјРЅР°С‚С‹
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/room/${roomUser.room_id}/state`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Room state data:', data);
                
                // РџСЂРѕРІРµСЂСЏРµРј РЅРµСЃРєРѕР»СЊРєРѕ РІРѕР·РјРѕР¶РЅС‹С… РёСЃС‚РѕС‡РЅРёРєРѕРІ РЅР°Р·РІР°РЅРёСЏ СЃС†РµРЅР°СЂРёСЏ
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
                    document.getElementById('scenarioTitle').textContent = scenarioName;
                    console.log('Scenario name loaded:', scenarioName);
                } else {
                    document.getElementById('scenarioTitle').textContent = 'РЎС†РµРЅР°СЂРёР№ РЅРµ РѕРїСЂРµРґРµР»РµРЅ';
                    console.log('No scenario name found in data:', data);
                }
            } else {
                document.getElementById('scenarioTitle').textContent = 'РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РєРѕРјРЅР°С‚С‹';
                console.error('Failed to load room state:', response.status);
            }
        } else {
            // Р”Р»СЏ РѕР±С‹С‡РЅС‹С… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ РїРѕР»СѓС‡Р°РµРј Р°РєС‚РёРІРЅС‹Р№ СЃС†РµРЅР°СЂРёР№
            const response = await fetch(`${API_BASE}/scenarios/active`);
            
            if (response.ok) {
                const data = await response.json();
                document.getElementById('scenarioTitle').textContent = data.scenario.name;
            } else {
                document.getElementById('scenarioTitle').textContent = 'РќРµС‚ Р°РєС‚РёРІРЅРѕРіРѕ СЃС†РµРЅР°СЂРёСЏ';
            }
        }
    } catch (error) {
        console.error('Error loading scenario info:', error);
        document.getElementById('scenarioTitle').textContent = 'РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё';
    }
}

// ===== Room timer =====
async function initRoomTimer() {
    await refreshRoomState();
    await loadScenarioInfo(); // Р—Р°РіСЂСѓР¶Р°РµРј РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ СЃС†РµРЅР°СЂРёРё РїСЂРё РёРЅРёС†РёР°Р»РёР·Р°С†РёРё С‚Р°Р№РјРµСЂР°
    renderTimer();
    if (roomTimerInterval) clearInterval(roomTimerInterval);
    roomTimerInterval = setInterval(async () => {
        await refreshRoomState();
        renderTimer();
    }, 1000);
}

async function refreshRoomState() {
    try {
        const room = JSON.parse(localStorage.getItem('room') || 'null');
        if (!room) return;
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/room/${room.id}/state`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!res.ok) return;
        roomState = await res.json();
        
        // РћР±РЅРѕРІР»СЏРµРј РЅР°Р·РІР°РЅРёРµ СЃС†РµРЅР°СЂРёСЏ РїСЂРё РєР°Р¶РґРѕРј РѕР±РЅРѕРІР»РµРЅРёРё СЃРѕСЃС‚РѕСЏРЅРёСЏ РєРѕРјРЅР°С‚С‹
        if (roomState) {
            let scenarioName = null;
            if (roomState.scenario_name) {
                scenarioName = roomState.scenario_name;
            } else if (roomState.room && roomState.room.scenario_name) {
                scenarioName = roomState.room.scenario_name;
            }
            
            if (scenarioName) {
                document.getElementById('scenarioTitle').textContent = scenarioName;
                console.log('Scenario name updated from room state:', scenarioName);
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
    
    if (state === 'pending') {
        timerDisplay.textContent = 'РћР¶РёРґР°РЅРёРµ';
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
        timerDisplay.textContent = `РџР°СѓР·Р° ${minutes}:${seconds.toString().padStart(2, '0')}`;
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-warning text-dark fs-6';
    } else if (state === 'finished') {
        timerDisplay.textContent = 'Р—Р°РІРµСЂС€РµРЅРѕ';
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-danger text-dark fs-6';
    }
}


function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
}

// ===== Tab Switching =====
function setupTabSwitching() {
    // Р”РѕР±Р°РІР»СЏРµРј РѕР±СЂР°Р±РѕС‚С‡РёРєРё РґР»СЏ РїРµСЂРµРєР»СЋС‡РµРЅРёСЏ РІРєР»Р°РґРѕРє
    const gameTab = document.getElementById('game-tab');
    const questionsTab = document.getElementById('questions-tab');
    const gameContent = document.getElementById('game');
    const questionsContent = document.getElementById('questions');
    
    if (gameTab && questionsTab && gameContent && questionsContent) {
        gameTab.addEventListener('click', (e) => {
            e.preventDefault();
            // РџРµСЂРµРєР»СЋС‡Р°РµРј Р°РєС‚РёРІРЅС‹Рµ СЃРѕСЃС‚РѕСЏРЅРёСЏ РєРЅРѕРїРѕРє
            gameTab.classList.add('active');
            questionsTab.classList.remove('active');
            
            // РџРµСЂРµРєР»СЋС‡Р°РµРј РІРёРґРёРјРѕСЃС‚СЊ РєРѕРЅС‚РµРЅС‚Р°
            gameContent.classList.add('show', 'active');
            gameContent.classList.remove('fade');
            questionsContent.classList.remove('show', 'active');
            questionsContent.classList.add('fade');
        });
        
        questionsTab.addEventListener('click', (e) => {
            e.preventDefault();
            // РџРµСЂРµРєР»СЋС‡Р°РµРј Р°РєС‚РёРІРЅС‹Рµ СЃРѕСЃС‚РѕСЏРЅРёСЏ РєРЅРѕРїРѕРє
            questionsTab.classList.add('active');
            gameTab.classList.remove('active');
            
            // РџРµСЂРµРєР»СЋС‡Р°РµРј РІРёРґРёРјРѕСЃС‚СЊ РєРѕРЅС‚РµРЅС‚Р°
            questionsContent.classList.add('show', 'active');
            questionsContent.classList.remove('fade');
            gameContent.classList.remove('show', 'active');
            gameContent.classList.add('fade');
            
            // Р—Р°РіСЂСѓР¶Р°РµРј РІРѕРїСЂРѕСЃС‹
            loadQuestions();
        });
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
        
        questionsListElement.innerHTML = '<p class="text-muted text-center">Р—Р°РіСЂСѓР·РєР° РІРѕРїСЂРѕСЃРѕРІ...</p>';
        
        const roomUser = JSON.parse(localStorage.getItem('roomUser') || 'null');
        let scenarioId;
        
        if (roomUser && roomUser.room_id) {
            // Р”Р»СЏ РёРіСЂРѕРєРѕРІ РєРѕРјРЅР°С‚С‹ РїРѕР»СѓС‡Р°РµРј scenario_id РёР· РєРѕРјРЅР°С‚С‹
            const token = localStorage.getItem('token');
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
            // Р”Р»СЏ РѕР±С‹С‡РЅС‹С… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ РїРѕР»СѓС‡Р°РµРј Р°РєС‚РёРІРЅС‹Р№ СЃС†РµРЅР°СЂРёР№
            const response = await fetch(`${API_BASE}/scenarios/active`);
            if (response.ok) {
                const data = await response.json();
                scenarioId = data.scenario.id;
            }
        }
        
        if (!scenarioId) {
            questionsListElement.innerHTML = '<p class="text-muted text-center">РќРµС‚ Р°РєС‚РёРІРЅРѕРіРѕ СЃС†РµРЅР°СЂРёСЏ</p>';
            return;
        }
        
        // Р—Р°РіСЂСѓР¶Р°РµРј РІРѕРїСЂРѕСЃС‹ РґР»СЏ СЃС†РµРЅР°СЂРёСЏ
        const questionsResponse = await fetch(`${API_BASE}/questions/scenario/${scenarioId}`);
        if (questionsResponse.ok) {
            const questionsData = await questionsResponse.json();
            displayQuestions(questionsData.questions);
        } else {
            questionsListElement.innerHTML = '<p class="text-muted text-center">РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РІРѕРїСЂРѕСЃРѕРІ</p>';
        }
    } catch (error) {
        console.error('Error loading questions:', error);
        const questionsListElement = document.getElementById('questionsList');
        if (questionsListElement) {
            questionsListElement.innerHTML = '<p class="text-muted text-center">РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РІРѕРїСЂРѕСЃРѕРІ</p>';
        }
    }
}

function displayQuestions(questions) {
    const container = document.getElementById('questionsList');
    
    if (!questions || questions.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">РќРµС‚ РІРѕРїСЂРѕСЃРѕРІ РґР»СЏ СЌС‚РѕРіРѕ СЃС†РµРЅР°СЂРёСЏ</p>';
        return;
    }
    
    container.innerHTML = questions.map(question => `
        <div class="question-item mb-4 p-3 border rounded">
            <h5 class="mb-3">${question.question_text}</h5>
            <div class="mb-3">
                <label for="answer_${question.id}" class="form-label">Р’Р°С€ РѕС‚РІРµС‚:</label>
                <textarea class="form-control" id="answer_${question.id}" rows="3" placeholder="Р’РІРµРґРёС‚Рµ РІР°С€ РѕС‚РІРµС‚..."></textarea>
            </div>
            <button class="btn btn-primary" onclick="submitAnswer(${question.id})">
                <i class="fas fa-paper-plane me-1"></i>РћС‚РїСЂР°РІРёС‚СЊ РѕС‚РІРµС‚
            </button>
            <div id="answer_status_${question.id}" class="mt-2"></div>
        </div>
    `).join('');
}

async function submitAnswer(questionId) {
    const answerText = document.getElementById(`answer_${questionId}`).value.trim();
    const statusDiv = document.getElementById(`answer_status_${questionId}`);
    
    if (!answerText) {
        statusDiv.innerHTML = '<div class="alert alert-warning">Р’РІРµРґРёС‚Рµ РѕС‚РІРµС‚</div>';
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/questions/answer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                question_id: questionId,
                answer_text: answerText
            })
        });
        
        if (response.ok) {
            statusDiv.innerHTML = '<div class="alert alert-success">РћС‚РІРµС‚ СЃРѕС…СЂР°РЅРµРЅ!</div>';
            document.getElementById(`answer_${questionId}`).disabled = true;
            document.querySelector(`button[onclick="submitAnswer(${questionId})"]`).disabled = true;
        } else {
            const error = await response.json();
            statusDiv.innerHTML = `<div class="alert alert-danger">РћС€РёР±РєР°: ${error.error}</div>`;
        }
    } catch (error) {
        console.error('Error submitting answer:', error);
        statusDiv.innerHTML = '<div class="alert alert-danger">РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё РѕС‚РІРµС‚Р°</div>';
    }
}

// ===== РРќРўР•Р РђРљРўРР’РќР«Р• Р’Р«Р‘РћР Р« =====

// Р“Р»РѕР±Р°Р»СЊРЅС‹Рµ РїРµСЂРµРјРµРЅС‹ РґР»СЏ РІС‹Р±РѕСЂРѕРІ
let currentAddressId = null;
let currentVisitedLocationId = null;
let currentScenarioId = null;

// РџСЂРѕРІРµСЂРёС‚СЊ, РµСЃС‚СЊ Р»Рё РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹Рµ РІС‹Р±РѕСЂС‹ РґР»СЏ Р°РґСЂРµСЃР°
async function checkForInteractiveChoices(addressId, description, visitedLocationId) {
    try {
        // РџРѕР»СѓС‡Р°РµРј ID СЃС†РµРЅР°СЂРёСЏ РёР· СЃРѕСЃС‚РѕСЏРЅРёСЏ РєРѕРјРЅР°С‚С‹
        const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
        if (!roomState || !scenarioId) {
            console.log('No scenario ID available', roomState);
            return;
        }
        
        currentAddressId = addressId;
        currentVisitedLocationId = visitedLocationId;
        currentScenarioId = scenarioId;
        
        console.log('Checking for choices:', { scenarioId: currentScenarioId, addressId });
        const token = localStorage.getItem('token');
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
        
        if (data.choices && data.choices.length > 0) {
            showInteractiveChoiceModal(data.choices, description);
        }
        
    } catch (error) {
        console.error('Error checking for interactive choices:', error);
    }
}

// РџРѕРєР°Р·Р°С‚СЊ РјРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ СЃ РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹РјРё РІС‹Р±РѕСЂР°РјРё
function showInteractiveChoiceModal(choices, description) {
    // РћР±РЅРѕРІРёС‚СЊ РѕРїРёСЃР°РЅРёРµ Р°РґСЂРµСЃР°
    document.getElementById('addressDescription').textContent = description || 'Р’С‹ РЅР°С€Р»Рё РёРЅС‚РµСЂРµСЃРЅРѕРµ РјРµСЃС‚Рѕ...';
    
    // РЎРѕР·РґР°С‚СЊ РєРЅРѕРїРєРё РІС‹Р±РѕСЂРѕРІ
    const choiceButtons = document.getElementById('choiceButtons');
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
        
        // Р”РѕР±Р°РІРёС‚СЊ hover СЌС„С„РµРєС‚С‹
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
    
    // РџРѕРєР°Р·Р°С‚СЊ РјРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ
    const modal = new bootstrap.Modal(document.getElementById('choiceModal'), {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
}

// РЎРґРµР»Р°С‚СЊ РІС‹Р±РѕСЂ РёРіСЂРѕРєР°
async function makePlayerChoice(choiceId) {
    try {
        const token = localStorage.getItem('token');
        const roomUser = JSON.parse(localStorage.getItem('roomUser'));
        
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
        
        // РџРѕРєР°Р·Р°С‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚ РІС‹Р±РѕСЂР°
        showChoiceResponse(data.response);
        
    } catch (error) {
        console.error('Error making choice:', error);
        
        // РџРѕРєР°Р·Р°С‚СЊ РѕС€РёР±РєСѓ
        document.getElementById('choiceOptions').style.display = 'none';
        document.getElementById('choiceResponse').style.display = 'block';
        document.getElementById('responseText').textContent = 'РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР° РїСЂРё РѕР±СЂР°Р±РѕС‚РєРµ РІР°С€РµРіРѕ РІС‹Р±РѕСЂР°.';
    }
}

// РџРѕРєР°Р·Р°С‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚ РІС‹Р±РѕСЂР°
function showChoiceResponse(responseText) {
    // РЎРєСЂС‹С‚СЊ РІР°СЂРёР°РЅС‚С‹ РІС‹Р±РѕСЂР°
    document.getElementById('choiceOptions').style.display = 'none';
    
    // РџРѕРєР°Р·Р°С‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚
    document.getElementById('choiceResponse').style.display = 'block';
    document.getElementById('responseText').textContent = responseText;
}

// РћС‚РєСЂС‹С‚СЊ РІС‹Р±РѕСЂС‹ РёР· РёСЃС‚РѕСЂРёРё РїРѕРµР·РґРѕРє
async function openChoiceHistory(addressId, description, visitedLocationId) {
    try {
        const scenarioId = roomState?.room?.scenario_id || roomState?.scenario_id;
        if (!scenarioId) {
            console.log('No scenario ID available');
            return;
        }
        
        const roomUser = JSON.parse(localStorage.getItem('roomUser'));
        if (!roomUser || !roomUser.id) {
            console.log('No room user found');
            return;
        }
        
        // РџСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё СѓР¶Рµ СЃРґРµР»Р°РЅРЅС‹Р№ РІС‹Р±РѕСЂ
        const token = localStorage.getItem('token');
        const choiceResponse = await fetch(`${API_BASE}/choices/game/players/${roomUser.id}/scenarios/${scenarioId}/addresses/${addressId}/choice`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (choiceResponse.ok) {
            const choiceData = await choiceResponse.json();
            
            if (choiceData.choice) {
                // РџРѕРєР°Р·С‹РІР°РµРј СѓР¶Рµ СЃРґРµР»Р°РЅРЅС‹Р№ РІС‹Р±РѕСЂ
                showExistingChoice(choiceData.choice, description);
                return;
            }
        }
        
        // Р•СЃР»Рё РІС‹Р±РѕСЂ РЅРµ Р±С‹Р» СЃРґРµР»Р°РЅ, РїРѕРєР°Р·С‹РІР°РµРј РґРѕСЃС‚СѓРїРЅС‹Рµ РІР°СЂРёР°РЅС‚С‹
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
                alert('Р”Р»СЏ СЌС‚РѕР№ Р»РѕРєР°С†РёРё РЅРµС‚ РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹С… РІС‹Р±РѕСЂРѕРІ');
            }
        } else {
            alert('РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РІР°СЂРёР°РЅС‚С‹ РІС‹Р±РѕСЂР°');
        }
        
    } catch (error) {
        console.error('Error opening choice history:', error);
        alert('РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РІС‹Р±РѕСЂРѕРІ');
    }
}

// РџРѕРєР°Р·Р°С‚СЊ СѓР¶Рµ СЃРґРµР»Р°РЅРЅС‹Р№ РІС‹Р±РѕСЂ
function showExistingChoice(choice, description) {
    // РћР±РЅРѕРІРёС‚СЊ РѕРїРёСЃР°РЅРёРµ Р°РґСЂРµСЃР°
    document.getElementById('addressDescription').textContent = description || 'Р›РѕРєР°С†РёСЏ РЅР°Р№РґРµРЅР°';
    
    // РЎРєСЂС‹С‚СЊ РІР°СЂРёР°РЅС‚С‹ РІС‹Р±РѕСЂР°
    document.getElementById('choiceOptions').style.display = 'none';
    
    // РџРѕРєР°Р·Р°С‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚
    document.getElementById('choiceResponse').style.display = 'block';
    document.getElementById('responseText').innerHTML = `
        <strong>Р’Р°С€ РІС‹Р±РѕСЂ:</strong> ${choice.choice_text}<br>
        <strong>Р РµР·СѓР»СЊС‚Р°С‚:</strong> ${choice.response_text}
    `;
    
    // РџРѕРєР°Р·Р°С‚СЊ РјРѕРґР°Р»СЊРЅРѕРµ РѕРєРЅРѕ
    const modal = new bootstrap.Modal(document.getElementById('choiceModal'));
    modal.show();
}

// РЎР±СЂРѕСЃ РјРѕРґР°Р»СЊРЅРѕРіРѕ РѕРєРЅР° РїСЂРё Р·Р°РєСЂС‹С‚РёРё
document.getElementById('choiceModal').addEventListener('hidden.bs.modal', function () {
    // РЎР±СЂРѕСЃ СЃРѕСЃС‚РѕСЏРЅРёСЏ РјРѕРґР°Р»СЊРЅРѕРіРѕ РѕРєРЅР°
    document.getElementById('choiceOptions').style.display = 'block';
    document.getElementById('choiceResponse').style.display = 'none';
    document.getElementById('choiceButtons').innerHTML = '';
    
    // РЎР±СЂРѕСЃ РїРµСЂРµРјРµРЅРЅС‹С…
    currentAddressId = null;
    currentVisitedLocationId = null;
    currentScenarioId = null;
});
