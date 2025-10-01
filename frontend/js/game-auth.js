// Аутентификация игроков в комнатах
document.addEventListener('DOMContentLoaded', () => {
    const gameLoginForm = document.getElementById('gameLoginForm');
    const messageDiv = document.getElementById('message');

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
            console.log('Login response:', data);

            if (response.ok) {
                // Сохраняем токен и данные игрока
                localStorage.setItem('token', data.token);
                // Добавляем room_id к данным пользователя
                const roomUser = { ...data.user, room_id: data.room.id };
                localStorage.setItem('roomUser', JSON.stringify(roomUser));
                localStorage.setItem('room', JSON.stringify(data.room));
                localStorage.setItem('room_id', data.room.id);
                
                // Очищаем данные админа, если они есть
                localStorage.removeItem('user');
                
                console.log('Data saved to localStorage:', {
                    token: localStorage.getItem('token'),
                    roomUser: localStorage.getItem('roomUser'),
                    room: localStorage.getItem('room'),
                    room_id: localStorage.getItem('room_id')
                });
                
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

    function showMessage(text, type) {
        messageDiv.innerHTML = `
            <div class="alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show" role="alert">
                <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'} me-2"></i>
                ${text}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        // Автоматически скрываем сообщение через 5 секунд
        setTimeout(() => {
            const alert = messageDiv.querySelector('.alert');
            if (alert) {
                alert.remove();
            }
        }, 5000);
    }
});
