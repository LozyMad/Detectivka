const API_BASE = '/api';
let currentUser = null;
let scenarios = [];

// Initialize admin panel
document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuth();
    setupEventListeners();
    loadInitialData();
});

function checkAdminAuth() {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    
    if (!token || !user.id || !user.is_admin) {
        window.location.href = '/';
        return;
    }
    
    currentUser = user;
    document.getElementById('adminUsername').textContent = user.username;
    
    // Отладочная информация
    console.log('Current user:', user);
    console.log('Admin level:', user.admin_level);
    
    // Определяем доступные вкладки в зависимости от уровня админа
    setupAdminInterface(user.admin_level);
}

function setupAdminInterface(adminLevel) {
    console.log('Setting up admin interface for level:', adminLevel);
    console.log('Current user object:', currentUser);
    
    // Проверяем, существует ли вкладка backup в DOM
    const backupTab = document.querySelector('[data-tab="backup"]');
    console.log('Backup tab found in DOM:', backupTab);
    
    const sidebar = document.querySelector('.sidebar');
    const navLinks = sidebar.querySelectorAll('.nav-link');
    
    // Список вкладок, которые должны быть скрыты для обычных админов
    const restrictedTabs = ['users', 'scenarios', 'addresses', 'permissions', 'backup'];
    
    if (adminLevel !== 'super_admin') {
        console.log('Hiding restricted tabs for regular admin');
        // Скрываем вкладки для обычных админов
        restrictedTabs.forEach(tabName => {
            const tabLink = document.querySelector(`[data-tab="${tabName}"]`);
            if (tabLink) {
                tabLink.style.display = 'none';
            }
            
            // Скрываем соответствующий контент
            const tabContent = document.getElementById(`${tabName}-tab`);
            if (tabContent) {
                tabContent.style.display = 'none';
            }
        });
        
        // Если первая вкладка скрыта, показываем первую доступную
        const firstVisibleTab = sidebar.querySelector('.nav-link:not([style*="display: none"])');
        if (firstVisibleTab) {
            firstVisibleTab.classList.add('active');
            const tabName = firstVisibleTab.dataset.tab;
            document.getElementById(`${tabName}-tab`).style.display = 'block';
        }
    } else {
        console.log('Showing all tabs for super admin');
        // Для супер-админа показываем все вкладки
        restrictedTabs.forEach(tabName => {
            const tabLink = document.querySelector(`[data-tab="${tabName}"]`);
            console.log(`Processing tab: ${tabName}, found:`, tabLink);
            if (tabLink) {
                tabLink.style.display = '';
                console.log(`Showing tab: ${tabName}`);
            } else {
                console.log(`Tab not found: ${tabName}`);
            }
        });
    }
}

function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = e.target.closest('.nav-link').dataset.tab;
            switchTab(tab);
        });
    });

    // Forms
    document.getElementById('addUserForm').addEventListener('submit', handleAddUser);
    document.getElementById('addScenarioForm').addEventListener('submit', handleAddScenario);
    document.getElementById('addAddressForm').addEventListener('submit', handleAddAddress);
    
    // Permissions form
    const grantPermissionForm = document.getElementById('grantPermissionForm');
    if (grantPermissionForm) grantPermissionForm.addEventListener('submit', handleGrantPermission);
    
    // Scenario selection for addresses
    const viewAddressScenario = document.getElementById('viewAddressScenario');
    if (viewAddressScenario) {
        viewAddressScenario.addEventListener('change', loadAddressesForScenario);
    }

    // Rooms
    const createRoomForm = document.getElementById('createRoomForm');
    if (createRoomForm) createRoomForm.addEventListener('submit', handleCreateRoom);
    const addRoomUserForm = document.getElementById('addRoomUserForm');
    if (addRoomUserForm) addRoomUserForm.addEventListener('submit', handleAddRoomUser);
    const roomSelectForUsers = document.getElementById('roomSelectForUsers');
    if (roomSelectForUsers) roomSelectForUsers.addEventListener('change', function() {
        const roomId = this.value;
        if (roomId) {
            loadRoomUsers(roomId);
        } else {
            // Очищаем таблицу если комната не выбрана
            const tbody = document.getElementById('roomUsersTable');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center">Выберите комнату...</td></tr>';
            }
        }
    });
}

function switchTab(tabName) {
    // Проверяем, доступна ли вкладка для текущего админа
    const restrictedTabs = ['users', 'scenarios', 'addresses', 'permissions', 'backup'];
    if (currentUser.admin_level !== 'super_admin' && restrictedTabs.includes(tabName)) {
        showMessage('У вас нет доступа к этой вкладке', 'warning');
        return;
    }

    // Update active nav link
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Show selected tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
    });
    document.getElementById(`${tabName}-tab`).style.display = 'block';

    // Load data for the tab if needed
    if (tabName === 'users' && currentUser.admin_level === 'super_admin') {
        loadUsers();
    } else if (tabName === 'scenarios') {
        loadScenarios();
    } else if (tabName === 'statistics') {
        ensureStatsScenarioOptions();
        // Don't auto-load; let user click refresh
    } else if (tabName === 'rooms') {
        loadRooms();
        ensureRoomScenarioOptions();
    } else if (tabName === 'answers') {
        populateAnswersRoomSelect();
    } else if (tabName === 'permissions') {
        loadPermissions();
        populatePermissionDropdowns();
    } else if (tabName === 'backup') {
        loadBackupList();
    }
}

async function loadInitialData() {
    // Загружаем сценарии только если у нас есть доступ к ним
    if (currentUser.admin_level === 'super_admin') {
    await loadScenarios();
    populateScenarioDropdowns();
    loadUsers();
    } else {
        // Для обычных админов загружаем только доступные сценарии
        await loadScenarios();
        populateScenarioDropdowns();
    }
    
    ensureStatsScenarioOptions();
    ensureRoomScenarioOptions();
    populateAnswersRoomSelect();
}

// Users management
async function loadUsers() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/users`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load users');
        }

        const data = await response.json();
        displayUsers(data.users);
    } catch (error) {
        console.error('Error loading users:', error);
        showMessage('Ошибка загрузки пользователей', 'danger');
    }
}

function displayUsers(users) {
    const tbody = document.getElementById('usersTable');
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Нет пользователей</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>
                <span class="badge ${user.is_admin ? 'bg-danger' : 'bg-secondary'}">
                    ${user.is_admin ? 'Администратор' : 'Пользователь'}
                </span>
            </td>
            <td>${new Date(user.created_at).toLocaleDateString('ru-RU')}</td>
            <td class="table-actions">
                <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${user.id})" ${user.id === currentUser.id ? 'disabled' : ''}>
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

async function handleAddUser(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    const is_admin = document.querySelector('input[name="userRole"]:checked').value === 'admin';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ username, password, is_admin })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Пользователь успешно создан', 'success');
            e.target.reset();
            loadUsers();
        } else {
            showMessage(data.error || 'Ошибка создания пользователя', 'danger');
        }
    } catch (error) {
        console.error('Error creating user:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

async function deleteUser(userId) {
    if (!confirm('Вы уверены, что хотите удалить этого пользователя?')) {
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Failed to delete user');
        }
        showMessage('Пользователь удален', 'success');
        loadUsers();
    } catch (err) {
        console.error(err);
        showMessage('Ошибка удаления пользователя: ' + err.message, 'danger');
    }
}

// Scenarios management
async function loadScenarios() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/scenarios`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load scenarios');
        }

        const data = await response.json();
        scenarios = data.scenarios;
        displayScenarios(scenarios);
    } catch (error) {
        console.error('Error loading scenarios:', error);
        showMessage('Ошибка загрузки сценариев', 'danger');
    }
}

function displayScenarios(scenarios) {
    const tbody = document.getElementById('scenariosTable');
    
    if (scenarios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Нет сценариев</td></tr>';
        return;
    }

    tbody.innerHTML = scenarios.map(scenario => `
        <tr>
            <td>${scenario.id}</td>
            <td>${scenario.name}</td>
            <td>${scenario.description || '-'}</td>
            <td>${new Date(scenario.created_at).toLocaleDateString('ru-RU')}</td>
            <td class="table-actions">
                <button class="btn btn-sm btn-outline-primary me-1" onclick="editScenario(${scenario.id})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteScenario(${scenario.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

async function handleAddScenario(e) {
    e.preventDefault();
    
    const name = document.getElementById('scenarioName').value;
    const description = document.getElementById('scenarioDescription').value;
    
    // Собираем вопросы
    const questionInputs = document.querySelectorAll('.question-input');
    const questions = Array.from(questionInputs)
        .map(input => input.value.trim())
        .filter(text => text.length > 0);

    try {
        const token = localStorage.getItem('token');
        
        // Сначала создаем сценарий
        const response = await fetch(`${API_BASE}/admin/scenarios`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, description })
        });

        const data = await response.json();

        if (response.ok) {
            const scenarioId = data.scenario.id;
            
            // Затем создаем вопросы для этого сценария
            if (questions.length > 0) {
                for (const questionText of questions) {
                    await fetch(`${API_BASE}/questions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ 
                            scenario_id: scenarioId, 
                            question_text: questionText 
                        })
                    });
                }
            }
            
            showMessage('Сценарий и вопросы успешно созданы', 'success');
            e.target.reset();
            resetQuestionsContainer();
            await loadScenarios();
            populateScenarioDropdowns();
        } else {
            showMessage(data.error || 'Ошибка создания сценария', 'danger');
        }
    } catch (error) {
        console.error('Error creating scenario:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

function editScenario(scenarioId) {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) return;

    document.getElementById('editScenarioId').value = scenario.id;
    document.getElementById('editScenarioName').value = scenario.name;
    document.getElementById('editScenarioDescription').value = scenario.description || '';

    const modal = new bootstrap.Modal(document.getElementById('editScenarioModal'));
    modal.show();
}

async function updateScenario() {
    const id = document.getElementById('editScenarioId').value;
    const name = document.getElementById('editScenarioName').value;
    const description = document.getElementById('editScenarioDescription').value;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/scenarios/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, description })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Сценарий успешно обновлен', 'success');
            const modal = bootstrap.Modal.getInstance(document.getElementById('editScenarioModal'));
            modal.hide();
            await loadScenarios();
            populateScenarioDropdowns();
        } else {
            showMessage(data.error || 'Ошибка обновления сценария', 'danger');
        }
    } catch (error) {
        console.error('Error updating scenario:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

async function deleteScenario(scenarioId) {
    if (!confirm('Вы уверены, что хотите удалить этот сценарий? Все связанные адреса также будут удалены.')) {
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/scenarios/${scenarioId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            showMessage('Сценарий успешно удален', 'success');
            await loadScenarios();
            populateScenarioDropdowns();
            // If we're viewing addresses for this scenario, clear the table
            const viewScenarioId = document.getElementById('viewAddressScenario').value;
            if (viewScenarioId === scenarioId.toString()) {
                document.getElementById('addressesTable').innerHTML = '<tr><td colspan="5" class="text-center">Выберите сценарий для просмотра адресов</td></tr>';
            }
        } else {
            const data = await response.json();
            showMessage(data.error || 'Ошибка удаления сценария', 'danger');
        }
    } catch (error) {
        console.error('Error deleting scenario:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

// Addresses management
async function loadAddressesForScenario() {
    const scenarioId = document.getElementById('viewAddressScenario').value;
    const addressesTable = document.getElementById('addressesTable');
    
    if (!scenarioId) {
        addressesTable.innerHTML = '<tr><td colspan="5" class="text-center">Выберите сценарий для просмотра адресов</td></tr>';
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/addresses/${scenarioId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const addresses = data.addresses || [];
            
            if (addresses.length === 0) {
                addressesTable.innerHTML = '<tr><td colspan="5" class="text-center">Адреса для этого сценария не найдены</td></tr>';
            } else {
                addressesTable.innerHTML = addresses.map(address => `
                    <tr>
                        <td>${address.id}</td>
                        <td>${address.district}</td>
                        <td>${address.house_number}</td>
                        <td>${address.description || '-'}</td>
                        <td class="table-actions">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteAddress(${address.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        } else {
            const data = await response.json();
            showMessage(data.error || 'Ошибка загрузки адресов', 'danger');
            addressesTable.innerHTML = '<tr><td colspan="5" class="text-center">Ошибка загрузки адресов</td></tr>';
        }
    } catch (error) {
        console.error('Error loading addresses:', error);
        showMessage('Ошибка соединения', 'danger');
        addressesTable.innerHTML = '<tr><td colspan="5" class="text-center">Ошибка соединения</td></tr>';
    }
}

function populateScenarioDropdowns() {
    const addDropdown = document.getElementById('addressScenario');
    const viewDropdown = document.getElementById('viewAddressScenario');
    
    const options = scenarios.map(scenario => 
        `<option value="${scenario.id}">${scenario.name}</option>`
    ).join('');
    
    addDropdown.innerHTML = '<option value="">Выберите сценарий...</option>' + options;
    viewDropdown.innerHTML = '<option value="">Выберите сценарий для просмотра...</option>' + options;

    // Populate statistics select as well
    ensureStatsScenarioOptions();
    // Populate room scenario select
    ensureRoomScenarioOptions();
}

function ensureStatsScenarioOptions() {
    const select = document.getElementById('statsScenarioSelect');
    if (!select) return;
    const options = scenarios.map(s => `<option value="${s.id}">${s.name} ${s.is_active ? '(активный)' : ''}</option>`).join('');
    select.innerHTML = '<option value="">Выберите сценарий...</option>' + options;
}

function ensureRoomScenarioOptions() {
    const select = document.getElementById('roomScenario');
    if (!select) return;
    const options = scenarios.map(s => `<option value="${s.id}">${s.name} ${s.is_active ? '(активный)' : ''}</option>`).join('');
    select.innerHTML = '<option value="">Выберите сценарий...</option>' + options;
}

async function handleCreateRoom(e) {
    e.preventDefault();
    const name = document.getElementById('roomName').value;
    const scenario_id = document.getElementById('roomScenario').value;
    const minutes = parseInt(document.getElementById('roomDuration').value || '60', 10);
    const duration_seconds = Math.max(60, minutes * 60);
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ name, scenario_id, duration_seconds })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка создания комнаты');
        showMessage('Комната создана', 'success');
        (e.target).reset();
        await loadRooms();
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка создания комнаты', 'danger');
    }
}

async function loadRooms() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('Failed to load rooms');
        const data = await res.json();
        displayRooms(data.rooms || []);
        populateRoomsForUsers(data.rooms || []);
    } catch (err) {
        console.error(err);
        showMessage('Ошибка загрузки комнат', 'danger');
    }
}

function displayRooms(rooms) {
    const tbody = document.getElementById('roomsTable');
    if (!tbody) return;
    if (!rooms.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Нет комнат</td></tr>';
        return;
    }
    tbody.innerHTML = rooms.map(r => `
        <tr>
            <td>${r.id}</td>
            <td>${r.name}</td>
            <td>${r.scenario_name || r.scenario_id}</td>
            <td>${r.game_start_time ? new Date(r.game_start_time).toLocaleString('ru-RU') : '-'}</td>
            <td>${Math.floor((r.duration_seconds||3600)/60)} мин.</td>
            <td class="table-actions">
                <div class="btn-group btn-group-sm" role="group">
                    <button class="btn btn-outline-success" title="Старт" onclick="startRoom(${r.id})" ${r.state === 'running' ? 'disabled' : ''}>
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-outline-warning" title="Пауза" onclick="pauseRoom(${r.id})" ${r.state !== 'running' ? 'disabled' : ''}>
                        <i class="fas fa-pause"></i>
                    </button>
                    <button class="btn btn-outline-info" title="Продолжить" onclick="resumeRoom(${r.id})" ${r.state !== 'paused' ? 'disabled' : ''}>
                        <i class="fas fa-rotate-right"></i>
                    </button>
                    <button class="btn btn-outline-danger" title="Стоп" onclick="stopRoom(${r.id})" ${r.state === 'finished' ? 'disabled' : ''}>
                        <i class="fas fa-stop"></i>
                    </button>
                </div>
                <button class="btn btn-sm btn-outline-primary" onclick="viewRoomUsers(${r.id})">
                    <i class="fas fa-users"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteRoom(${r.id})" title="Удалить комнату">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function populateRoomsForUsers(rooms) {
    const select = document.getElementById('roomSelectForUsers');
    if (!select) return;
    const opts = rooms.map(r => `<option value="${r.id}">${r.name} (#${r.id})</option>`).join('');
    select.innerHTML = '<option value="">Выберите комнату...</option>' + opts;
}

async function startRoom(roomId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/start`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка запуска');
        showMessage('Таймер запущен', 'success');
        await loadRooms();
        // refresh users list if open
        const cur = document.getElementById('roomSelectForUsers').value;
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка запуска комнаты', 'danger');
    }
}

async function pauseRoom(roomId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/pause`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка паузы');
        showMessage('Таймер на паузе', 'warning');
        await loadRooms();
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка паузы комнаты', 'danger');
    }
}

async function resumeRoom(roomId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/resume`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка продолжения');
        showMessage('Таймер продолжен', 'info');
        await loadRooms();
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка продолжения комнаты', 'danger');
    }
}

async function stopRoom(roomId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/stop`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка остановки');
        showMessage('Таймер остановлен', 'danger');
        await loadRooms();
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка остановки комнаты', 'danger');
    }
}

function viewRoomUsers(roomId) {
    const select = document.getElementById('roomSelectForUsers');
    if (select) {
        select.value = String(roomId);
    }
}

async function handleAddRoomUser(e) {
    e.preventDefault();
    const room_id = document.getElementById('roomSelectForUsers').value;
    const username = document.getElementById('roomUserLogin').value;
    const password = document.getElementById('roomUserPassword').value;
    if (!room_id) return showMessage('Выберите комнату', 'warning');
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${room_id}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка добавления игрока');
        showMessage('Игрок добавлен', 'success');
        (e.target).reset();
        // Обновляем список игроков после добавления
        loadRoomUsers(room_id);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка добавления игрока', 'danger');
    }
}

// Функция для загрузки списка игроков комнаты
async function loadRoomUsers(roomId) {
    try {
        console.log('Loading room users for room:', roomId);
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        console.log('API response:', data);
        if (!res.ok) throw new Error(data.error || 'Ошибка загрузки игроков');
        displayRoomUsers(data.users);
    } catch (err) {
        console.error('Error loading room users:', err);
        showMessage(err.message || 'Ошибка загрузки игроков', 'danger');
    }
}

// Функция для отображения списка игроков
function displayRoomUsers(users) {
    console.log('Displaying room users:', users);
    const tbody = document.getElementById('roomUsersTable');
    console.log('Table body element:', tbody);
    if (!tbody) {
        console.error('Table body not found!');
        return;
    }
    
    if (!users || users.length === 0) {
        console.log('No users found, showing empty message');
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Нет игроков в комнате</td></tr>';
        return;
    }
    
    console.log('Rendering', users.length, 'users');
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${new Date(user.created_at).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="removeRoomUser(${user.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Функция для удаления игрока из комнаты
async function removeRoomUser(userId) {
    if (!confirm('Удалить игрока из комнаты?')) return;
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка удаления игрока');
        showMessage('Игрок удален', 'success');
        // Обновляем список игроков
        const roomId = document.getElementById('roomSelectForUsers').value;
        if (roomId) loadRoomUsers(roomId);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка удаления игрока', 'danger');
    }
}



async function deleteRoom(roomId) {
    if (!confirm('Удалить комнату? Это действие нельзя отменить.')) return;
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Failed to delete room');
        }
        showMessage('Комната удалена', 'success');
        loadRooms();
    } catch (err) {
        console.error(err);
        showMessage('Ошибка удаления комнаты: ' + err.message, 'danger');
    }
}

// Функции для работы с вопросами
function addQuestion() {
    const container = document.getElementById('questionsContainer');
    const questionItem = document.createElement('div');
    questionItem.className = 'question-item mb-2';
    questionItem.innerHTML = `
        <div class="input-group">
            <input type="text" class="form-control question-input" placeholder="Введите вопрос">
            <button type="button" class="btn btn-outline-danger" onclick="removeQuestion(this)">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    container.appendChild(questionItem);
}

function removeQuestion(button) {
    const questionItem = button.closest('.question-item');
    questionItem.remove();
}

function resetQuestionsContainer() {
    const container = document.getElementById('questionsContainer');
    container.innerHTML = `
        <div class="question-item mb-2">
            <div class="input-group">
                <input type="text" class="form-control question-input" placeholder="Введите вопрос">
                <button type="button" class="btn btn-outline-danger" onclick="removeQuestion(this)">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}



async function handleAddAddress(e) {
    e.preventDefault();
    
    const scenario_id = document.getElementById('addressScenario').value;
    const district = document.getElementById('addressDistrict').value;
    const house_number = document.getElementById('addressHouseNumber').value;
    const description = document.getElementById('addressDescription').value;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/addresses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ scenario_id, district, house_number, description })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Адрес успешно добавлен', 'success');
            e.target.reset();
            // Reload addresses if we're viewing the same scenario
            const viewScenarioId = document.getElementById('viewAddressScenario').value;
            const addScenarioId = document.getElementById('addressScenario').value;
            if (viewScenarioId === addScenarioId) {
                loadAddressesForScenario();
            }
        } else {
            showMessage(data.error || 'Ошибка добавления адреса', 'danger');
        }
    } catch (error) {
        console.error('Error adding address:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}



async function deleteAddress(addressId) {
    if (!confirm('Вы уверены, что хотите удалить этот адрес?')) {
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const scenarioId = document.getElementById('viewAddressScenario').value;
        const response = await fetch(`${API_BASE}/admin/addresses/${scenarioId}/${addressId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            showMessage('Адрес успешно удален', 'success');
            loadAddressesForScenario();
        } else {
            const data = await response.json();
            showMessage(data.error || 'Ошибка удаления адреса', 'danger');
        }
    } catch (error) {
        console.error('Error deleting address:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

// Utility functions
function showMessage(message, type) {
    // Create toast notification
    const toastContainer = document.getElementById('toastContainer') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    
    // Remove toast after it's hidden
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
    return container;
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
}

// ===== Answers Functions =====
async function loadRoomAnswers() {
    const roomId = document.getElementById('answersRoomSelect').value;
    if (!roomId) {
        showMessage('Выберите комнату', 'warning');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/questions/room/${roomId}/answers`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка загрузки ответов');
        }

        const data = await response.json();
        displayRoomAnswers(data);
        
        // Показываем контент
        document.getElementById('answersContent').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading room answers:', error);
        showMessage('Ошибка загрузки ответов: ' + error.message, 'danger');
    }
}

function displayRoomAnswers(data) {
    const answersList = document.getElementById('answersList');
    const answersRoomTitle = document.getElementById('answersRoomTitle');
    
    // Обновляем заголовок
    answersRoomTitle.textContent = `Ответы команд - ${data.room.name} (${data.room.scenario_name})`;
    
    if (!data.users || data.users.length === 0) {
        answersList.innerHTML = '<p class="text-muted text-center">В этой комнате нет игроков</p>';
        return;
    }

    let html = '';
    
    data.users.forEach((user, userIndex) => {
        html += `
            <div class="card mb-4">
                <div class="card-header bg-primary text-white">
                    <div class="d-flex justify-content-between align-items-center">
                        <h6 class="mb-0">
                            <i class="fas fa-user me-2"></i>Команда: ${user.username}
                        </h6>
                        <div class="d-flex gap-2">
                            <span class="badge bg-light text-dark">
                                <i class="fas fa-car me-1"></i>Всего поездок: ${user.trip_stats?.total_trips || 0}
                            </span>
                            <span class="badge bg-success">
                                <i class="fas fa-check me-1"></i>Успешных: ${user.trip_stats?.successful_trips || 0}
                            </span>
                            <span class="badge bg-danger">
                                <i class="fas fa-times me-1"></i>Неудачных: ${user.trip_stats?.failed_trips || 0}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="card-body">
        `;
        
        if (!user.answers || user.answers.length === 0) {
            html += '<p class="text-muted">Нет ответов</p>';
        } else {
            html += '<div class="row">';
            
            user.answers.forEach((answer, answerIndex) => {
                const hasAnswer = answer.answer_text && answer.answer_text.trim() !== '';
                const answerClass = hasAnswer ? 'border-success' : 'border-warning';
                const answerIcon = hasAnswer ? 'fa-check-circle text-success' : 'fa-times-circle text-warning';
                
                html += `
                    <div class="col-md-6 mb-3">
                        <div class="card ${answerClass}">
                            <div class="card-body">
                                <h6 class="card-title">
                                    <i class="fas ${answerIcon} me-2"></i>
                                    Вопрос ${answerIndex + 1}
                                </h6>
                                <p class="card-text fw-bold">${answer.question_text}</p>
                                <div class="answer-content">
                                    ${hasAnswer ? 
                                        `<p class="text-success"><strong>Ответ:</strong> ${answer.answer_text}</p>
                                         <small class="text-muted">Отвечено: ${new Date(answer.answered_at).toLocaleString('ru-RU')}</small>` :
                                        '<p class="text-warning"><em>Ответ не дан</em></p>'
                                    }
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    answersList.innerHTML = html;
}

// Заполняем список комнат для выбора ответов
async function populateAnswersRoomSelect() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/rooms`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Ошибка загрузки комнат');
        }

        const data = await response.json();
        const select = document.getElementById('answersRoomSelect');
        
        // Очищаем и добавляем опции
        select.innerHTML = '<option value="">Выберите комнату...</option>';
        
        data.rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = `${room.name} (${room.scenario_name})`;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading rooms for answers:', error);
    }
}

// Permissions management
async function loadPermissions() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/super-admin/permissions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const permissions = data.permissions || [];
            
            const table = document.getElementById('permissionsTable');
            if (permissions.length === 0) {
                table.innerHTML = '<tr><td colspan="5" class="text-center">Разрешения не найдены</td></tr>';
            } else {
                table.innerHTML = permissions.map(permission => `
                    <tr>
                        <td>${permission.admin_username}</td>
                        <td>${permission.scenario_name}</td>
                        <td>${new Date(permission.granted_at).toLocaleDateString('ru-RU')}</td>
                        <td>${permission.granted_by_username}</td>
                        <td class="table-actions">
                            <button class="btn btn-sm btn-outline-danger" onclick="revokePermission(${permission.admin_id}, ${permission.scenario_id})">
                                <i class="fas fa-trash"></i> Отозвать
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        } else {
            const data = await response.json();
            showMessage(data.error || 'Ошибка загрузки разрешений', 'danger');
        }
    } catch (error) {
        console.error('Error loading permissions:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

async function populatePermissionDropdowns() {
    try {
        const token = localStorage.getItem('token');
        
        // Загружаем админов
        const adminsResponse = await fetch(`${API_BASE}/super-admin/admins`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (adminsResponse.ok) {
            const adminsData = await adminsResponse.json();
            const adminSelect = document.getElementById('permissionAdmin');
            adminSelect.innerHTML = '<option value="">Выберите админа...</option>';
            
            adminsData.admins.forEach(admin => {
                const option = document.createElement('option');
                option.value = admin.id;
                option.textContent = admin.username;
                adminSelect.appendChild(option);
            });
        }
        
        // Загружаем сценарии
        const scenariosResponse = await fetch(`${API_BASE}/admin/scenarios`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (scenariosResponse.ok) {
            const scenariosData = await scenariosResponse.json();
            const scenarioSelect = document.getElementById('permissionScenario');
            scenarioSelect.innerHTML = '<option value="">Выберите сценарий...</option>';
            
            scenariosData.scenarios.forEach(scenario => {
                const option = document.createElement('option');
                option.value = scenario.id;
                option.textContent = scenario.name;
                scenarioSelect.appendChild(option);
            });
        }
        
    } catch (error) {
        console.error('Error populating permission dropdowns:', error);
        showMessage('Ошибка загрузки данных', 'danger');
    }
}

async function handleGrantPermission(e) {
    e.preventDefault();
    
    const adminId = document.getElementById('permissionAdmin').value;
    const scenarioId = document.getElementById('permissionScenario').value;
    
    if (!adminId || !scenarioId) {
        showMessage('Выберите админа и сценарий', 'warning');
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/super-admin/permissions/grant`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ admin_id: adminId, scenario_id: scenarioId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage('Разрешение успешно выдано', 'success');
            e.target.reset();
            loadPermissions();
        } else {
            showMessage(data.error || 'Ошибка выдачи разрешения', 'danger');
        }
    } catch (error) {
        console.error('Error granting permission:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

async function revokePermission(adminId, scenarioId) {
    if (!confirm('Вы уверены, что хотите отозвать это разрешение?')) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/super-admin/permissions/revoke`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ admin_id: adminId, scenario_id: scenarioId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage('Разрешение успешно отозвано', 'success');
            loadPermissions();
        } else {
            showMessage(data.error || 'Ошибка отзыва разрешения', 'danger');
        }
    } catch (error) {
        console.error('Error revoking permission:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

// Функция для загрузки списка игроков комнаты
async function loadRoomUsers(roomId) {
    try {
        console.log('Loading room users for room:', roomId);
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        console.log('API response:', data);
        if (!res.ok) throw new Error(data.error || 'Ошибка загрузки игроков');
        displayRoomUsers(data.users);
    } catch (err) {
        console.error('Error loading room users:', err);
        showMessage(err.message || 'Ошибка загрузки игроков', 'danger');
    }
}

// Функция для отображения списка игроков
function displayRoomUsers(users) {
    console.log('Displaying room users:', users);
    const tbody = document.getElementById('roomUsersTable');
    console.log('Table body element:', tbody);
    if (!tbody) {
        console.error('Table body not found!');
        return;
    }
    
    if (!users || users.length === 0) {
        console.log('No users found, showing empty message');
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Нет игроков в комнате</td></tr>';
        return;
    }
    
    console.log('Rendering', users.length, 'users');
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>${user.username}</td>
            <td>${new Date(user.created_at).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="removeRoomUser(${user.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Функция для удаления игрока из комнаты
async function removeRoomUser(userId) {
    if (!confirm('Удалить игрока из комнаты?')) return;
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка удаления игрока');
        showMessage('Игрок удален', 'success');
        // Обновляем список игроков
        const roomId = document.getElementById('roomSelectForUsers').value;
        if (roomId) loadRoomUsers(roomId);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка удаления игрока', 'danger');
    }
}