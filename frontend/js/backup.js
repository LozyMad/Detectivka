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
        
        console.log('Backup list response:', data);
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
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Нет доступных бэкапов</td></tr>';
        return;
    }
    
    tbody.innerHTML = backups.map(backup => `
        <tr>
            <td>${backup.filename}</td>
            <td>${formatFileSize(backup.size)}</td>
            <td>${new Date(backup.created).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-primary me-1" onclick="downloadBackup('${backup.filename}')" title="Скачать">
                    <i class="fas fa-download"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteBackup('${backup.filename}')" title="Удалить">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Скачать бэкап
async function downloadBackup(filename) {
    try {
        const token = localStorage.getItem('token');
        
        // Создаем ссылку для скачивания с токеном в URL
        const downloadUrl = `${API_BASE}/backup/download/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
        
        // Создаем временную ссылку и кликаем по ней
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        link.style.display = 'none';
        
        // Добавляем ссылку в DOM, кликаем и удаляем
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showMessage(`Бэкап "${filename}" скачан`, 'success');
        
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка скачивания бэкапа', 'danger');
    }
}

// Удалить бэкап
async function deleteBackup(filename) {
    if (!confirm(`Вы уверены, что хотите удалить бэкап "${filename}"?`)) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/backup/delete/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка удаления');
        
        showMessage(`Бэкап "${filename}" удален`, 'success');
        loadBackupList(); // Обновляем список
        
    } catch (err) {
        console.error(err);
        showMessage(err.message || 'Ошибка удаления бэкапа', 'danger');
    }
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
