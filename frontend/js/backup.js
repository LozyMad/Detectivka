// ==================== BACKUP FUNCTIONS ====================

// Экспорт сценариев
async function exportScenarios() {
    try {
        showMessage('Экспорт сценариев...', 'info');
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/backup/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка экспорта');
        
        showMessage(`Экспорт завершен! Создан файл: ${data.filename}`, 'success');
        loadBackupList(); // Обновляем список бэкапов
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка экспорта сценариев', 'danger');
    }
}

// Импорт сценариев
async function importScenarios() {
    try {
        const fileInput = document.getElementById('backupFile');
        const file = fileInput.files[0];
        
        if (!file) {
            showMessage('Выберите файл для импорта', 'warning');
            return;
        }

        showMessage('Импорт сценариев...', 'info');
        
        const formData = new FormData();
        formData.append('backupFile', file);
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/backup/import`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка импорта');
        
        showMessage(`Импорт завершен! Импортировано: ${data.imported_count}, пропущено: ${data.skipped_count}`, 'success');
        
        // Очищаем форму и обновляем данные
        document.getElementById('importForm').reset();
        loadScenarios(); // Обновляем список сценариев
        loadBackupList(); // Обновляем список бэкапов
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка импорта сценариев', 'danger');
    }
}

// Загрузка списка бэкапов
async function loadBackupList() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/backup/list`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка загрузки списка бэкапов');
        
        displayBackupList(data.backups);
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка загрузки списка бэкапов', 'danger');
    }
}

// Отображение списка бэкапов
function displayBackupList(backups) {
    const tbody = document.getElementById('backupTable');
    if (!tbody) return;
    
    if (!backups || backups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">Нет доступных бэкапов</td></tr>';
        return;
    }
    
    tbody.innerHTML = backups.map(backup => `
        <tr>
            <td>${backup.filename}</td>
            <td>${formatFileSize(backup.size)}</td>
            <td>${new Date(backup.created).toLocaleString()}</td>
        </tr>
    `).join('');
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
