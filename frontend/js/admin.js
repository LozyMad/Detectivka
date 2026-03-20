const API_BASE = '/api';
let currentUser = null;
let scenarios = [];
let roomsCache = null;
let roomsCacheTime = 0;
const CACHE_DURATION = 5000; // 5 секунд кэш
let isSuperAdmin = false;

// Address book state
let addressBookSections = null;
let addressBookSectionsLoaded = false;
let addressBookFilter = {
    category: 'Частные лица',
    letter_group: 'А-Б',
    q: ''
};
let addressBookEditModalInstance = null;

/** Запрос с токеном; при 401/403 — выход и редирект на страницу входа */
async function authFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    const res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/admin-login?session=expired';
        throw new Error('Session expired');
    }
    return res;
}

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
    isSuperAdmin = currentUser.admin_level === 'super_admin';
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
    const restrictedTabs = ['users', 'scenarios', 'permissions', 'backup'];
    
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
                tabLink.style.visibility = 'visible';
                tabLink.style.opacity = '1';
                console.log(`Showing tab: ${tabName}`);
                console.log(`Tab ${tabName} computed styles:`, {
                    display: window.getComputedStyle(tabLink).display,
                    visibility: window.getComputedStyle(tabLink).visibility,
                    opacity: window.getComputedStyle(tabLink).opacity
                });
            } else {
                console.log(`Tab not found: ${tabName}`);
            }
        });
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

// -----------------------------
// Address Book (admin)
// -----------------------------

function escapeHtml(value) {
    const str = value === null || value === undefined ? '' : String(value);
    return str.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[m]);
}

function renderAddressBookActiveLabel() {
    const labelEl = document.getElementById('addressBookActiveLabel');
    if (!labelEl) return;
    const { category, letter_group, q } = addressBookFilter;

    // Если пользователь ввел поиск, показываем что поиск выполняется по всей книге
    if (q && String(q).trim().length > 0) {
        labelEl.textContent = `Поиск по всей книге: ${q}`;
        return;
    }
    if (category === 'Частные лица' && letter_group) {
        labelEl.textContent = `Частные лица: ${letter_group}`;
    } else {
        labelEl.textContent = category || '—';
    }
}

function updateAddressBookTabActiveStyles() {
    const privateWrap = document.getElementById('addressBookPrivateTabs');
    if (privateWrap) {
        privateWrap.querySelectorAll('.addressbook-tab-btn').forEach(btn => {
            const lg = btn.dataset.letterGroup;
            btn.classList.toggle('active', addressBookFilter.category === 'Частные лица' && addressBookFilter.letter_group === lg);
        });
    }

    const enterpriseWrap = document.getElementById('addressBookEnterpriseTabs');
    if (enterpriseWrap) {
        enterpriseWrap.querySelectorAll('.addressbook-tab-btn').forEach(btn => {
            const cat = btn.dataset.category;
            btn.classList.toggle('active', addressBookFilter.category === cat);
        });
    }
}

function renderAddressBookEditModalOptions() {
    const categorySelect = document.getElementById('addressBookEditCategory');
    if (!categorySelect || !addressBookSections) return;

    const allCategories = [
        addressBookSections.private_category,
        ...(addressBookSections.enterprise_categories || [])
    ];

    categorySelect.innerHTML = allCategories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    const districtSelect = document.getElementById('addressBookEditDistrict');
    if (districtSelect) {
        const districts = ['С', 'Ю', 'З', 'В', 'Ц', 'П', 'СВ', 'СЗ', 'ЮВ', 'ЮЗ'];
        districtSelect.innerHTML = districts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    }
}

function syncAddressBookEditApartmentVisibility() {
    const wrap = document.getElementById('addressBookEditApartmentWrap');
    if (!wrap) return;
    const category = document.getElementById('addressBookEditCategory')?.value;
    wrap.style.display = category === 'Частные лица' ? '' : 'none';
}

async function loadAddressBookSectionsAndEntries() {
    if (!addressBookSectionsLoaded) {
        const response = await authFetch(`${API_BASE}/admin/address-book/sections`);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            showMessage(data.error || 'Ошибка загрузки разделов адресной книги', 'danger');
            return;
        }
        const data = await response.json();
        addressBookSections = data;
        addressBookSectionsLoaded = true;

        // Render tabs
        const privateTabs = document.getElementById('addressBookPrivateTabs');
        if (privateTabs) {
            privateTabs.innerHTML = '';
            (data.private_letter_groups || []).forEach(group => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'addressbook-tab-btn';
                btn.textContent = group;
                btn.dataset.letterGroup = group;
                btn.addEventListener('click', () => {
                    addressBookFilter.category = data.private_category;
                    addressBookFilter.letter_group = group;
                    renderAddressBookActiveLabel();
                    updateAddressBookTabActiveStyles();
                    loadAddressBookEntries();
                });
                privateTabs.appendChild(btn);
            });
        }

        const enterpriseTabs = document.getElementById('addressBookEnterpriseTabs');
        if (enterpriseTabs) {
            enterpriseTabs.innerHTML = '';
            (data.enterprise_categories || []).forEach(cat => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'addressbook-tab-btn';
                btn.textContent = cat;
                btn.dataset.category = cat;
                btn.addEventListener('click', () => {
                    addressBookFilter.category = cat;
                    addressBookFilter.letter_group = null;
                    renderAddressBookActiveLabel();
                    updateAddressBookTabActiveStyles();
                    loadAddressBookEntries();
                });
                enterpriseTabs.appendChild(btn);
            });
        }

        // Default filter: first letter group
        if (addressBookSections.private_letter_groups && addressBookSections.private_letter_groups.length > 0) {
            addressBookFilter.category = addressBookSections.private_category;
            addressBookFilter.letter_group = addressBookSections.private_letter_groups[0];
        } else {
            addressBookFilter.category = 'Частные лица';
            addressBookFilter.letter_group = 'А-Б';
        }

        renderAddressBookEditModalOptions();

        const categorySelect = document.getElementById('addressBookEditCategory');
        if (categorySelect && !categorySelect.dataset.bound) {
            categorySelect.dataset.bound = '1';
            categorySelect.addEventListener('change', () => syncAddressBookEditApartmentVisibility());
        }
    }

    renderAddressBookActiveLabel();
    updateAddressBookTabActiveStyles();
    await loadAddressBookEntries();
}

async function loadAddressBookEntries() {
    const tbody = document.getElementById('addressBookTableBody');
    const hint = document.getElementById('addressBookLoadingHint');
    if (!tbody) return;

    if (!addressBookSectionsLoaded) {
        // Загружаем структуру один раз
        await loadAddressBookSectionsAndEntries();
        return;
    }

    const searchInput = document.getElementById('addressBookSearch');
    addressBookFilter.q = searchInput ? (searchInput.value || '').trim() : '';

    try {
        if (hint) hint.textContent = 'Загрузка...';
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Загрузка...</td></tr>';

        const qs = new URLSearchParams();
        qs.set('category', addressBookFilter.category);
        if (addressBookFilter.category === 'Частные лица' && addressBookFilter.letter_group) {
            qs.set('letter_group', addressBookFilter.letter_group);
        }
        if (addressBookFilter.q) qs.set('q', addressBookFilter.q);

        const response = await authFetch(`${API_BASE}/admin/address-book/entries?${qs.toString()}`);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Ошибка загрузки адресной книги');
        }
        const data = await response.json();
        const entries = data.entries || [];

        const showActions = isSuperAdmin;
        const actionsHeader = document.getElementById('addressBookActionsHeader');
        if (actionsHeader) actionsHeader.style.display = showActions ? '' : 'none';
        const addBtn = document.getElementById('addressBookAddBtn');
        if (addBtn) addBtn.classList.toggle('d-none', !showActions);

        if (entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center">Ничего не найдено</td></tr>`;
            if (hint) hint.textContent = '';
            return;
        }

        tbody.innerHTML = entries.map(e => {
            const apartment = e.apartment || '';
            const note = e.note || '';
            const name = e.name || '';

            const actionsCell = showActions
                ? `<td class="text-center" style="white-space:nowrap;">
                    <button type="button" class="btn btn-sm btn-outline-primary" onclick="openAddressBookEditModal(${e.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                </td>`
                : `<td class="text-center" style="display:none;"></td>`;

            return `
                <tr>
                    <td>${escapeHtml(e.district || '')}</td>
                    <td>${escapeHtml(e.house_number || '')}</td>
                    <td>${escapeHtml(apartment)}</td>
                    <td>${escapeHtml(name)}</td>
                    <td>${escapeHtml(note)}</td>
                    ${actionsCell}
                </tr>
            `;
        }).join('');

        if (hint) hint.textContent = `${entries.length} записей`;
        renderAddressBookActiveLabel();
    } catch (err) {
        console.error('loadAddressBookEntries error:', err);
        showMessage(err.message || 'Ошибка загрузки адресной книги', 'danger');
        if (hint) hint.textContent = '';
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Ошибка загрузки</td></tr>`;
    }
}

async function openAddressBookAddModal() {
    if (!isSuperAdmin) return;
    if (!addressBookSectionsLoaded) {
        await loadAddressBookSectionsAndEntries();
    }
    document.getElementById('addressBookEditId').value = '';
    document.getElementById('addressBookEditCategory').value = addressBookSections?.private_category || 'Частные лица';
    document.getElementById('addressBookEditDistrict').value = 'Ц';
    document.getElementById('addressBookEditHouseNumber').value = '';
    document.getElementById('addressBookEditApartment').value = '';
    document.getElementById('addressBookEditName').value = '';
    document.getElementById('addressBookEditNote').value = '';
    syncAddressBookEditApartmentVisibility();
    const deleteBtn = document.getElementById('addressBookDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';
    renderAddressBookEditModalOptions();
    const modalEl = document.getElementById('addressBookEditModal');
    addressBookEditModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    addressBookEditModalInstance.show();
}

async function openAddressBookEditModal(entryId) {
    if (!isSuperAdmin) {
        showMessage('Редактирование доступно только супер-админу', 'warning');
        return;
    }

    if (!addressBookSectionsLoaded) {
        await loadAddressBookSectionsAndEntries();
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/address-book/entries/${entryId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Ошибка загрузки записи');
        }

        const data = await response.json();
        const entry = data.entry;
        if (!entry) throw new Error('Запись не найдена');

        document.getElementById('addressBookEditId').value = entry.id;
        document.getElementById('addressBookEditCategory').value = entry.category;
        document.getElementById('addressBookEditDistrict').value = entry.district;
        document.getElementById('addressBookEditHouseNumber').value = entry.house_number || '';
        document.getElementById('addressBookEditApartment').value = entry.apartment || '';
        document.getElementById('addressBookEditName').value = entry.name || '';
        document.getElementById('addressBookEditNote').value = entry.note || '';

        syncAddressBookEditApartmentVisibility();
        const deleteBtn = document.getElementById('addressBookDeleteBtn');
        if (deleteBtn) deleteBtn.style.display = '';

        const modalEl = document.getElementById('addressBookEditModal');
        addressBookEditModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        addressBookEditModalInstance.show();
    } catch (err) {
        console.error('openAddressBookEditModal error:', err);
        showMessage(err.message || 'Ошибка открытия редактора', 'danger');
    }
}

async function saveAddressBookEntry() {
    if (!isSuperAdmin) return;
    const id = (document.getElementById('addressBookEditId').value || '').trim();
    const category = document.getElementById('addressBookEditCategory').value;
    const district = document.getElementById('addressBookEditDistrict').value;
    const house_number = document.getElementById('addressBookEditHouseNumber').value;
    const apartmentWrap = document.getElementById('addressBookEditApartmentWrap');
    const apartment = apartmentWrap && apartmentWrap.style.display === 'none'
        ? ''
        : document.getElementById('addressBookEditApartment').value;
    const name = document.getElementById('addressBookEditName').value;
    const note = document.getElementById('addressBookEditNote').value;

    const payload = { category, district, house_number, apartment, name, note };
    const token = localStorage.getItem('token');
    const isCreate = !id;

    try {
        const response = isCreate
            ? await fetch(`${API_BASE}/super-admin/address-book/entries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            })
            : await fetch(`${API_BASE}/super-admin/address-book/entries/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || (isCreate ? 'Ошибка добавления' : 'Ошибка сохранения'));

        showMessage(isCreate ? 'Адрес добавлен' : 'Запись обновлена', 'success');

        const modalEl = document.getElementById('addressBookEditModal');
        const inst = bootstrap.Modal.getInstance(modalEl) || addressBookEditModalInstance;
        inst && inst.hide();

        await loadAddressBookEntries();
    } catch (err) {
        console.error('saveAddressBookEntry error:', err);
        showMessage(err.message || 'Ошибка сохранения записи', 'danger');
    }
}

async function deleteAddressBookEntry() {
    if (!isSuperAdmin) return;
    const id = document.getElementById('addressBookEditId').value;
    if (!id) return;

    if (!confirm('Удалить запись адресной книги?')) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/super-admin/address-book/entries/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Ошибка удаления');

        showMessage('Запись удалена', 'success');

        const modalEl = document.getElementById('addressBookEditModal');
        const inst = bootstrap.Modal.getInstance(modalEl) || addressBookEditModalInstance;
        inst && inst.hide();

        await loadAddressBookEntries();
    } catch (err) {
        console.error('deleteAddressBookEntry error:', err);
        showMessage(err.message || 'Ошибка удаления записи', 'danger');
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
    document.getElementById('copyScenarioForm').addEventListener('submit', handleCopyScenario);
    document.getElementById('addAddressForm').addEventListener('submit', handleAddAddress);
    
    // Permissions form
    const grantPermissionForm = document.getElementById('grantPermissionForm');
    if (grantPermissionForm) grantPermissionForm.addEventListener('submit', handleGrantPermission);
    
    // Scenario selection for addresses
    const viewAddressScenario = document.getElementById('viewAddressScenario');
    if (viewAddressScenario) {
        viewAddressScenario.addEventListener('change', loadAddressesForScenario);
    }

    // Address book search (дебаунс)
    const addressBookSearch = document.getElementById('addressBookSearch');
    if (addressBookSearch) {
        let t = null;
        addressBookSearch.addEventListener('input', () => {
            if (t) clearTimeout(t);
            t = setTimeout(() => loadAddressBookEntries(), 350);
        });
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
    const restrictedTabs = ['users', 'scenarios', 'permissions', 'backup'];
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
        populateScenarioDropdowns();
    } else if (tabName === 'statistics') {
        ensureStatsScenarioOptions();
        // Don't auto-load; let user click refresh
    } else if (tabName === 'rooms') {
        // Если данные уже загружены, показываем их сразу
        if (roomsCache && roomsCache.length > 0) {
            displayRooms(roomsCache);
            populateRoomsForUsers(roomsCache);
        } else {
            // Иначе загружаем без показа индикатора загрузки
            loadRooms();
        }
        ensureRoomScenarioOptions();
    } else if (tabName === 'answers') {
        populateAnswersRoomSelect();
    } else if (tabName === 'permissions') {
        loadPermissions();
        populatePermissionDropdowns();
    } else if (tabName === 'backup') {
        loadScenarios().then(() => {
            if (typeof populateExportScenarioSelect === 'function') populateExportScenarioSelect();
        });
    } else if (tabName === 'addressBook') {
        loadAddressBookSectionsAndEntries();
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

async function loadInitialData() {
    // Параллельная загрузка данных для ускорения
    const promises = [];
    
    // Загружаем сценарии для всех админов
    promises.push(loadScenarios());
    
    // Загружаем пользователей только для супер-админа
    if (currentUser.admin_level === 'super_admin') {
        promises.push(loadUsers());
    }
    
    // Предзагружаем комнаты для быстрого доступа
    promises.push(loadRooms());
    
    // Ждем завершения всех запросов
    await Promise.all(promises);
    
    // Заполняем выпадающие списки
    populateScenarioDropdowns();
    ensureStatsScenarioOptions();
    ensureRoomScenarioOptions();
    populateAnswersRoomSelect();
}

// Users management
async function loadUsers() {
    try {
        const response = await authFetch(`${API_BASE}/admin/users`);

        if (response.status === 401 || response.status === 403) {
            return; // authFetch уже перенаправил на логин
        }

        if (!response.ok) {
            if (response.status === 500) {
                showMessage('Серверная ошибка при загрузке пользователей. Попробуйте позже.', 'danger');
            } else {
                showMessage('Ошибка загрузки пользователей', 'danger');
            }
            return;
        }

        const data = await response.json();
        displayUsers(data.users);
    } catch (error) {
        if (error.message === 'Session expired') return;
        console.error('Error loading users:', error);
        showMessage('Ошибка загрузки пользователей. Проверьте подключение.', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

// Scenarios management
async function loadScenarios() {
    try {
        const response = await authFetch(`${API_BASE}/admin/scenarios`);

        if (!response.ok) {
            throw new Error('Failed to load scenarios');
        }

        const data = await response.json();
        scenarios = data.scenarios;
        displayScenarios(scenarios);
    } catch (error) {
        if (error.message === 'Session expired') return;
        console.error('Error loading scenarios:', error);
        showMessage('Ошибка загрузки сценариев', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

async function handleCopyScenario(e) {
    e.preventDefault();
    
    const sourceId = document.getElementById('sourceScenarioSelect').value;
    const newName = document.getElementById('newScenarioName').value;
    
    if (!sourceId || !newName) {
        showMessage('Пожалуйста, выберите исходный сценарий и введите название для копии', 'warning');
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        
        const response = await fetch(`${API_BASE}/admin/scenarios/copy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                source_id: parseInt(sourceId), 
                new_name: newName 
            })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(`Сценарий "${newName}" успешно скопирован со всеми адресами и выборами`, 'success');
            e.target.reset();
            await loadScenarios();
            populateScenarioDropdowns();
        } else {
            showMessage(data.error || 'Ошибка копирования сценария', 'danger');
        }
    } catch (error) {
        console.error('Error copying scenario:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

async function editScenario(scenarioId) {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) return;

    document.getElementById('editScenarioId').value = scenario.id;
    document.getElementById('editScenarioName').value = scenario.name;
    document.getElementById('editScenarioDescription').value = scenario.description || '';

    // Load questions for this scenario
    await loadScenarioQuestions(scenarioId);

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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

// Load questions for scenario editing
async function loadScenarioQuestions(scenarioId) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/questions?scenario_id=${scenarioId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (response.ok) {
            displayEditQuestions(data.questions || []);
        } else {
            console.error('Error loading questions:', data.error);
            displayEditQuestions([]);
        }
    } catch (error) {
        console.error('Error loading questions:', error);
        displayEditQuestions([]);
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

// Display questions in edit modal
function displayEditQuestions(questions) {
    const container = document.getElementById('editScenarioQuestions');
    if (!container) return;

    if (questions.length === 0) {
        container.innerHTML = '<p class="text-muted">Нет вопросов</p>';
        return;
    }

    container.innerHTML = questions.map(question => `
        <div class="input-group mb-2" data-question-id="${question.id}">
            <input type="text" class="form-control" value="${question.question_text}" 
                   onchange="updateQuestion(${question.id}, this.value)">
            <button type="button" class="btn btn-outline-danger" onclick="deleteQuestion(${question.id})">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

// Add new question in edit modal
async function addEditQuestion() {
    const questionText = document.getElementById('editNewQuestion').value.trim();
    if (!questionText) return;

    const scenarioId = document.getElementById('editScenarioId').value;
    if (!scenarioId) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/questions`, {
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

        const data = await response.json();

        if (response.ok) {
            showMessage('Вопрос добавлен', 'success');
            document.getElementById('editNewQuestion').value = '';
            await loadScenarioQuestions(scenarioId);
        } else {
            showMessage(data.error || 'Ошибка добавления вопроса', 'danger');
        }
    } catch (error) {
        console.error('Error adding question:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

// Update existing question
async function updateQuestion(questionId, newText) {
    if (!newText.trim()) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/questions/${questionId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ question_text: newText })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Вопрос обновлен', 'success');
        } else {
            showMessage(data.error || 'Ошибка обновления вопроса', 'danger');
        }
    } catch (error) {
        console.error('Error updating question:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

// Delete question
async function deleteQuestion(questionId) {
    if (!confirm('Удалить этот вопрос?')) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/questions/${questionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Вопрос удален', 'success');
            const scenarioId = document.getElementById('editScenarioId').value;
            await loadScenarioQuestions(scenarioId);
        } else {
            showMessage(data.error || 'Ошибка удаления вопроса', 'danger');
        }
    } catch (error) {
        console.error('Error deleting question:', error);
        showMessage('Ошибка соединения', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

// Addresses management
async function loadAddressesForScenario() {
    const scenarioId = document.getElementById('viewAddressScenario').value;
    const addressesTable = document.getElementById('addressesTable');
    
    if (!scenarioId) {
        addressesTable.innerHTML = '<tr><td colspan="7" class="text-center">Выберите сценарий для просмотра адресов</td></tr>';
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
                addressesTable.innerHTML = '<tr><td colspan="7" class="text-center">Адреса для этого сценария не найдены</td></tr>';
            } else {
                const addressesWithChoices = await Promise.all(
                    addresses.map(async (address) => {
                        const hasChoices = await checkAddressHasChoices(scenarioId, address.id);
                        return { ...address, hasChoices };
                    })
                );
                const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\');
                addressesTable.innerHTML = addressesWithChoices.map(address => `
                    <tr>
                        <td>${address.id}</td>
                        <td>${escapeHtml(address.district)}</td>
                        <td>${escapeHtml(address.house_number)}</td>
                        <td>${escapeHtml(address.apartment || '-')}</td>
                        <td>${escapeHtml(address.description || '-')}</td>
                        <td class="text-center">
                            ${address.hasChoices ? 
                                '<span class="badge bg-success"><i class="fas fa-check"></i> Есть</span>' : 
                                '<span class="badge bg-secondary">Нет</span>'
                            }
                        </td>
                        <td class="table-actions">
                            <button class="btn btn-sm btn-outline-primary me-1" 
                                    onclick="openChoicesModal(${scenarioId}, ${address.id}, {district: '${esc(address.district)}', house_number: '${esc(address.house_number)}', apartment: '${esc(address.apartment || '')}', description: '${esc(address.description || '')}'})">
                                <i class="fas fa-question-circle"></i>
                            </button>
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
            addressesTable.innerHTML = '<tr><td colspan="7" class="text-center">Ошибка загрузки адресов</td></tr>';
        }
    } catch (error) {
        console.error('Error loading addresses:', error);
        showMessage('Ошибка соединения', 'danger');
        addressesTable.innerHTML = '<tr><td colspan="7" class="text-center">Ошибка соединения</td></tr>';
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

function populateScenarioDropdowns() {
    const addDropdown = document.getElementById('addressScenario');
    const viewDropdown = document.getElementById('viewAddressScenario');
    const copyDropdown = document.getElementById('sourceScenarioSelect');

    const options = scenarios.map(scenario =>
        `<option value="${scenario.id}">${scenario.name}</option>`
    ).join('');

    addDropdown.innerHTML = '<option value="">Выберите сценарий...</option>' + options;
    viewDropdown.innerHTML = '<option value="">Выберите сценарий для просмотра...</option>' + options;

    if (copyDropdown) {
        copyDropdown.innerHTML = '<option value="">Выберите сценарий для копирования</option>' + options;
    }

    ensureStatsScenarioOptions();
    ensureRoomScenarioOptions();
    if (typeof populateExportScenarioSelect === 'function') populateExportScenarioSelect();
}

function populateExportScenarioSelect() {
    const sel = document.getElementById('exportScenarioSelect');
    if (!sel) return;
    const options = (typeof scenarios !== 'undefined' && scenarios.length)
        ? scenarios.map(s => `<option value="${s.id}">${s.name}</option>`).join('')
        : '';
    sel.innerHTML = '<option value="">Выберите сценарий...</option>' + options;
}

function ensureStatsScenarioOptions() {
    const select = document.getElementById('statsScenarioSelect');
    if (!select) return;
    const options = scenarios.map(s => `<option value="${s.id}">${s.name} ${s.is_active ? '(активный)' : ''}</option>`).join('');
    select.innerHTML = '<option value="">Выберите сценарий...</option>' + options;
}

// Загрузка статистики по сценарию
async function loadStatistics() {
    const scenarioSelect = document.getElementById('statsScenarioSelect');
    const statsTable = document.getElementById('statsTable');
    
    if (!scenarioSelect || !statsTable) return;
    
    const scenarioId = scenarioSelect.value;
    if (!scenarioId) {
        statsTable.innerHTML = '<tr><td colspan="4" class="text-center">Выберите сценарий и нажмите Обновить</td></tr>';
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/statistics/${scenarioId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('Нет доступа к статистике этого сценария');
            }
            throw new Error('Failed to load statistics');
        }
        
        const data = await response.json();
        const stats = data.stats || [];
        
        if (stats.length === 0) {
            statsTable.innerHTML = '<tr><td colspan="4" class="text-center">Нет данных для выбранного сценария</td></tr>';
            return;
        }
        
        // Отображаем статистику в таблице
        statsTable.innerHTML = stats.map(stat => `
            <tr>
                <td>${stat.district}</td>
                <td>${stat.total_attempts}</td>
                <td class="text-success">${stat.found_count}</td>
                <td class="text-danger">${stat.not_found_count}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading statistics:', error);
        statsTable.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Ошибка загрузки статистики</td></tr>';
        showMessage('Ошибка загрузки статистики', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
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
        await loadRooms(true);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка создания комнаты', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

async function loadRooms(forceRefresh = false) {
    try {
        const now = Date.now();
        
        // Проверяем кэш, если не принудительное обновление
        if (!forceRefresh && roomsCache && (now - roomsCacheTime) < CACHE_DURATION) {
            displayRooms(roomsCache);
            populateRoomsForUsers(roomsCache);
            return;
        }
        
        const res = await authFetch(`${API_BASE}/rooms`);
        if (!res.ok) throw new Error('Failed to load rooms');
        const data = await res.json();

        // Обновляем кэш
        roomsCache = data.rooms || [];
        roomsCacheTime = now;

        displayRooms(roomsCache);
        populateRoomsForUsers(roomsCache);
    } catch (err) {
        if (err.message === 'Session expired') return;
        console.error(err);
        // Показываем пустой список вместо ошибки для лучшего UX
        displayRooms([]);
        populateRoomsForUsers([]);
        showMessage('Ошибка загрузки комнат', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

function displayRooms(rooms) {
    const tbody = document.getElementById('roomsTable');
    if (!tbody) return;
    if (!rooms.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Нет комнат</td></tr>';
        return;
    }
    tbody.innerHTML = rooms.map(r => {
        // Найти название сценария по ID
        const scenario = scenarios.find(s => s.id === r.scenario_id);
        const scenarioName = r.scenario_name || (scenario ? scenario.name : `Сценарий ${r.scenario_id}`);
        
        return `
        <tr>
            <td>${r.id}</td>
            <td>${r.name}</td>
            <td style="color: var(--noir-cream) !important;">${scenarioName}</td>
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
    `;
    }).join('');
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
        await loadRooms(true);
        // refresh users list if open
        const cur = document.getElementById('roomSelectForUsers').value;
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка запуска комнаты', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

async function pauseRoom(roomId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/pause`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка паузы');
        showMessage('Таймер на паузе', 'warning');
        await loadRooms(true);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка паузы комнаты', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

async function resumeRoom(roomId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/resume`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка продолжения');
        showMessage('Таймер продолжен', 'info');
        await loadRooms(true);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка продолжения комнаты', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

async function stopRoom(roomId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/rooms/${roomId}/stop`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка остановки');
        showMessage('Таймер остановлен', 'danger');
        await loadRooms(true);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка остановки комнаты', 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

function viewRoomUsers(roomId) {
    const select = document.getElementById('roomSelectForUsers');
    if (select) {
        select.value = String(roomId);
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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
        loadRooms(true);
    } catch (err) {
        console.error(err);
        showMessage('Ошибка удаления комнаты: ' + err.message, 'danger');
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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
    const apartment = (document.getElementById('addressApartment') && document.getElementById('addressApartment').value) ? document.getElementById('addressApartment').value.trim() : '';
    const description = document.getElementById('addressDescription').value;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/addresses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ scenario_id, district, house_number, apartment, description })
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

function showLoadingIndicator(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.opacity = '0.5';
        element.style.pointerEvents = 'none';
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}

function hideLoadingIndicator(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.opacity = '1';
        element.style.pointerEvents = 'auto';
    }
}

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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
        const collapseId = `answers-team-${user.id != null ? user.id : userIndex}`;
        html += `
            <div class="card mb-4">
                <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center pe-3" role="button" tabindex="0" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="true" aria-controls="${collapseId}" style="cursor: pointer;">
                    <h6 class="mb-0">
                        <i class="fas fa-chevron-down me-2 collapse-icon"></i>
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
                <div class="collapse show" id="${collapseId}">
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
        
        // Добавляем детальную информацию о поездках
        if (user.trip_details && user.trip_details.length > 0) {
            html += `
                <div class="mt-3">
                    <h6 class="text-primary">
                        <i class="fas fa-car me-2"></i>Детали поездок:
                    </h6>
                    <div class="table-responsive">
                        <table class="table table-sm table-striped">
                            <thead>
                                <tr>
                                    <th>Время</th>
                                    <th>Адрес</th>
                                    <th>Результат</th>
                                    <th>Описание</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            user.trip_details.forEach(trip => {
                const resultClass = trip.found ? 'text-success' : 'text-danger';
                const resultIcon = trip.found ? 'fa-check-circle' : 'fa-times-circle';
                const resultText = trip.found ? 'Найдено' : 'Не найдено';
                
                html += `
                    <tr>
                        <td>${new Date(trip.attempted_at).toLocaleString('ru-RU')}</td>
                        <td><span class="badge bg-primary">${trip.district}</span> ${trip.house_number}</td>
                        <td><i class="fas ${resultIcon} ${resultClass}"></i> ${resultText}</td>
                        <td>${trip.address_description || '-'}</td>
                    </tr>
                `;
            });
            
            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="mt-3">
                    <p class="text-muted">
                        <i class="fas fa-car me-2"></i>Поездок пока не было
                    </p>
                </div>
            `;
        }
        
        html += `
                </div>
                </div>
            </div>
        `;
    });
    
    answersList.innerHTML = html;
    
    // Поворачиваем иконку шеврона при сворачивании/разворачивании
    answersList.querySelectorAll('[data-bs-toggle="collapse"]').forEach(trigger => {
        const targetId = trigger.getAttribute('data-bs-target');
        const target = targetId ? document.querySelector(targetId) : null;
        const icon = trigger.querySelector('.collapse-icon');
        if (icon && target) {
            target.addEventListener('show.bs.collapse', () => { if (icon) { icon.classList.remove('fa-chevron-right'); icon.classList.add('fa-chevron-down'); } });
            target.addEventListener('hide.bs.collapse', () => { if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-right'); } });
        }
    });
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
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

// Функция ядерного сброса
async function nuclearReset() {
    // Двойное подтверждение для безопасности
    const confirm1 = confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ данные:\n\n' +
        '• Все сценарии\n' +
        '• Все игроки (кроме суперадмина)\n' +
        '• Все комнаты\n' +
        '• Все адреса\n' +
        '• Все выборы\n' +
        '• Все ID будут сброшены\n\n' +
        'Это действие НЕОБРАТИМО!\n\n' +
        'Продолжить?');
    
    if (!confirm1) return;
    
    const confirm2 = confirm('🔥 ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\n' +
        'Вы действительно хотите УНИЧТОЖИТЬ ВСЕ ДАННЫЕ?\n\n' +
        'Введите "ДА" в следующем окне для подтверждения.');
    
    if (!confirm2) return;
    
    const finalConfirm = prompt('Для подтверждения введите "УНИЧТОЖИТЬ ВСЕ":');
    if (finalConfirm !== 'УНИЧТОЖИТЬ ВСЕ') {
        showMessage('Ядерный сброс отменен', 'info');
        return;
    }
    
    try {
        showMessage('💥 Запуск ядерного сброса...', 'warning');
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/nuclear/reset`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при выполнении ядерного сброса');
        }
        
        showMessage('💥 Ядерный сброс выполнен успешно! Все данные удалены, ID сброшены.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (err) {
        console.error('Ошибка ядерного сброса:', err);
        showMessage(err.message || 'Ошибка при выполнении ядерного сброса', 'danger');
    }
}