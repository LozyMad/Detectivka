'use strict';

(() => {
  const labels = { new: 'Новая', in_progress: 'В работе', agreed: 'Согласовано', closed: 'Закрыто' };
  const formats = { undecided: 'Пока не решили', online: 'Онлайн', offline: 'Офлайн' };
  const drafts = new Map();
  let initialized = false;
  let page = 1;
  let pages = 1;
  let selected = null;
  let listSequence = 0;
  let detailSequence = 0;
  let searchTimer;
  const byId = id => document.getElementById(id);

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function date(value, withTime = false) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
    }) : '—';
  }

  function contact(parent, text, href) {
    if (!text) return;
    const element = node(href ? 'a' : 'span', text);
    if (href) {
      element.href = href;
      if (href.startsWith('https://')) {
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
      }
    }
    parent.append(element);
  }

  function contacts(parent, enquiry) {
    contact(parent, enquiry.phone, 'tel:' + enquiry.phone.replace(/[^\d+]/g, ''));
    const telegram = enquiry.telegram.replace(/^@/, '');
    contact(parent, enquiry.telegram, /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(telegram) ? 'https://t.me/' + telegram : null);
    contact(parent, enquiry.email, enquiry.email ? 'mailto:' + encodeURIComponent(enquiry.email) : null);
  }

  function counts(values) {
    for (const [status, count] of Object.entries(values || {})) {
      const element = document.querySelector('[data-enquiry-count="' + status + '"]');
      if (element) element.textContent = String(count);
    }
    const badge = byId('enquiriesBadge');
    badge.textContent = String(values?.new || 0);
    badge.hidden = !values?.new;
    badge.setAttribute('aria-label', 'Новых заявок: ' + String(values?.new || 0));
  }

  async function request(path = '', options = {}) {
    const response = await authFetch(API_BASE + '/admin/enquiries' + path, options);
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Не удалось загрузить заявки.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function summary() {
    try { counts((await request('/summary')).counts); }
    catch (error) { console.warn('Enquiries summary unavailable'); }
  }

  function table(items) {
    const body = byId('enquiriesTable');
    body.replaceChildren();
    if (!items.length) {
      const row = node('tr');
      const cell = node('td', 'Заявок по этим условиям пока нет.', 'text-center py-4');
      cell.colSpan = 6;
      row.append(cell);
      body.append(row);
      return;
    }
    for (const item of items) {
      const row = node('tr');
      row.dataset.enquiryId = item.id;
      row.classList.toggle('is-selected', selected?.id === item.id);
      const received = node('td', date(item.created_at));
      received.append(node('span', item.id.slice(0, 8).toUpperCase(), 'enquiries-muted'));
      const company = node('td', item.company, 'enquiries-company');
      company.append(node('span', 'Корпоратив', 'enquiries-muted'));
      const participation = node('td', item.participants == null ? 'Не указано' : String(item.participants));
      participation.append(node('span', formats[item.format] || item.format, 'enquiries-muted'));
      const connection = node('td', null, 'enquiries-contacts');
      contacts(connection, item);
      const statusCell = node('td');
      const status = node('span', labels[item.status] || item.status, 'enquiries-status');
      status.dataset.status = item.status;
      statusCell.append(status);
      const action = node('td');
      const button = node('button', 'Открыть', 'btn btn-sm btn-outline-primary');
      button.type = 'button';
      button.setAttribute('aria-label', 'Открыть заявку ' + item.company);
      button.addEventListener('click', () => open(item.id));
      action.append(button);
      row.append(received, company, participation, connection, statusCell, action);
      body.append(row);
    }
  }

  async function load() {
    if (currentUser?.admin_level !== 'super_admin') return;
    const sequence = ++listSequence;
    const query = new URLSearchParams({
      page: String(page), q: byId('enquiriesSearch').value.trim(),
      status: byId('enquiriesStatusFilter').value
    });
    byId('enquiriesRefresh').disabled = true;
    byId('enquiriesError').hidden = true;
    byId('enquiriesList').setAttribute('aria-busy', 'true');
    try {
      const data = await request('?' + query);
      if (sequence !== listSequence) return;
      if (!Array.isArray(data.items)) throw new Error('Список заявок получен не полностью. Обновите ещё раз.');
      page = data.page;
      pages = data.pages;
      counts(data.counts);
      table(data.items);
      byId('enquiriesPageLabel').textContent = 'Найдено: ' + data.total + ' · страница ' + page + ' из ' + pages;
      byId('enquiriesPrevious').disabled = page <= 1;
      byId('enquiriesNext').disabled = page >= pages;
    } catch (error) {
      if (sequence !== listSequence) return;
      byId('enquiriesError').textContent = error.message;
      byId('enquiriesError').hidden = false;
    } finally {
      if (sequence === listSequence) {
        byId('enquiriesRefresh').disabled = false;
        byId('enquiriesList').removeAttribute('aria-busy');
      }
    }
  }

  function detail(enquiry) {
    const draft = drafts.get(enquiry.id);
    selected = { ...enquiry, revision: draft?.revision ?? enquiry.revision };
    byId('enquiryDetailEmpty').hidden = true;
    byId('enquiryDetailContent').hidden = false;
    byId('enquiryDetailTitle').textContent = enquiry.company;
    byId('enquiryDetailReference').textContent = 'Заявка ' + enquiry.id.slice(0, 8).toUpperCase() + ' · ' + date(enquiry.created_at, true);
    byId('enquiryDetailParticipants').textContent = enquiry.participants == null ? 'Не указано' : String(enquiry.participants) + ' человек';
    byId('enquiryDetailFormat').textContent = formats[enquiry.format] || enquiry.format;
    const connection = byId('enquiryDetailContacts');
    connection.replaceChildren();
    contacts(connection, enquiry);
    byId('enquiryDetailSource').textContent = 'Корпоративный лендинг';
    byId('enquiryDetailConsent').textContent = enquiry.consented_at
      ? date(enquiry.consented_at, true) + ' · редакция ' + enquiry.consent_version
      : 'Не зафиксировано — заявка получена через прежнюю форму';
    byId('enquiryDetailStatus').value = draft?.status ?? enquiry.status;
    byId('enquiryDetailNotes').value = draft?.notes ?? enquiry.notes;
    byId('enquiryDetailUpdated').textContent = enquiry.updated_by
      ? 'Изменено: ' + date(enquiry.updated_at, true) + ' · ' + enquiry.updated_by : 'Ещё не обрабатывалась';
    byId('enquiryDetailFeedback').textContent = draft ? 'Есть несохранённые изменения.' : '';
    byId('enquiryDetailReload').hidden = true;
    document.querySelectorAll('[data-enquiry-id]').forEach(row => row.classList.toggle('is-selected', row.dataset.enquiryId === enquiry.id));
  }

  async function open(id, discardDraft = false) {
    const sequence = ++detailSequence;
    if (discardDraft) drafts.delete(id);
    byId('enquiryDetail').setAttribute('aria-busy', 'true');
    try {
      const data = await request('/' + encodeURIComponent(id));
      if (sequence !== detailSequence) return;
      detail(data.enquiry);
      byId('enquiryDetailTitle').focus({ preventScroll: true });
      if (innerWidth <= 1450) byId('enquiryDetail').scrollIntoView({ block: 'start' });
    } catch (error) {
      if (sequence !== detailSequence) return;
      byId('enquiriesError').textContent = error.message;
      byId('enquiriesError').hidden = false;
    } finally {
      if (sequence === detailSequence) byId('enquiryDetail').removeAttribute('aria-busy');
    }
  }

  function rememberDraft() {
    if (!selected) return;
    drafts.set(selected.id, { revision: selected.revision, status: byId('enquiryDetailStatus').value, notes: byId('enquiryDetailNotes').value });
    byId('enquiryDetailFeedback').textContent = 'Есть несохранённые изменения.';
  }

  async function save(event) {
    event.preventDefault();
    if (!selected || byId('enquiryDetailSave').disabled) return;
    const id = selected.id;
    const sequence = detailSequence;
    const payload = { revision: selected.revision, status: byId('enquiryDetailStatus').value, notes: byId('enquiryDetailNotes').value };
    rememberDraft();
    byId('enquiryDetailSave').disabled = true;
    byId('enquiryDetailStatus').disabled = true;
    byId('enquiryDetailNotes').disabled = true;
    byId('enquiryDetailFeedback').textContent = 'Сохраняем…';
    try {
      const data = await request('/' + encodeURIComponent(id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      drafts.delete(id);
      if (sequence === detailSequence) {
        detail(data.enquiry);
        byId('enquiryDetailFeedback').textContent = 'Изменения сохранены.';
      }
      await load();
    } catch (error) {
      if (sequence === detailSequence) {
        byId('enquiryDetailFeedback').textContent = error.message;
        byId('enquiryDetailReload').hidden = error.status !== 409;
      }
    } finally {
      byId('enquiryDetailSave').disabled = false;
      byId('enquiryDetailStatus').disabled = false;
      byId('enquiryDetailNotes').disabled = false;
    }
  }

  function init() {
    if (initialized || currentUser?.admin_level !== 'super_admin') return;
    initialized = true;
    byId('enquiriesRefresh').addEventListener('click', load);
    byId('enquiriesSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { page = 1; load(); }, 350);
    });
    byId('enquiriesStatusFilter').addEventListener('change', () => { page = 1; load(); });
    byId('enquiriesPrevious').addEventListener('click', () => { if (page > 1) { page--; load(); } });
    byId('enquiriesNext').addEventListener('click', () => { if (page < pages) { page++; load(); } });
    byId('enquiryDetailForm').addEventListener('submit', save);
    byId('enquiryDetailNotes').addEventListener('input', rememberDraft);
    byId('enquiryDetailStatus').addEventListener('change', rememberDraft);
    byId('enquiryDetailReload').addEventListener('click', () => { if (selected) open(selected.id, true); });
    summary();
    if (location.hash === '#enquiries') switchTab('enquiries');
  }

  window.adminEnquiries = { init, load };
})();
