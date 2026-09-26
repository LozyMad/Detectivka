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

const INTERNET_BLOCK_TYPES = ['heading', 'text', 'image', 'link'];
const INTERNET_BLOCK_MARKER = /<!-- detectivka-blocks:v1:([^\s]*?) -->/;

function escapeInternetHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function internetPageUrl(value) {
  try {
    const input = String(value || '').trim();
    if (!/^https?:\/\//i.test(input) && !/^\/(?!\/)/.test(input)) return null;
    const url = new URL(input, window.location.origin);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function parseInternetBlocks(html) {
  const marker = String(html || '').match(INTERNET_BLOCK_MARKER);
  if (!marker) return null;
  try {
    const blocks = JSON.parse(decodeURIComponent(marker[1]));
    return Array.isArray(blocks) && blocks.every(block =>
      block && INTERNET_BLOCK_TYPES.includes(block.type) &&
      Object.values(block).every(value => typeof value === 'string')) ? blocks : null;
  } catch (_) {
    return null;
  }
}

function createInternetBlock(type, values = {}) {
  if (!INTERNET_BLOCK_TYPES.includes(type)) return;
  const block = document.createElement('div');
  block.className = 'card card-body mb-2 internet-page-block';
  block.dataset.type = type;
  const labels = { heading: 'Заголовок', text: 'Текст', image: 'Изображение', link: 'Ссылка' };
  const fields = {
    heading: '<input class="form-control" data-block-field="text" placeholder="Заголовок раздела">',
    text: '<textarea class="form-control" data-block-field="text" rows="4" placeholder="Текст и абзацы страницы"></textarea>',
    image: '<input class="form-control mb-2" data-block-field="url" placeholder="https://... или /assets/..."><input class="form-control" data-block-field="alt" placeholder="Подпись или описание изображения">',
    link: '<input class="form-control mb-2" data-block-field="text" placeholder="Текст ссылки"><input class="form-control" data-block-field="url" placeholder="https://... или /assets/...">'
  };
  block.innerHTML = `<div class="d-flex justify-content-between align-items-center mb-2">
    <strong>${labels[type]}</strong><div class="btn-group btn-group-sm" aria-label="Порядок блока">
      <button type="button" class="btn btn-outline-secondary" data-block-action="up" aria-label="Поднять блок">↑</button>
      <button type="button" class="btn btn-outline-secondary" data-block-action="down" aria-label="Опустить блок">↓</button>
      <button type="button" class="btn btn-outline-danger" data-block-action="remove" aria-label="Удалить блок">×</button>
    </div></div>${fields[type]}`;
  block.querySelectorAll('[data-block-field]').forEach(field => {
    field.value = values[field.dataset.blockField] || '';
  });
  document.getElementById('internetPageBlocks').appendChild(block);
}

function readInternetBlocks() {
  return [...document.querySelectorAll('#internetPageBlocks .internet-page-block')].map(block => {
    const data = { type: block.dataset.type };
    block.querySelectorAll('[data-block-field]').forEach(field => {
      data[field.dataset.blockField] = field.value.trim();
    });
    return data;
  });
}

function buildInternetPageHtml(title, blocks) {
  if (!blocks.length) throw new Error('Добавьте хотя бы один блок страницы');
  const content = blocks.map((block, index) => {
    const number = index + 1;
    if (block.type === 'heading' || block.type === 'text') {
      if (!block.text) throw new Error(`Заполните блок ${number}`);
      return block.type === 'heading'
        ? `<h2>${escapeInternetHtml(block.text)}</h2>`
        : `<p>${escapeInternetHtml(block.text)}</p>`;
    }
    const url = internetPageUrl(block.url);
    if (!url) throw new Error(`Укажите корректный адрес в блоке ${number}`);
    if (block.type === 'image') return `<figure><img src="${escapeInternetHtml(url)}" alt="${escapeInternetHtml(block.alt)}">${block.alt ? `<figcaption>${escapeInternetHtml(block.alt)}</figcaption>` : ''}</figure>`;
    if (block.type === 'link') {
      if (!block.text) throw new Error(`Укажите текст ссылки в блоке ${number}`);
      return `<p><a href="${escapeInternetHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeInternetHtml(block.text)}</a></p>`;
    }
    throw new Error(`Неизвестный блок ${number}`);
  }).join('\n');
  const marker = `<!-- detectivka-blocks:v1:${encodeURIComponent(JSON.stringify(blocks))} -->`;
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeInternetHtml(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#222;font:16px/1.6 Arial,Helvetica,sans-serif}.site{max-width:860px;margin:20px auto;background:#fff;border:1px solid #aab3c0;box-shadow:0 2px 9px #0002}header{padding:24px 28px;background:#243b68;color:#fff;border-bottom:4px solid #b4c3df}h1{font-size:28px;margin:0}main{padding:28px}h2{font-size:22px;margin:1.4em 0 .5em;color:#243b68}h2:first-child{margin-top:0}p{margin:0 0 1.2em;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#164ca0;text-decoration:underline}figure{margin:1.5em 0}img{display:block;max-width:100%;height:auto}figcaption{color:#596270;font-size:13px;margin-top:6px}@media(max-width:600px){.site{margin:0;border:0}header,main{padding:18px}}</style></head><body><div class="site"><header><h1>${escapeInternetHtml(title)}</h1></header><main>${content}</main></div>${marker}</body></html>`;
}

function internetEditorMode() {
  return document.getElementById('internetPageHtmlMode').checked ? 'html' : 'blocks';
}

function setInternetEditorMode(mode, force = false) {
  const htmlField = document.getElementById('internetPageContent');
  const previousMode = document.getElementById('internetPageHtmlEditor').hidden ? 'blocks' : 'html';
  if (!force && mode === 'blocks' && previousMode === 'html' && htmlField.value.trim()) {
    if (!confirm('Переход к простому редактору заменит текущий HTML содержимым блоков. Продолжить?')) {
      document.getElementById('internetPageHtmlMode').checked = true;
      return;
    }
    document.getElementById('internetPageBlocks').innerHTML = '';
    createInternetBlock('text');
  }
  if (!force && mode === 'html' && previousMode === 'blocks') {
    try {
      htmlField.value = buildInternetPageHtml(document.getElementById('internetPageTitle').value.trim(), readInternetBlocks())
        .replace(INTERNET_BLOCK_MARKER, '');
    } catch (_) {
      htmlField.value = '';
    }
  }
  document.getElementById(mode === 'html' ? 'internetPageHtmlMode' : 'internetPageBlocksMode').checked = true;
  document.getElementById('internetPageBlocksEditor').hidden = mode !== 'blocks';
  document.getElementById('internetPageHtmlEditor').hidden = mode !== 'html';
  document.getElementById('internetPagePreview').style.display = 'none';
}

function previewInternetPage() {
  try {
    const title = document.getElementById('internetPageTitle').value.trim();
    const html = internetEditorMode() === 'blocks'
      ? buildInternetPageHtml(title, readInternetBlocks())
      : document.getElementById('internetPageContent').value.trim();
    if (!title || !html) throw new Error('Заполните название и содержимое страницы');
    const preview = document.getElementById('internetPagePreview');
    preview.srcdoc = html;
    preview.style.display = 'block';
  } catch (error) {
    showMessage(error.message, 'danger');
  }
}

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
                <span class="badge bg-secondary ms-1">${parseInternetBlocks(p.content_html) ? 'Блоки' : 'HTML'}</span>
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
  document.getElementById('internetPageContent').value = '';
  document.getElementById('internetPageBlocks').innerHTML = '';
  createInternetBlock('text');
  setInternetEditorMode('blocks', true);
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
  document.getElementById('internetPageBlocks').innerHTML = '';
  const blocks = parseInternetBlocks(page.content_html);
  if (blocks) blocks.forEach(block => createInternetBlock(block.type, block));
  else createInternetBlock('text');
  setInternetEditorMode(blocks ? 'blocks' : 'html', true);
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
  let content_html;
  const cafe_address_id = parseInt(document.getElementById('internetPageCafeAddress').value, 10);
  const unlock_address_id = parseInt(document.getElementById('internetPageUnlockAddress').value, 10);
  const page_order = parseInt(document.getElementById('internetPageOrder').value, 10) || 1;
  const is_active = document.getElementById('internetPageActive').checked;

  try {
    content_html = internetEditorMode() === 'blocks'
      ? buildInternetPageHtml(title, readInternetBlocks())
      : document.getElementById('internetPageContent').value.trim();
  } catch (error) {
    showMessage(error.message, 'danger');
    return;
  }

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

  document.querySelectorAll('[name="internetPageEditorMode"]').forEach(radio => {
    radio.addEventListener('change', () => setInternetEditorMode(radio.value));
  });
  document.querySelectorAll('[data-add-internet-block]').forEach(button => {
    button.addEventListener('click', () => createInternetBlock(button.dataset.addInternetBlock));
  });
  document.getElementById('internetPageBlocks')?.addEventListener('click', event => {
    const button = event.target.closest('[data-block-action]');
    const block = button?.closest('.internet-page-block');
    if (!block) return;
    if (button.dataset.blockAction === 'remove') block.remove();
    if (button.dataset.blockAction === 'up' && block.previousElementSibling) block.parentNode.insertBefore(block, block.previousElementSibling);
    if (button.dataset.blockAction === 'down' && block.nextElementSibling) block.parentNode.insertBefore(block.nextElementSibling, block);
  });
  document.getElementById('previewInternetPageBtn')?.addEventListener('click', previewInternetPage);

  const cancelBtn = document.getElementById('internetPageCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', resetInternetPageForm);
  resetInternetPageForm();
});
