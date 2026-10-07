// Аутентификация игроков в комнатах
document.addEventListener('DOMContentLoaded', () => {
    const gameLoginForm = document.getElementById('gameLoginForm');
    const messageDiv = document.getElementById('message');
    const session = window.gameSession;
    const savedPlayer = JSON.parse(session.storage.getItem('roomUser') || 'null');
    if (savedPlayer?.room_id) document.getElementById('roomId').value = savedPlayer.room_id;
    if (savedPlayer?.username) document.getElementById('roomUsername').value = savedPlayer.username;
    const sessionNotice = 'Сессия игры недействительна или истекла. Войдите в комнату снова. История поездок сохранена.';
    session.onExpired = () => showMessage(sessionNotice, 'error', true);
    if (new URLSearchParams(window.location.search).get('session') === 'expired') showMessage(sessionNotice, 'error', true);

    gameLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const roomId = document.getElementById('roomId').value;
        const username = document.getElementById('roomUsername').value;
        const password = document.getElementById('roomPassword').value;
        
        // Показываем индикатор загрузки
        const submitBtn = gameLoginForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Вход...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch('/api/auth/room-login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    room_id: parseInt(roomId), 
                    username, 
                    password 
                })
            });

            const data = await response.json();

            if (response.ok) {
                session.saveLogin(data);
                
                showMessage('Успешный вход в игру! Перенаправление...', 'success');
                
                // Перенаправляем на игровую страницу
                setTimeout(() => {
                    window.location.href = '/game';
                }, 1000);
            } else {
                showMessage(data.error || 'Ошибка входа в комнату', 'error');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            showMessage('Ошибка соединения с сервером', 'error');
        } finally {
            // Восстанавливаем кнопку
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    // Saved credentials alone do not prove that the server still accepts this session.
    async function resumeSession() {
        const token = session.storage.getItem('token');
        if (!token || !savedPlayer?.id) return;
        if (session.hasExpiredToken()) return session.invalidate();
        try {
            const options = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
                signal: AbortSignal.timeout(15000) };
            const response = await fetch('/api/auth/session', options);
            await session.checkResponse(response, options);
            if (session.storage.getItem('token') !== token) return;
            if (response.ok) {
                const data = await response.json();
                if (String(data.room_user?.id) === String(savedPlayer.id) && String(data.room_user?.room_id) === String(savedPlayer.room_id)) {
                    window.location.href = '/game';
                } else {
                    session.invalidate();
                }
            }
        } catch (_) {
            showMessage('Не удалось проверить сохранённый вход. Попробуйте войти в комнату снова.', 'error');
        }
    }
    resumeSession();

    function showMessage(text, type, persistent = false) {
        messageDiv.innerHTML = `
            <div class="alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show" role="alert">
                <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'} me-2"></i>
                ${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        if (persistent) return;
        // Автоматически скрываем сообщение через 5 секунд
        setTimeout(() => {
            const alert = messageDiv.querySelector('.alert');
            if (alert) {
                alert.remove();
            }
        }, 5000);
    }
});
