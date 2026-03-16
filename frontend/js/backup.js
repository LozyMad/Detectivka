// ==================== BACKUP (экспорт/импорт сценария) ====================
// Формат: один файл .xlsx с листами «Поездки» и «Вопросы».

async function exportScenarios() {
  const scenarioId = document.getElementById('exportScenarioSelect')?.value;
  if (!scenarioId) {
    showMessage('Выберите сценарий для экспорта', 'warning');
    return;
  }
  try {
    showMessage('Подготовка таблицы...', 'info');
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/backup/export?scenario_id=${encodeURIComponent(scenarioId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка экспорта');
      throw new Error('Сервер вернул JSON вместо таблицы. Обновите backend (перезапустите сервер или задеплойте заново) и попробуйте снова.');
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Ошибка экспорта');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition');
    let filename = 'scenario.xlsx';
    if (disposition) {
      const m = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || disposition.match(/filename="?([^";]+)"?/);
      if (m) filename = decodeURIComponent(m[1].trim());
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('Таблица скачана', 'success');
  } catch (err) {
    console.error(err);
    showMessage(err.message || 'Ошибка экспорта сценария', 'danger');
  }
}

async function importScenarios() {
  const fileInput = document.getElementById('backupFile');
  const file = fileInput?.files?.[0];
  if (!file) {
    showMessage('Выберите файл .xlsx для импорта', 'warning');
    return;
  }
  try {
    showMessage('Импорт сценария...', 'info');
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
    showMessage(`Сценарий «${data.scenario_name}» импортирован`, 'success');
    document.getElementById('importForm')?.reset();
    if (typeof loadScenarios === 'function') loadScenarios();
    if (typeof populateExportScenarioSelect === 'function') populateExportScenarioSelect();
  } catch (err) {
    console.error(err);
    showMessage(err.message || 'Ошибка импорта сценария', 'danger');
  }
}
