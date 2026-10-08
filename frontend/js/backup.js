// ==================== BACKUP (полный пакет сценария / старые таблицы Excel) ====================
const BACKUP_MAX_BYTES = 250 * 1024 * 1024;
let backupBusy = false;

function setBackupBusy(value) {
  backupBusy = value;
  document.querySelectorAll('#backup-tab button, #backup-tab input, #backup-tab select').forEach(element => { element.disabled = value; });
}

async function exportScenarios() {
  if (backupBusy) return;
  const scenarioId = document.getElementById('exportScenarioSelect')?.value;
  if (!scenarioId) { showMessage('Выберите сценарий для экспорта', 'warning'); return; }
  setBackupBusy(true);
  try {
    showMessage('Подготовка полного пакета сценария...', 'info');
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/backup/export?scenario_id=${encodeURIComponent(scenarioId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if ((res.headers.get('Content-Type') || '').includes('application/json')) {
      const data = await res.json();
      throw new Error(data.details ? `${data.error || 'Ошибка экспорта'}: ${data.details}` : (data.error || 'Не удалось получить пакет сценария'));
    }
    if (!res.ok) throw new Error('Не удалось скачать пакет сценария');
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? decodeURIComponent(match[1].trim()) : 'scenario.zip';
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    } finally { URL.revokeObjectURL(url); }
    showMessage('Полный пакет сценария скачан', 'success');
  } catch (err) {
    console.error(err);
    showMessage(err.message || 'Ошибка экспорта сценария', 'danger');
  } finally { setBackupBusy(false); }
}

async function importScenarios() {
  if (backupBusy) return;
  const file = document.getElementById('backupFile')?.files?.[0];
  const folderFiles = Array.from(document.getElementById('backupFolder')?.files || []);
  if (!file && !folderFiles.length) { showMessage('Выберите ZIP-пакет, папку сценария или таблицу Excel', 'warning'); return; }
  if (file && folderFiles.length) { showMessage('Выберите один пакет или одну папку сценария', 'warning'); return; }
  const files = file ? [file] : folderFiles;
  if (files.reduce((sum, item) => sum + item.size, 0) > BACKUP_MAX_BYTES || files.length > 10000) {
    showMessage('Размер пакета — до 250 МБ, не больше 10000 файлов', 'warning'); return;
  }
  if (!file && !folderFiles.some(item => item.webkitRelativePath.endsWith('/scenario.json'))) {
    showMessage('В выбранной папке нет файла scenario.json. Выберите распакованный пакет сценария.', 'warning'); return;
  }
  setBackupBusy(true);
  try {
    showMessage('Импорт сценария и всех материалов...', 'info');
    const formData = new FormData();
    if (file) formData.append('backupFile', file);
    else {
      formData.append('paths', JSON.stringify(folderFiles.map(item => item.webkitRelativePath)));
      folderFiles.forEach(item => formData.append('files', item, item.name));
    }
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/backup/${file ? 'import' : 'import-folder'}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData
    });
    if (!(res.headers.get('Content-Type') || '').includes('application/json')) throw new Error('Сервер не принял пакет. Проверьте ограничение размера загрузки на сервере.');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.details ? `${data.error || 'Ошибка импорта'}: ${data.details}` : (data.error || 'Ошибка импорта'));
    showMessage(`Сценарий «${data.scenario_name}» импортирован`, 'success');
    document.getElementById('importForm')?.reset();
    if (typeof loadScenarios === 'function') await loadScenarios();
    if (typeof populateExportScenarioSelect === 'function') await populateExportScenarioSelect();
  } catch (err) {
    console.error(err);
    showMessage(err.message || 'Ошибка импорта сценария', 'danger');
  } finally { setBackupBusy(false); }
}
