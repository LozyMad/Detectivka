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
        alert('Р ВР С–РЎР‚Р В° Р ВµРЎвЂ°РЎвЂ Р Р…Р Вµ Р Р…Р В°РЎвЂЎР В°Р В»Р В°РЎРѓРЎРЉ Р С‘Р В»Р С‘ РЎС“Р В¶Р Вµ Р В·Р В°Р Р†Р ВµРЎР‚РЎв‚¬Р С‘Р В»Р В°РЎРѓРЎРЉ');
        return;
    }
    if (!selectedDistrict) {
        alert('Пожалуйста, выберите район');
        return;
    }
    
    const houseNumber = document.getElementById('houseNumber').value.trim();
    if (!houseNumber) {
        alert('Пожалуйста, введите номер дома');
        return;
    }
    
    // Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С, Р Р…Р Вµ Р В±РЎвЂ№Р В»Р В° Р В»Р С‘ РЎС“Р В¶Р Вµ РЎРѓР С•Р Р†Р ВµРЎР‚РЎв‚¬Р ВµР Р…Р В° Р С—Р С•Р ВµР В·Р Т‘Р С”Р В° Р Р† РЎРЊРЎвЂљРЎС“ Р В»Р С•Р С”Р В°РЎвЂ Р С‘РЎР‹
    const existingTrip = tripHistory.find(trip => 
        trip.district === selectedDistrict && 
        trip.houseNumber === houseNumber
    );
    
    if (existingTrip) {
        alert('Р вЂ™РЎвЂ№ РЎС“Р В¶Р Вµ Р С—Р С•РЎРѓР ВµРЎвЂ°Р В°Р В»Р С‘ РЎРЊРЎвЂљРЎС“ Р В»Р С•Р С”Р В°РЎвЂ Р С‘РЎР‹! Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЉРЎвЂљР Вµ Р В·Р В°Р С—Р С‘РЎРѓР С‘ Р С• Р С—Р С•Р ВµР В·Р Т‘Р С”Р В°РЎвЂ¦.');
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
        
        // Р Р€Р Р†Р ВµР В»Р С‘РЎвЂЎР С‘Р Р†Р В°Р ВµР С РЎРѓРЎвЂЎР ВµРЎвЂљРЎвЂЎР С‘Р С” Р С—Р С•Р ВµР В·Р Т‘Р С•Р С” Р Р…Р ВµР В·Р В°Р Р†Р С‘РЎРѓР С‘Р СР С• Р С•РЎвЂљ РЎР‚Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљР В°
        tripCount++;
        updateTripCounter();
        
        if (response.ok) {
            // Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р С—Р С•Р ВµР В·Р Т‘Р С”РЎС“ Р Р† Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘РЎР‹
            const trip = {
                district: selectedDistrict,
                houseNumber: houseNumber,
                success: data.success,
                description: data.description || null,
                timestamp: new Date().toISOString(),
                alreadyVisited: false, // Р СћР ВµР С—Р ВµРЎР‚РЎРЉ Р Р†РЎРѓР Вµ Р С—Р С•Р ВµР В·Р Т‘Р С”Р С‘ РЎС“Р Р…Р С‘Р С”Р В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ
                address_id: data.address_id || null,
                visited_location_id: data.visited_location_id || null
            };
            tripHistory.unshift(trip); // Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р Р† Р Р…Р В°РЎвЂЎР В°Р В»Р С• Р СР В°РЎРѓРЎРѓР С‘Р Р†Р В°
            updateTripHistory();
            
            // Clear input
            document.getElementById('houseNumber').value = '';
            
            // Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С, Р ВµРЎРѓРЎвЂљРЎРЉ Р В»Р С‘ Р С‘Р Р…РЎвЂљР ВµРЎР‚Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р Р†РЎвЂ№Р В±Р С•РЎР‚РЎвЂ№ Р Т‘Р В»РЎРЏ РЎРЊРЎвЂљР С•Р С–Р С• Р В°Р Т‘РЎР‚Р ВµРЎРѓР В°
            if (data.success && data.address_id) {
                console.log('Visit successful, checking for choices:', data);
                checkForInteractiveChoices(data.address_id, data.description, data.visited_location_id);
            }
            
        } else {
            // Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р Р…Р ВµРЎС“Р Т‘Р В°РЎвЂЎР Р…РЎС“РЎР‹ Р С—Р С•Р ВµР В·Р Т‘Р С”РЎС“ Р Р† Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘РЎР‹
            const trip = {
                district: selectedDistrict,
                houseNumber: houseNumber,
                success: false,
                description: data.error || 'Р СџРЎР‚Р С•Р С‘Р В·Р С•РЎв‚¬Р В»Р В° Р С•РЎв‚¬Р С‘Р В±Р С”Р В°',
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
        
        // Р Р€Р Р†Р ВµР В»Р С‘РЎвЂЎР С‘Р Р†Р В°Р ВµР С РЎРѓРЎвЂЎР ВµРЎвЂљРЎвЂЎР С‘Р С” Р С—Р С•Р ВµР В·Р Т‘Р С•Р С” Р Т‘Р В°Р В¶Р Вµ Р С—РЎР‚Р С‘ Р С•РЎв‚¬Р С‘Р В±Р С”Р Вµ
        tripCount++;
        updateTripCounter();
        
        // Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р С—Р С•Р ВµР В·Р Т‘Р С”РЎС“ РЎРѓ Р С•РЎв‚¬Р С‘Р В±Р С”Р С•Р в„– Р Р† Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘РЎР‹
        const trip = {
            district: selectedDistrict,
            houseNumber: houseNumber,
            success: false,
            description: 'Р С›РЎв‚¬Р С‘Р В±Р С”Р В° РЎРѓР С•Р ВµР Т‘Р С‘Р Р…Р ВµР Р…Р С‘РЎРЏ',
            timestamp: new Date().toISOString(),
            alreadyVisited: false
        };
        tripHistory.unshift(trip);
        updateTripHistory();
        
        // Clear input
        document.getElementById('houseNumber').value = '';
    }
}

// Р вЂ”Р В°Р С–РЎР‚РЎС“Р В·Р С”Р В° РЎРѓРЎвЂЎР ВµРЎвЂљРЎвЂЎР С‘Р С”Р В° Р С—Р С•Р ВµР В·Р Т‘Р С•Р С”
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

// Р С›Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ РЎРѓРЎвЂЎР ВµРЎвЂљРЎвЂЎР С‘Р С”Р В° Р С—Р С•Р ВµР В·Р Т‘Р С•Р С”
function updateTripCounter() {
    const counter = document.getElementById('tripCounter');
    if (counter) {
        counter.textContent = `Поездок: ${tripCount}`;
    }
}

// Р вЂ”Р В°Р С–РЎР‚РЎС“Р В·Р С”Р В° Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘Р С‘ Р С—Р С•Р ВµР В·Р Т‘Р С•Р С”
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
        
        // Р СџРЎР‚Р ВµР С•Р В±РЎР‚Р В°Р В·РЎС“Р ВµР С Р С—Р С•Р С—РЎвЂ№РЎвЂљР С”Р С‘ Р Р† РЎвЂћР С•РЎР‚Р СР В°РЎвЂљ Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘Р С‘ Р С—Р С•Р ВµР В·Р Т‘Р С•Р С”
        tripHistory = await Promise.all(attempts.map(async (attempt) => {
            let description = attempt.found ? (attempt.address_description || 'Р вЂєР С•Р С”Р В°РЎвЂ Р С‘РЎРЏ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…Р В°') : 'Р Р€Р В»Р С‘Р С” Р Р…Р ВµРЎвЂљ';
            
            // Р вЂўРЎРѓР В»Р С‘ РЎРЊРЎвЂљР С• РЎС“РЎРѓР С—Р ВµРЎв‚¬Р Р…Р В°РЎРЏ Р С—Р С•Р ВµР В·Р Т‘Р С”Р В° РЎРѓ address_id, Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С, Р ВµРЎРѓРЎвЂљРЎРЉ Р В»Р С‘ РЎРѓР Т‘Р ВµР В»Р В°Р Р…Р Р…РЎвЂ№Р в„– Р Р†РЎвЂ№Р В±Р С•РЎР‚
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

// Р С›Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ Р С•РЎвЂљР С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘РЎРЏ Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘Р С‘ Р С—Р С•Р ВµР В·Р Т‘Р С•Р С”
function updateTripHistory() {
    const container = document.getElementById('tripHistory');
    if (!container) return;
    
    if (tripHistory.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">Р ВРЎРѓРЎвЂљР С•РЎР‚Р С‘РЎРЏ Р С—Р С•Р ВµР В·Р Т‘Р С•Р С” Р С—РЎС“РЎРѓРЎвЂљР В°</p>';
        return;
    }

    const items = tripHistory.map(trip => `
        <div class="trip-item ${trip.success ? 'success' : 'failure'}">
            <div class="trip-info">
                <span class="badge district-badge bg-primary">${trip.district}</span>
                <span class="ms-2">Р вЂќР С•Р С ${trip.houseNumber}</span>
                <span class="ms-2 text-muted">${formatTripTime(trip.timestamp)}</span>
                ${trip.success && trip.address_id ? 
                    `<button class="btn btn-sm btn-outline-warning ms-2" onclick="openChoiceHistory(${trip.address_id}, '${trip.description}', ${trip.visited_location_id || 'null'})" title="Р ВР Р…РЎвЂљР ВµРЎР‚Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р Р†РЎвЂ№Р В±Р С•РЎР‚РЎвЂ№">
                        <i class="fas fa-question-circle"></i>
                    </button>` : ''
                }
            </div>
            <div class="trip-description">
                ${trip.success ? 
                    `<strong>Р СњР В°Р в„–Р Т‘Р ВµР Р…Р С•:</strong> ${trip.description}` : 
                    `<strong>Р Р€Р В»Р С‘Р С” Р Р…Р ВµРЎвЂљ</strong>`
                }
            </div>
        </div>
    `).join('');

    container.innerHTML = items;
}

// Р В¤Р С•РЎР‚Р СР В°РЎвЂљР С‘РЎР‚Р С•Р Р†Р В°Р Р…Р С‘Р Вµ Р Р†РЎР‚Р ВµР СР ВµР Р…Р С‘ Р С—Р С•Р ВµР В·Р Т‘Р С”Р С‘
function formatTripTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'РЎвЂљР С•Р В»РЎРЉР С”Р С• РЎвЂЎРЎвЂљР С•';
    if (diffMins < 60) return `${diffMins} Р СР С‘Р Р…. Р Р…Р В°Р В·Р В°Р Т‘`;
    if (diffHours < 24) return `${diffHours} РЎвЂЎ. Р Р…Р В°Р В·Р В°Р Т‘`;
    
    return date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Р вЂ”Р В°Р С–РЎР‚РЎС“Р В·Р С”Р В° Р С‘Р Р…РЎвЂћР С•РЎР‚Р СР В°РЎвЂ Р С‘Р С‘ Р С• РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘Р С‘
async function loadScenarioInfo() {
    try {
        const roomUser = JSON.parse(localStorage.getItem('roomUser') || 'null');
        const room = JSON.parse(localStorage.getItem('room') || 'null');
        
        if (roomUser && roomUser.room_id) {
            // Р вЂќР В»РЎРЏ Р С‘Р С–РЎР‚Р С•Р С”Р С•Р Р† Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№ Р С—Р С•Р В»РЎС“РЎвЂЎР В°Р ВµР С Р С‘Р Р…РЎвЂћР С•РЎР‚Р СР В°РЎвЂ Р С‘РЎР‹ Р С• РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘Р С‘ Р С‘Р В· Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/room/${roomUser.room_id}/state`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Room state data:', data);
                
                // Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С Р Р…Р ВµРЎРѓР С”Р С•Р В»РЎРЉР С”Р С• Р Р†Р С•Р В·Р СР С•Р В¶Р Р…РЎвЂ№РЎвЂ¦ Р С‘РЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С”Р С•Р Р† Р Р…Р В°Р В·Р Р†Р В°Р Р…Р С‘РЎРЏ РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘РЎРЏ
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
                    document.getElementById('scenarioTitle').textContent = 'Р РЋРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘Р в„– Р Р…Р Вµ Р С•Р С—РЎР‚Р ВµР Т‘Р ВµР В»Р ВµР Р…';
                    console.log('No scenario name found in data:', data);
                }
            } else {
                document.getElementById('scenarioTitle').textContent = 'Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№';
                console.error('Failed to load room state:', response.status);
            }
        } else {
            // Р вЂќР В»РЎРЏ Р С•Р В±РЎвЂ№РЎвЂЎР Р…РЎвЂ№РЎвЂ¦ Р С—Р С•Р В»РЎРЉР В·Р С•Р Р†Р В°РЎвЂљР ВµР В»Р ВµР в„– Р С—Р С•Р В»РЎС“РЎвЂЎР В°Р ВµР С Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р в„– РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘Р в„–
            const response = await fetch(`${API_BASE}/scenarios/active`);
            
            if (response.ok) {
                const data = await response.json();
                document.getElementById('scenarioTitle').textContent = data.scenario.name;
            } else {
                document.getElementById('scenarioTitle').textContent = 'Р СњР ВµРЎвЂљ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•Р С–Р С• РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘РЎРЏ';
            }
        }
    } catch (error) {
        console.error('Error loading scenario info:', error);
        document.getElementById('scenarioTitle').textContent = 'Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘';
    }
}

// ===== Room timer =====
async function initRoomTimer() {
    await refreshRoomState();
    await loadScenarioInfo(); // Р вЂ”Р В°Р С–РЎР‚РЎС“Р В¶Р В°Р ВµР С Р С‘Р Р…РЎвЂћР С•РЎР‚Р СР В°РЎвЂ Р С‘РЎР‹ Р С• РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘Р С‘ Р С—РЎР‚Р С‘ Р С‘Р Р…Р С‘РЎвЂ Р С‘Р В°Р В»Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ РЎвЂљР В°Р в„–Р СР ВµРЎР‚Р В°
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
        
        // Р С›Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С Р Р…Р В°Р В·Р Р†Р В°Р Р…Р С‘Р Вµ РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘РЎРЏ Р С—РЎР‚Р С‘ Р С”Р В°Р В¶Р Т‘Р С•Р С Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р С‘ РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘РЎРЏ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№
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
        timerDisplay.textContent = 'Р С›Р В¶Р С‘Р Т‘Р В°Р Р…Р С‘Р Вµ';
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
        timerDisplay.textContent = `Р СџР В°РЎС“Р В·Р В° ${minutes}:${seconds.toString().padStart(2, '0')}`;
        roomTimer.style.display = 'block';
        timerDisplay.className = 'badge bg-warning text-dark fs-6';
    } else if (state === 'finished') {
        timerDisplay.textContent = 'Р вЂ”Р В°Р Р†Р ВµРЎР‚РЎв‚¬Р ВµР Р…Р С•';
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
    // Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р С•Р В±РЎР‚Р В°Р В±Р С•РЎвЂљРЎвЂЎР С‘Р С”Р С‘ Р Т‘Р В»РЎРЏ Р С—Р ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘РЎРЏ Р Р†Р С”Р В»Р В°Р Т‘Р С•Р С”
    const gameTab = document.getElementById('game-tab');
    const questionsTab = document.getElementById('questions-tab');
    const gameContent = document.getElementById('game');
    const questionsContent = document.getElementById('questions');
    
    if (gameTab && questionsTab && gameContent && questionsContent) {
        gameTab.addEventListener('click', (e) => {
            e.preventDefault();
            // Р СџР ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР В°Р ВµР С Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘РЎРЏ Р С”Р Р…Р С•Р С—Р С•Р С”
            gameTab.classList.add('active');
            questionsTab.classList.remove('active');
            
            // Р СџР ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР В°Р ВµР С Р Р†Р С‘Р Т‘Р С‘Р СР С•РЎРѓРЎвЂљРЎРЉ Р С”Р С•Р Р…РЎвЂљР ВµР Р…РЎвЂљР В°
            gameContent.classList.add('show', 'active');
            gameContent.classList.remove('fade');
            questionsContent.classList.remove('show', 'active');
            questionsContent.classList.add('fade');
        });
        
        questionsTab.addEventListener('click', (e) => {
            e.preventDefault();
            // Р СџР ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР В°Р ВµР С Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘РЎРЏ Р С”Р Р…Р С•Р С—Р С•Р С”
            questionsTab.classList.add('active');
            gameTab.classList.remove('active');
            
            // Р СџР ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР В°Р ВµР С Р Р†Р С‘Р Т‘Р С‘Р СР С•РЎРѓРЎвЂљРЎРЉ Р С”Р С•Р Р…РЎвЂљР ВµР Р…РЎвЂљР В°
            questionsContent.classList.add('show', 'active');
            questionsContent.classList.remove('fade');
            gameContent.classList.remove('show', 'active');
            gameContent.classList.add('fade');
            
            // Р вЂ”Р В°Р С–РЎР‚РЎС“Р В¶Р В°Р ВµР С Р Р†Р С•Р С—РЎР‚Р С•РЎРѓРЎвЂ№
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
        
        questionsListElement.innerHTML = '<p class="text-muted text-center">Р вЂ”Р В°Р С–РЎР‚РЎС“Р В·Р С”Р В° Р Р†Р С•Р С—РЎР‚Р С•РЎРѓР С•Р Р†...</p>';
        
        const roomUser = JSON.parse(localStorage.getItem('roomUser') || 'null');
        let scenarioId;
        
        if (roomUser && roomUser.room_id) {
            // Р вЂќР В»РЎРЏ Р С‘Р С–РЎР‚Р С•Р С”Р С•Р Р† Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№ Р С—Р С•Р В»РЎС“РЎвЂЎР В°Р ВµР С scenario_id Р С‘Р В· Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№
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
            // Р вЂќР В»РЎРЏ Р С•Р В±РЎвЂ№РЎвЂЎР Р…РЎвЂ№РЎвЂ¦ Р С—Р С•Р В»РЎРЉР В·Р С•Р Р†Р В°РЎвЂљР ВµР В»Р ВµР в„– Р С—Р С•Р В»РЎС“РЎвЂЎР В°Р ВµР С Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р в„– РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘Р в„–
            const response = await fetch(`${API_BASE}/scenarios/active`);
            if (response.ok) {
                const data = await response.json();
                scenarioId = data.scenario.id;
            }
        }
        
        if (!scenarioId) {
            questionsListElement.innerHTML = '<p class="text-muted text-center">Р СњР ВµРЎвЂљ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•Р С–Р С• РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘РЎРЏ</p>';
            return;
        }
        
        // Р вЂ”Р В°Р С–РЎР‚РЎС“Р В¶Р В°Р ВµР С Р Р†Р С•Р С—РЎР‚Р С•РЎРѓРЎвЂ№ Р Т‘Р В»РЎРЏ РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘РЎРЏ
        const questionsResponse = await fetch(`${API_BASE}/questions/scenario/${scenarioId}`);
        if (questionsResponse.ok) {
            const questionsData = await questionsResponse.json();
            displayQuestions(questionsData.questions);
        } else {
            questionsListElement.innerHTML = '<p class="text-muted text-center">Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘ Р Р†Р С•Р С—РЎР‚Р С•РЎРѓР С•Р Р†</p>';
        }
    } catch (error) {
        console.error('Error loading questions:', error);
        const questionsListElement = document.getElementById('questionsList');
        if (questionsListElement) {
            questionsListElement.innerHTML = '<p class="text-muted text-center">Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘ Р Р†Р С•Р С—РЎР‚Р С•РЎРѓР С•Р Р†</p>';
        }
    }
}

function displayQuestions(questions) {
    const container = document.getElementById('questionsList');
    
    if (!questions || questions.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">Р СњР ВµРЎвЂљ Р Р†Р С•Р С—РЎР‚Р С•РЎРѓР С•Р Р† Р Т‘Р В»РЎРЏ РЎРЊРЎвЂљР С•Р С–Р С• РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘РЎРЏ</p>';
        return;
    }
    
    container.innerHTML = questions.map(question => `
        <div class="question-item mb-4 p-3 border rounded">
            <h5 class="mb-3">${question.question_text}</h5>
            <div class="mb-3">
                <label for="answer_${question.id}" class="form-label">Р вЂ™Р В°РЎв‚¬ Р С•РЎвЂљР Р†Р ВµРЎвЂљ:</label>
                <textarea class="form-control" id="answer_${question.id}" rows="3" placeholder="Р вЂ™Р Р†Р ВµР Т‘Р С‘РЎвЂљР Вµ Р Р†Р В°РЎв‚¬ Р С•РЎвЂљР Р†Р ВµРЎвЂљ..."></textarea>
            </div>
            <button class="btn btn-primary" onclick="submitAnswer(${question.id})">
                <i class="fas fa-paper-plane me-1"></i>Р С›РЎвЂљР С—РЎР‚Р В°Р Р†Р С‘РЎвЂљРЎРЉ Р С•РЎвЂљР Р†Р ВµРЎвЂљ
            </button>
            <div id="answer_status_${question.id}" class="mt-2"></div>
        </div>
    `).join('');
}

async function submitAnswer(questionId) {
    const answerText = document.getElementById(`answer_${questionId}`).value.trim();
    const statusDiv = document.getElementById(`answer_status_${questionId}`);
    
    if (!answerText) {
        statusDiv.innerHTML = '<div class="alert alert-warning">Р вЂ™Р Р†Р ВµР Т‘Р С‘РЎвЂљР Вµ Р С•РЎвЂљР Р†Р ВµРЎвЂљ</div>';
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
            statusDiv.innerHTML = '<div class="alert alert-success">Р С›РЎвЂљР Р†Р ВµРЎвЂљ РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…Р ВµР Р…!</div>';
            document.getElementById(`answer_${questionId}`).disabled = true;
            document.querySelector(`button[onclick="submitAnswer(${questionId})"]`).disabled = true;
        } else {
            const error = await response.json();
            statusDiv.innerHTML = `<div class="alert alert-danger">Р С›РЎв‚¬Р С‘Р В±Р С”Р В°: ${error.error}</div>`;
        }
    } catch (error) {
        console.error('Error submitting answer:', error);
        statusDiv.innerHTML = '<div class="alert alert-danger">Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р С•РЎвЂљР С—РЎР‚Р В°Р Р†Р С”Р С‘ Р С•РЎвЂљР Р†Р ВµРЎвЂљР В°</div>';
    }
}

// ===== Р ВР СњР СћР вЂўР В Р С’Р С™Р СћР ВР вЂ™Р СњР В«Р вЂў Р вЂ™Р В«Р вЂР С›Р В Р В« =====

// Р вЂњР В»Р С•Р В±Р В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ Р С—Р ВµРЎР‚Р ВµР СР ВµР Р…РЎвЂ№ Р Т‘Р В»РЎРЏ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р С•Р Р†
let currentAddressId = null;
let currentVisitedLocationId = null;
let currentScenarioId = null;

// Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚Р С‘РЎвЂљРЎРЉ, Р ВµРЎРѓРЎвЂљРЎРЉ Р В»Р С‘ Р С‘Р Р…РЎвЂљР ВµРЎР‚Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р Р†РЎвЂ№Р В±Р С•РЎР‚РЎвЂ№ Р Т‘Р В»РЎРЏ Р В°Р Т‘РЎР‚Р ВµРЎРѓР В°
async function checkForInteractiveChoices(addressId, description, visitedLocationId) {
    try {
        // Р СџР С•Р В»РЎС“РЎвЂЎР В°Р ВµР С ID РЎРѓРЎвЂ Р ВµР Р…Р В°РЎР‚Р С‘РЎРЏ Р С‘Р В· РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘РЎРЏ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№
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

// Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ Р СР С•Р Т‘Р В°Р В»РЎРЉР Р…Р С•Р Вµ Р С•Р С”Р Р…Р С• РЎРѓ Р С‘Р Р…РЎвЂљР ВµРЎР‚Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р СР С‘ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р В°Р СР С‘
function showInteractiveChoiceModal(choices, description) {
    // Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ Р С•Р С—Р С‘РЎРѓР В°Р Р…Р С‘Р Вµ Р В°Р Т‘РЎР‚Р ВµРЎРѓР В°
    document.getElementById('addressDescription').textContent = description || 'Р вЂ™РЎвЂ№ Р Р…Р В°РЎв‚¬Р В»Р С‘ Р С‘Р Р…РЎвЂљР ВµРЎР‚Р ВµРЎРѓР Р…Р С•Р Вµ Р СР ВµРЎРѓРЎвЂљР С•...';
    
    // Р РЋР С•Р В·Р Т‘Р В°РЎвЂљРЎРЉ Р С”Р Р…Р С•Р С—Р С”Р С‘ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р С•Р Р†
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
        
        // Р вЂќР С•Р В±Р В°Р Р†Р С‘РЎвЂљРЎРЉ hover РЎРЊРЎвЂћРЎвЂћР ВµР С”РЎвЂљРЎвЂ№
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
    
    // Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ Р СР С•Р Т‘Р В°Р В»РЎРЉР Р…Р С•Р Вµ Р С•Р С”Р Р…Р С•
    const modal = new bootstrap.Modal(document.getElementById('choiceModal'), {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
}

// Р РЋР Т‘Р ВµР В»Р В°РЎвЂљРЎРЉ Р Р†РЎвЂ№Р В±Р С•РЎР‚ Р С‘Р С–РЎР‚Р С•Р С”Р В°
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
        
        // Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ РЎР‚Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р В°
        showChoiceResponse(data.response);
        
    } catch (error) {
        console.error('Error making choice:', error);
        
        // Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ Р С•РЎв‚¬Р С‘Р В±Р С”РЎС“
        document.getElementById('choiceOptions').style.display = 'none';
        document.getElementById('choiceResponse').style.display = 'block';
        document.getElementById('responseText').textContent = 'Р СџРЎР‚Р С•Р С‘Р В·Р С•РЎв‚¬Р В»Р В° Р С•РЎв‚¬Р С‘Р В±Р С”Р В° Р С—РЎР‚Р С‘ Р С•Р В±РЎР‚Р В°Р В±Р С•РЎвЂљР С”Р Вµ Р Р†Р В°РЎв‚¬Р ВµР С–Р С• Р Р†РЎвЂ№Р В±Р С•РЎР‚Р В°.';
    }
}

// Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ РЎР‚Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р В°
function showChoiceResponse(responseText) {
    // Р РЋР С”РЎР‚РЎвЂ№РЎвЂљРЎРЉ Р Р†Р В°РЎР‚Р С‘Р В°Р Р…РЎвЂљРЎвЂ№ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р В°
    document.getElementById('choiceOptions').style.display = 'none';
    
    // Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ РЎР‚Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљ
    document.getElementById('choiceResponse').style.display = 'block';
    document.getElementById('responseText').textContent = responseText;
}

// Р С›РЎвЂљР С”РЎР‚РЎвЂ№РЎвЂљРЎРЉ Р Р†РЎвЂ№Р В±Р С•РЎР‚РЎвЂ№ Р С‘Р В· Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘Р С‘ Р С—Р С•Р ВµР В·Р Т‘Р С•Р С”
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
        
        // Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С, Р ВµРЎРѓРЎвЂљРЎРЉ Р В»Р С‘ РЎС“Р В¶Р Вµ РЎРѓР Т‘Р ВµР В»Р В°Р Р…Р Р…РЎвЂ№Р в„– Р Р†РЎвЂ№Р В±Р С•РЎР‚
        const token = localStorage.getItem('token');
        const choiceResponse = await fetch(`${API_BASE}/choices/game/players/${roomUser.id}/scenarios/${scenarioId}/addresses/${addressId}/choice`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (choiceResponse.ok) {
            const choiceData = await choiceResponse.json();
            
            if (choiceData.choice) {
                // Р СџР С•Р С”Р В°Р В·РЎвЂ№Р Р†Р В°Р ВµР С РЎС“Р В¶Р Вµ РЎРѓР Т‘Р ВµР В»Р В°Р Р…Р Р…РЎвЂ№Р в„– Р Р†РЎвЂ№Р В±Р С•РЎР‚
                showExistingChoice(choiceData.choice, description);
                return;
            }
        }
        
        // Р вЂўРЎРѓР В»Р С‘ Р Р†РЎвЂ№Р В±Р С•РЎР‚ Р Р…Р Вµ Р В±РЎвЂ№Р В» РЎРѓР Т‘Р ВµР В»Р В°Р Р…, Р С—Р С•Р С”Р В°Р В·РЎвЂ№Р Р†Р В°Р ВµР С Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р Р…РЎвЂ№Р Вµ Р Р†Р В°РЎР‚Р С‘Р В°Р Р…РЎвЂљРЎвЂ№
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
                alert('Р вЂќР В»РЎРЏ РЎРЊРЎвЂљР С•Р в„– Р В»Р С•Р С”Р В°РЎвЂ Р С‘Р С‘ Р Р…Р ВµРЎвЂљ Р С‘Р Р…РЎвЂљР ВµРЎР‚Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№РЎвЂ¦ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р С•Р Р†');
            }
        } else {
            alert('Р СњР Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С‘РЎвЂљРЎРЉ Р Р†Р В°РЎР‚Р С‘Р В°Р Р…РЎвЂљРЎвЂ№ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р В°');
        }
        
    } catch (error) {
        console.error('Error opening choice history:', error);
        alert('Р СџРЎР‚Р С•Р С‘Р В·Р С•РЎв‚¬Р В»Р В° Р С•РЎв‚¬Р С‘Р В±Р С”Р В° Р С—РЎР‚Р С‘ Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р Вµ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р С•Р Р†');
    }
}

// Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ РЎС“Р В¶Р Вµ РЎРѓР Т‘Р ВµР В»Р В°Р Р…Р Р…РЎвЂ№Р в„– Р Р†РЎвЂ№Р В±Р С•РЎР‚
function showExistingChoice(choice, description) {
    // Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ Р С•Р С—Р С‘РЎРѓР В°Р Р…Р С‘Р Вµ Р В°Р Т‘РЎР‚Р ВµРЎРѓР В°
    document.getElementById('addressDescription').textContent = description || 'Р вЂєР С•Р С”Р В°РЎвЂ Р С‘РЎРЏ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…Р В°';
    
    // Р РЋР С”РЎР‚РЎвЂ№РЎвЂљРЎРЉ Р Р†Р В°РЎР‚Р С‘Р В°Р Р…РЎвЂљРЎвЂ№ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р В°
    document.getElementById('choiceOptions').style.display = 'none';
    
    // Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ РЎР‚Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљ
    document.getElementById('choiceResponse').style.display = 'block';
    document.getElementById('responseText').innerHTML = `
        <strong>Р вЂ™Р В°РЎв‚¬ Р Р†РЎвЂ№Р В±Р С•РЎР‚:</strong> ${choice.choice_text}<br>
        <strong>Р В Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљ:</strong> ${choice.response_text}
    `;
    
    // Р СџР С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ Р СР С•Р Т‘Р В°Р В»РЎРЉР Р…Р С•Р Вµ Р С•Р С”Р Р…Р С•
    const modal = new bootstrap.Modal(document.getElementById('choiceModal'));
    modal.show();
}

// Р РЋР В±РЎР‚Р С•РЎРѓ Р СР С•Р Т‘Р В°Р В»РЎРЉР Р…Р С•Р С–Р С• Р С•Р С”Р Р…Р В° Р С—РЎР‚Р С‘ Р В·Р В°Р С”РЎР‚РЎвЂ№РЎвЂљР С‘Р С‘
document.getElementById('choiceModal').addEventListener('hidden.bs.modal', function () {
    // Р РЋР В±РЎР‚Р С•РЎРѓ РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘РЎРЏ Р СР С•Р Т‘Р В°Р В»РЎРЉР Р…Р С•Р С–Р С• Р С•Р С”Р Р…Р В°
    document.getElementById('choiceOptions').style.display = 'block';
    document.getElementById('choiceResponse').style.display = 'none';
    document.getElementById('choiceButtons').innerHTML = '';
    
    // Р РЋР В±РЎР‚Р С•РЎРѓ Р С—Р ВµРЎР‚Р ВµР СР ВµР Р…Р Р…РЎвЂ№РЎвЂ¦
    currentAddressId = null;
    currentVisitedLocationId = null;
    currentScenarioId = null;
});

