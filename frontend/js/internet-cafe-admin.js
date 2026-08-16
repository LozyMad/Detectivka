// Шаблон блога Бориса Лещака (начало 2010-х)
const BORIS_LESHCHAK_BLOG_TEMPLATE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Блог Бориса Лещака</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #e8e8e8;
    color: #000;
    line-height: 1.5;
  }
  .wrap {
    max-width: 960px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid #ccc;
  }
  .header {
    background: #1a305f;
    color: #fff;
    text-align: center;
    padding: 28px 16px 22px;
  }
  .header h1 {
    font-size: 28px;
    letter-spacing: 1px;
    font-weight: bold;
    text-transform: uppercase;
  }
  .header .tagline {
    margin-top: 8px;
    font-size: 13px;
    font-weight: normal;
  }
  .nav {
    text-align: center;
    padding: 10px;
    border-bottom: 1px solid #ccc;
    background: #fff;
  }
  .nav a {
    color: #0000cc;
    margin: 0 14px;
    font-size: 14px;
  }
  .main {
    display: flex;
    padding: 20px;
    gap: 0;
  }
  .post {
    flex: 1;
    padding-right: 24px;
    border-right: 1px solid #ccc;
    min-width: 0;
  }
  .post .cat {
    color: #0000cc;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .post h2 {
    font-size: 22px;
    margin-bottom: 6px;
    font-weight: bold;
  }
  .post .meta {
    color: #777;
    font-size: 12px;
    margin-bottom: 16px;
  }
  .post p {
    margin-bottom: 14px;
    font-size: 14px;
  }
  .post-footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #ccc;
    font-size: 12px;
    color: #555;
  }
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    padding-left: 20px;
    font-size: 13px;
  }
  .sidebar h3 {
    color: #0000cc;
    font-size: 12px;
    text-transform: uppercase;
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
    margin: 0 0 10px;
  }
  .sidebar .block { margin-bottom: 22px; }
  .sidebar a { color: #0000cc; display: block; margin: 4px 0; }
  .sidebar .stat { margin: 3px 0; }
  .footer {
    text-align: center;
    padding: 14px;
    border-top: 1px solid #ccc;
    font-size: 12px;
    color: #555;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>БЛОГ БОРИСА ЛЕЩАКА</h1>
    <div class="tagline">Личный журнал. Мнения, которые не всем нравятся.</div>
  </div>
  <div class="nav">
    <a href="#">Главная</a>
    <a href="#">Архив</a>
    <a href="#">О себе</a>
    <a href="#">Гостевая</a>
  </div>
  <div class="main">
    <div class="post">
      <div class="cat">ГОРОД / ПРОИСШЕСТВИЯ</div>
      <h2>Смерть Вероники Гронской: трагедия или расплата?</h2>
      <div class="meta">сегодня, 08:42</div>
      <p>Город всё ещё обсуждает смерть журналистки Вероники Гронской. Одни называют её бесстрашной, другие — слишком принципиальной. Одно ясно: каждое расследование имеет свою цену.</p>
      <p>Она слишком быстро стала известной. Слишком часто лезла туда, куда другие предпочитали не смотреть. Кому-то это мешало. Кому-то — портило бизнес.</p>
      <p>Полиция говорит о самоубийстве. Но сколько людей хотели, чтобы она замолчала?</p>
      <div class="post-footer">Просмотров: 12 487 | Комментариев: 37</div>
    </div>
    <div class="sidebar">
      <div class="block">
        <h3>СТАТИСТИКА</h3>
        <div class="stat">Всего просмотров: 38 614</div>
        <div class="stat">Сегодня: 1 293</div>
      </div>
      <div class="block">
        <h3>АРХИВ</h3>
        <a href="#">Сентябрь 2010</a>
        <a href="#">Август 2010</a>
        <a href="#">Июль 2010</a>
      </div>
      <div class="block">
        <h3>ПОСЛЕДНИЕ ЗАПИСИ</h3>
        <a href="#">Город боится правды</a>
        <a href="#">Кому выгодна тишина?</a>
        <a href="#">Ночные улицы</a>
      </div>
    </div>
  </div>
  <div class="footer">© 2010 Борис Лещак. Все права на мнение защищены.</div>
</div>
</body>
</html>`;

let internetPagesCache = [];
let editingInternetPageId = null;

function formatAddressLabel(a) {
  if (!a) return '';
  const apt = a.apartment ? `, кв. ${a.apartment}` : '';
  return `${a.district} ${a.house_number}${apt}`;
}

function isCafeAddress(a) {
  return !!(a && (a.is_internet_cafe === true || a.is_internet_cafe === 1 || a.is_internet_cafe === '1'));
}

async function loadInternetPagesSection() {
  const scenarioSelect = document.getElementById('internetPageScenario');
  if (!scenarioSelect) return;

  const scenarioId = scenarioSelect.value;
  const listEl = document.getElementById('internetPagesList');
  const cafeSelect = document.getElementById('internetPageCafeAddress');
  const unlockSelect = document.getElementById('internetPageUnlockAddress');

  if (!scenarioId) {
    if (listEl) listEl.innerHTML = '<p class="text-muted text-center mb-0">Выберите сценарий</p>';
    if (cafeSelect) cafeSelect.innerHTML = '<option value="">—</option>';
    if (unlockSelect) unlockSelect.innerHTML = '<option value="">—</option>';
    return;
  }

  try {
    const token = localStorage.getItem('token');
    const [addrRes, pagesRes] = await Promise.all([
      fetch(`/api/admin/addresses/${scenarioId}`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch(`/api/internet-cafe/admin/scenarios/${scenarioId}/pages`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    const addrData = await addrRes.json();
    const pagesData = await pagesRes.json();
    const addresses = addrData.addresses || [];
    internetPagesCache = pagesData.pages || [];

    const cafeAddresses = addresses.filter(isCafeAddress);

    if (cafeSelect) {
      cafeSelect.innerHTML =
        '<option value="">Выберите кафе...</option>' +
        cafeAddresses
          .map(
            (a) =>
              `<option value="${a.id}">${formatAddressLabel(a)} — ${(a.description || '').slice(0, 40)}</option>`
          )
          .join('');
    }

    if (unlockSelect) {
      unlockSelect.innerHTML =
        '<option value="">Выберите адрес разблокировки...</option>' +
        addresses
          .map((a) => `<option value="${a.id}">${formatAddressLabel(a)}</option>`)
          .join('');
    }

    renderInternetPagesList(internetPagesCache);
  } catch (error) {
    console.error('Error loading internet pages:', error);
    if (listEl) listEl.innerHTML = '<p class="text-danger text-center mb-0">Ошибка загрузки</p>';
  }
}

function renderInternetPagesList(pages) {
  const listEl = document.getElementById('internetPagesList');
  if (!listEl) return;

  if (!pages || pages.length === 0) {
    listEl.innerHTML = '<p class="text-muted text-center mb-0">Нет интернет-страниц</p>';
    return;
  }

  listEl.innerHTML = pages
    .map((p) => {
      const cafeLabel = p.cafe_district
        ? `${p.cafe_district} ${p.cafe_house_number}${p.cafe_apartment ? ', кв. ' + p.cafe_apartment : ''}`
        : `#${p.cafe_address_id}`;
      const unlockLabel = p.unlock_district
        ? `${p.unlock_district} ${p.unlock_house_number}${p.unlock_apartment ? ', кв. ' + p.unlock_apartment : ''}`
        : `#${p.unlock_address_id}`;
      const active = p.is_active === false || p.is_active === 0 ? false : true;

      return `
        <div class="card mb-2">
          <div class="card-body py-2">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <strong>${escapeHtml(p.title)}</strong>
                ${active ? '<span class="badge bg-success ms-2">Активна</span>' : '<span class="badge bg-secondary ms-2">Выкл</span>'}
                <div class="small text-muted mt-1">
                  Кафе: ${escapeHtml(cafeLabel)} · Разблокировка: ${escapeHtml(unlockLabel)}
                </div>
              </div>
              <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-primary" onclick="editInternetPage(${p.id})">
                  <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn btn-outline-danger" onclick="deleteInternetPage(${p.id})">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>`;
    })
    .join('');
}

function insertBorisBlogTemplate() {
  const ta = document.getElementById('internetPageContent');
  if (!ta) return;
  ta.value = BORIS_LESHCHAK_BLOG_TEMPLATE;
  const title = document.getElementById('internetPageTitle');
  if (title && !title.value.trim()) {
    title.value = 'Блог Бориса Лещака';
  }
}

function resetInternetPageForm() {
  editingInternetPageId = null;
  const form = document.getElementById('internetPageForm');
  if (form) form.reset();
  const btn = document.getElementById('internetPageSubmitBtn');
  if (btn) btn.innerHTML = '<i class="fas fa-plus me-1"></i>Добавить страницу';
  const cancelBtn = document.getElementById('internetPageCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function editInternetPage(pageId) {
  const page = internetPagesCache.find((p) => p.id === pageId);
  if (!page) return;

  editingInternetPageId = pageId;
  document.getElementById('internetPageTitle').value = page.title || '';
  document.getElementById('internetPageContent').value = page.content_html || '';
  document.getElementById('internetPageCafeAddress').value = page.cafe_address_id || '';
  document.getElementById('internetPageUnlockAddress').value = page.unlock_address_id || '';
  document.getElementById('internetPageOrder').value = page.page_order || 1;
  document.getElementById('internetPageActive').checked =
    page.is_active !== false && page.is_active !== 0;

  const btn = document.getElementById('internetPageSubmitBtn');
  if (btn) btn.innerHTML = '<i class="fas fa-save me-1"></i>Сохранить';
  const cancelBtn = document.getElementById('internetPageCancelBtn');
  if (cancelBtn) cancelBtn.style.display = 'inline-block';

  document.getElementById('internetPageForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteInternetPage(pageId) {
  const scenarioId = document.getElementById('internetPageScenario').value;
  if (!scenarioId) return;
  if (!confirm('Удалить эту интернет-страницу?')) return;

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/internet-cafe/admin/scenarios/${scenarioId}/pages/${pageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      showMessage('Страница удалена', 'success');
      if (editingInternetPageId === pageId) resetInternetPageForm();
      loadInternetPagesSection();
    } else {
      const data = await res.json();
      showMessage(data.error || 'Ошибка удаления', 'danger');
    }
  } catch (error) {
    console.error(error);
    showMessage('Ошибка соединения', 'danger');
  }
}

async function handleInternetPageSubmit(e) {
  e.preventDefault();
  const scenarioId = document.getElementById('internetPageScenario').value;
  const title = document.getElementById('internetPageTitle').value.trim();
  const content_html = document.getElementById('internetPageContent').value;
  const cafe_address_id = parseInt(document.getElementById('internetPageCafeAddress').value, 10);
  const unlock_address_id = parseInt(document.getElementById('internetPageUnlockAddress').value, 10);
  const page_order = parseInt(document.getElementById('internetPageOrder').value, 10) || 1;
  const is_active = document.getElementById('internetPageActive').checked;

  if (!scenarioId || !title || !content_html || !cafe_address_id || !unlock_address_id) {
    showMessage('Заполните все обязательные поля', 'danger');
    return;
  }

  const body = {
    title,
    content_html,
    cafe_address_id,
    unlock_address_id,
    page_order,
    is_active
  };

  try {
    const token = localStorage.getItem('token');
    const isEdit = !!editingInternetPageId;
    const url = isEdit
      ? `/api/internet-cafe/admin/scenarios/${scenarioId}/pages/${editingInternetPageId}`
      : `/api/internet-cafe/admin/scenarios/${scenarioId}/pages`;

    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (res.ok) {
      showMessage(isEdit ? 'Страница обновлена' : 'Страница добавлена', 'success');
      resetInternetPageForm();
      document.getElementById('internetPageScenario').value = scenarioId;
      loadInternetPagesSection();
    } else {
      showMessage(data.error || 'Ошибка сохранения', 'danger');
    }
  } catch (error) {
    console.error(error);
    showMessage('Ошибка соединения', 'danger');
  }
}

async function toggleAddressInternetCafe(scenarioId, addressId, enable) {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/addresses/${scenarioId}/${addressId}/internet-cafe`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ is_internet_cafe: !!enable })
    });
    const data = await res.json();
    if (res.ok) {
      showMessage(enable ? 'Адрес отмечен как интернет-кафе' : 'Флаг интернет-кафе снят', 'success');
      loadAddressesForScenario();
      const ipScenario = document.getElementById('internetPageScenario');
      if (ipScenario && ipScenario.value === String(scenarioId)) {
        loadInternetPagesSection();
      }
    } else {
      showMessage(data.error || 'Ошибка обновления', 'danger');
    }
  } catch (error) {
    console.error(error);
    showMessage('Ошибка соединения', 'danger');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('internetPageForm');
  if (form) form.addEventListener('submit', handleInternetPageSubmit);

  const scenarioSelect = document.getElementById('internetPageScenario');
  if (scenarioSelect) {
    scenarioSelect.addEventListener('change', () => {
      resetInternetPageForm();
      loadInternetPagesSection();
    });
  }

  const templateBtn = document.getElementById('insertBlogTemplateBtn');
  if (templateBtn) templateBtn.addEventListener('click', insertBorisBlogTemplate);

  const cancelBtn = document.getElementById('internetPageCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', resetInternetPageForm);
});
