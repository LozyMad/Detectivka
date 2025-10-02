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
        alert('Игра ещё не началась или уже завершилась');
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
    
    // Проверяем, не была ли уже совершена поездка в эту локацию
    const existingTrip = tripHistory.find(trip => 
        trip.district === selectedDistrict && 
        trip.houseNumber === houseNumber
    );
    
    if (existingTrip) {
        alert('Вы уже посещали эту локацию! Проверьте записи о поездках.');
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
        
        // Увеличиваем счетчик поездок независимо от результата
        tripCount++;
        updateTripCounter();
        
        if (response.ok) {
            // Добавляем поездку в историю
            const trip = {
                district: selectedDistrict,
                houseNumber: houseNumber,
                success: data.success,
                description: data.description || null,
                timestamp: new Date().toISOString(),
                alreadyVisited: false // Теперь все поездки уникальные
            };
            tripHistory.unshift(trip); // Добавляем в начало массива
            updateTripHistory();
            
            // Clear input
            document.getElementById('houseNumber').value = '';
            
            // Проверяем, есть ли интерактивные выборы для этого адреса
            if (data.success && data.address_id) {
                console.log('Visit successful, checking for choices:', data);
                checkForInteractiveChoices(data.address_id, data.description, data.visited_location_id);
            }
            
        } else {
            // Добавляем неудачную поездку в историю
            const trip = {
                district: selectedDistrict,
                houseNumber: houseNumber,
                success: false,
                description: data.error || 'Произошла ошибка',
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
        
        // Увеличиваем счетчик поездок даже при ошибке
        tripCount++;
        updateTripCounter();
        
        // Добавляем поездку с ошибкой в историю
        const trip = {
            district: selectedDistrict,
            houseNumber: houseNumber,
            success: false,
            description: 'Ошибка соединения',
            timestamp: new Date().toISOString(),
            alreadyVisited: false
        };
        tripHistory.unshift(trip);
        updateTripHistory();
        
        // Clear input
        document.getElementById('houseNumber').value = '';
    }
}

// Загрузка счетчика поездок
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
        
        // Преобразуем попытки в формат истории поездок
        tripHistory = attempts.map(attempt => ({
            district: attempt.district,
            houseNumber: attempt.house_number,
            success: attempt.found,
            description: attempt.found ? (attempt.address_description || 'Локация найдена') : 'Улик нет',
            timestamp: attempt.attempted_at,
            alreadyVisited: false
        }));
        
        updateTripHistory();
        
    } catch (error) {
        console.error('Error loading trip history:', error);
        tripHistory = [];
        updateTripHistory();
    }
}

// Обновление отображения истории поездок
function updateTripHistory() {
    const container = document.getElementById('tripHistory');
    if (!container) return;
    
    if (tripHistory.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">История поездок пуста</p>';
        return;
    }

    const items = tripHistory.map(trip => `
        <div class="trip-item ${trip.success ? 'success' : 'failure'}">
            <div class="trip-info">
                <span class="badge district-badge bg-primary">${trip.district}</span>
                <span class="ms-2">Дом ${trip.houseNumber}</span>
                <span class="ms-2 text-muted">${formatTripTime(trip.timestamp)}</span>
            </div>
            <div class="trip-description">
                ${trip.success ? 
                    `<strong>Найдено:</strong> ${trip.description}` : 
                    `<strong>Улик нет</strong>`
                }
            </div>
        </div>
    `).join('');

    container.innerHTML = items;
}

// Форматирование времени поездки
function formatTripTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин. назад`;
    if (diffHours < 24) return `${diffHours} ч. назад`;
    
    return date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Загрузка информации о сценарии
async function loadScenarioInfo() {
    try {
        const roomUser = JSON.parse(localStorage.getItem('roomUser') || 'null');
        const room = JSON.parse(localStorage.getItem('room') || 'null');
        
        if (roomUser && roomUser.room_id) {
            // Для игроков комнаты получаем информацию о сценарии из комнаты
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE}/room/${roomUser.room_id}/state`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('Room state data:', data);
                
                // Проверяем несколько возможных источников названия сценария
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
                    document.getElementById('scenarioTitle').textContent = 'Сценарий не определен';
                    console.log('No scenario name found in data:', data);
                }
            } else {
                document.getElementById('scenarioTitle').textContent = 'Ошибка загрузки комнаты';
                console.error('Failed to load room state:', response.status);
            }
        } else {
            // Для обычных пользователей получаем активный сценарий
            const response = await fetch(`${API_BASE}/scenarios/active`);
            
            if (response.ok) {
                const data = await response.json();
                document.getElementById('scenarioTitle').textContent = data.scenario.name;
            } else {
                document.getElementById('scenarioTitle').textContent = 'Нет активного сценария';
            }
        }
    } catch (error) {
        console.error('Error loading scenario info:', error);
        document.getElementById('scenarioTitle').textContent = 'Ошибка загрузки';
    }
}

// ===== Room timer =====
async function initRoomTimer() {
    await refreshRoomState();
    await loadScenarioInfo(); // Загружаем информацию о сценарии при инициализации таймера
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
        const res = await fetch(`/api/room/${room.id}/state`);
        if (!res.ok) return;
        roomState = await res.json();
        
        // Обновляем название сценария при каждом обновлении состояния комнаты
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
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
}

// ===== Tab Switching =====
function setupTabSwitching() {
    // Добавляем обработчики для переключения вкладок
    const gameTab = document.getElementById('game-tab');
    const questionsTab = document.getElementById('questions-tab');
    const gameContent = document.getElementById('game');
    const questionsContent = document.getElementById('questions');
    
    if (gameTab && questionsTab && gameContent && questionsContent) {
        gameTab.addEventListener('click', (e) => {
            e.preventDefault();
            // Переключаем активные состояния кнопок
            gameTab.classList.add('active');
            questionsTab.classList.remove('active');
            
            // Переключаем видимость контента
            gameContent.classList.add('show', 'active');
            gameContent.classList.remove('fade');
            questionsContent.classList.remove('show', 'active');
            questionsContent.classList.add('fade');
        });
        
        questionsTab.addEventListener('click', (e) => {
            e.preventDefault();
            // Переключаем активные состояния кнопок
            questionsTab.classList.add('active');
            gameTab.classList.remove('active');
            
            // Переключаем видимость контента
            questionsContent.classList.add('show', 'active');
            questionsContent.classList.remove('fade');
            gameContent.classList.remove('show', 'active');
            gameContent.classList.add('fade');
            
            // Загружаем вопросы
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
        
        questionsListElement.innerHTML = '<p class="text-muted text-center">Загрузка вопросов...</p>';
        
        const roomUser = JSON.parse(localStorage.getItem('roomUser') || 'null');
        let scenarioId;
        
        if (roomUser && roomUser.room_id) {
            // Для игроков комнаты получаем scenario_id из комнаты
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
            displayQuestions(questionsData.questions);
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

function displayQuestions(questions) {
    const container = document.getElementById('questionsList');
    
    if (!questions || questions.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">Нет вопросов для этого сценария</p>';
        return;
    }
    
    container.innerHTML = questions.map(question => `
        <div class="question-item mb-4 p-3 border rounded">
            <h5 class="mb-3">${question.question_text}</h5>
            <div class="mb-3">
                <label for="answer_${question.id}" class="form-label">Ваш ответ:</label>
                <textarea class="form-control" id="answer_${question.id}" rows="3" placeholder="Введите ваш ответ..."></textarea>
            </div>
            <button class="btn btn-primary" onclick="submitAnswer(${question.id})">
                <i class="fas fa-paper-plane me-1"></i>Отправить ответ
            </button>
            <div id="answer_status_${question.id}" class="mt-2"></div>
        </div>
    `).join('');
}

async function submitAnswer(questionId) {
    const answerText = document.getElementById(`answer_${questionId}`).value.trim();
    const statusDiv = document.getElementById(`answer_status_${questionId}`);
    
    if (!answerText) {
        statusDiv.innerHTML = '<div class="alert alert-warning">Введите ответ</div>';
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
            statusDiv.innerHTML = '<div class="alert alert-success">Ответ сохранен!</div>';
            document.getElementById(`answer_${questionId}`).disabled = true;
            document.querySelector(`button[onclick="submitAnswer(${questionId})"]`).disabled = true;
        } else {
            const error = await response.json();
            statusDiv.innerHTML = `<div class="alert alert-danger">Ошибка: ${error.error}</div>`;
        }
    } catch (error) {
        console.error('Error submitting answer:', error);
        statusDiv.innerHTML = '<div class="alert alert-danger">Ошибка отправки ответа</div>';
    }
}

// ===== ИНТЕРАКТИВНЫЕ ВЫБОРЫ =====

// Глобальные перемены для выборов
let currentAddressId = null;
let currentVisitedLocationId = null;
let currentScenarioId = null;

// Проверить, есть ли интерактивные выборы для адреса
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
        const response = await fetch(`${API_BASE}/choices/game/scenarios/${currentScenarioId}/addresses/${addressId}/choices`);
        
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

// Показать модальное окно с интерактивными выборами
function showInteractiveChoiceModal(choices, description) {
    // Обновить описание адреса
    document.getElementById('addressDescription').textContent = description || 'Вы нашли интересное место...';
    
    // Создать кнопки выборов
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
        
        // Добавить hover эффекты
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
    
    // Показать модальное окно
    const modal = new bootstrap.Modal(document.getElementById('choiceModal'), {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
}

// Сделать выбор игрока
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
        
        // Показать результат выбора
        showChoiceResponse(data.response);
        
    } catch (error) {
        console.error('Error making choice:', error);
        
        // Показать ошибку
        document.getElementById('choiceOptions').style.display = 'none';
        document.getElementById('choiceResponse').style.display = 'block';
        document.getElementById('responseText').textContent = 'Произошла ошибка при обработке вашего выбора.';
    }
}

// Показать результат выбора
function showChoiceResponse(responseText) {
    // Скрыть варианты выбора
    document.getElementById('choiceOptions').style.display = 'none';
    
    // Показать результат
    document.getElementById('choiceResponse').style.display = 'block';
    document.getElementById('responseText').textContent = responseText;
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