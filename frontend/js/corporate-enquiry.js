'use strict';

(() => {
  const form = document.querySelector('[data-corporate-enquiry]');
  if (!form) return;
  const result = document.querySelector('[data-enquiry-result]');
  const errorBox = document.querySelector('[data-enquiry-error]');
  const submit = form.querySelector('[type="submit"]');
  let pendingSubmission = null;
  let sending = false;

  function requestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  form.hidden = false;
  form.addEventListener('input', event => {
    event.target.setCustomValidity?.('');
    errorBox.hidden = true;
  });
  form.addEventListener('change', event => event.target.setCustomValidity?.(''));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    const values = new FormData(form);
    const payload = Object.fromEntries(['company', 'phone', 'email'].map(name => [name, String(values.get(name) || '').trim()]));
    payload.consent = values.get('consent') === 'on';
    payload.consent_version = form.dataset.consentVersion;
    const fingerprint = JSON.stringify(payload);
    if (!pendingSubmission || pendingSubmission.fingerprint !== fingerprint) pendingSubmission = { fingerprint, id: requestId() };
    payload.submission_id = pendingSubmission.id;
    sending = true;
    errorBox.hidden = true;
    form.setAttribute('aria-busy', 'true');
    const controls = [...form.querySelectorAll('input, select, button')];
    controls.forEach(control => { control.disabled = true; });
    submit.textContent = 'Отправляем заявку…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/enquiries/corporate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true || typeof data.id !== 'string') {
        const error = new Error(data.error || 'Не удалось сохранить заявку. Попробуйте ещё раз.');
        error.fields = data.fields;
        throw error;
      }
      form.hidden = true;
      result.hidden = false;
      document.querySelector('[data-enquiry-heading]').focus();
      pendingSubmission = null;
    } catch (error) {
      const connectionError = error.name === 'AbortError' || error instanceof TypeError || error instanceof SyntaxError;
      errorBox.textContent = connectionError
        ? 'Не удалось подтвердить отправку. Проверьте соединение и попробуйте ещё раз. Введённые данные остались в форме.'
        : error.message;
      errorBox.hidden = false;
      controls.forEach(control => { control.disabled = false; });
      if (error.fields) {
        for (const [name, message] of Object.entries(error.fields)) form.elements.namedItem(name)?.setCustomValidity(message);
        form.reportValidity();
      }
    } finally {
      clearTimeout(timeout);
      sending = false;
      form.removeAttribute('aria-busy');
      controls.forEach(control => { control.disabled = false; });
      submit.textContent = 'Отправить заявку';
    }
  });

  document.querySelector('[data-enquiry-another]').addEventListener('click', () => {
    form.reset();
    [...form.elements].forEach(control => control.setCustomValidity?.(''));
    pendingSubmission = null;
    errorBox.hidden = true;
    result.hidden = true;
    form.hidden = false;
    form.elements.namedItem('company').focus();
  });
})();
