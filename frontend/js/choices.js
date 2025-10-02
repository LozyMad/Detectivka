// Глобальные переменные для управления выборами
let currentScenarioId = null;
let currentAddressId = null;
let currentAddressInfo = null;

// Открыть модальное окно управления выборами
function openChoicesModal(scenarioId, addressId, addressInfo) {
    currentScenarioId = scenarioId;
    currentAddressId = addressId;
    currentAddressInfo = addressInfo;
    
    // Обновить информацию об адресе
    document.getElementById('choicesAddressInfo').textContent = 
        `${addressInfo.district} район, дом ${addressInfo.house_number} - ${addressInfo.description}`;
    
    // Загрузить существующие выборы
    loadAddressChoices();
    
    // Показать модальное окно
    const modal = new bootstrap.Modal(document.getElementById('choicesModal'));
    modal.show();
}

// Загрузить варианты выбора для адреса
async function loadAddressChoices() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(
            `/api/choices/admin/scenarios/${currentScenarioId}/addresses/${currentAddressId}/choices`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        if (!response.ok) {
            throw new Error('Failed to load choices');
        }
        
        const data = await response.json();
        displayChoices(data.choices);
    } catch (error) {
        console.error('Error loading choices:', error);
        document.getElementById('choicesList').innerHTML = 
            '<p class="text-danger text-center">Ошибка загрузки вариантов выбора</p>';
    }
}

// Отобразить варианты выбора
function displayChoices(choices) {
    const choicesList = document.getElementById('choicesList');
    
    if (!choices || choices.length === 0) {
        choicesList.innerHTML = 
            '<p class="text-muted text-center">Нет вариантов выбора для этого адреса</p>';
        return;
    }
    
    let html = '';
    choices.forEach((choice, index) => {
        const isActive = choice.is_active;
        const statusClass = isActive ? 'success' : 'secondary';
        const statusText = isActive ? 'Активен' : 'Неактивен';
        
        html += `
            <div class="card mb-3 ${!isActive ? 'opacity-75' : ''}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h6 class="card-title mb-0">
                            <span class="badge bg-primary me-2">${choice.choice_order}</span>
                            ${choice.choice_text}
                        </h6>
                        <div>
                            <span class="badge bg-${statusClass} me-2">${statusText}</span>
                            <div class="btn-group btn-group-sm">
                                <button class="btn btn-outline-primary" onclick="editChoice(${choice.id})">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-outline-danger" onclick="deleteChoice(${choice.id})">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <p class="card-text text-muted mb-0">
                        <strong>Ответ:</strong> ${choice.response_text}
                    </p>
                </div>
            </div>
        `;
    });
    
    choicesList.innerHTML = html;
}

// Обработчик формы добавления нового выбора
document.getElementById('addChoiceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const choiceText = document.getElementById('choiceText').value;
    const responseText = document.getElementById('responseText').value;
    const choiceOrder = parseInt(document.getElementById('choiceOrder').value);
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(
            `/api/choices/admin/scenarios/${currentScenarioId}/addresses/${currentAddressId}/choices`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    choice_text: choiceText,
                    response_text: responseText,
                    choice_order: choiceOrder
                })
            }
        );
        
        if (!response.ok) {
            throw new Error('Failed to create choice');
        }
        
        // Очистить форму
        document.getElementById('addChoiceForm').reset();
        document.getElementById('choiceOrder').value = '1';
        
        // Перезагрузить список выборов
        loadAddressChoices();
        
        // Показать уведомление
        showNotification('Вариант выбора успешно добавлен', 'success');
        
    } catch (error) {
        console.error('Error creating choice:', error);
        showNotification('Ошибка при добавлении варианта выбора', 'error');
    }
});

// Редактировать вариант выбора
async function editChoice(choiceId) {
    try {
        // Найти выбор в текущем списке
        const token = localStorage.getItem('token');
        const response = await fetch(
            `/api/choices/admin/scenarios/${currentScenarioId}/addresses/${currentAddressId}/choices`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        if (!response.ok) {
            throw new Error('Failed to load choice details');
        }
        
        const data = await response.json();
        const choice = data.choices.find(c => c.id === choiceId);
        
        if (!choice) {
            throw new Error('Choice not found');
        }
        
        // Заполнить форму редактирования
        document.getElementById('editChoiceId').value = choice.id;
        document.getElementById('editChoiceText').value = choice.choice_text;
        document.getElementById('editResponseText').value = choice.response_text;
        document.getElementById('editChoiceOrder').value = choice.choice_order;
        document.getElementById('editChoiceActive').checked = choice.is_active;
        
        // Показать модальное окно редактирования
        const modal = new bootstrap.Modal(document.getElementById('editChoiceModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error loading choice for edit:', error);
        showNotification('Ошибка при загрузке данных для редактирования', 'error');
    }
}

// Обновить вариант выбора
async function updateChoice() {
    const choiceId = document.getElementById('editChoiceId').value;
    const choiceText = document.getElementById('editChoiceText').value;
    const responseText = document.getElementById('editResponseText').value;
    const choiceOrder = parseInt(document.getElementById('editChoiceOrder').value);
    const isActive = document.getElementById('editChoiceActive').checked;
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(
            `/api/choices/admin/scenarios/${currentScenarioId}/choices/${choiceId}`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    choice_text: choiceText,
                    response_text: responseText,
                    choice_order: choiceOrder,
                    is_active: isActive
                })
            }
        );
        
        if (!response.ok) {
            throw new Error('Failed to update choice');
        }
        
        // Закрыть модальное окно редактирования
        const modal = bootstrap.Modal.getInstance(document.getElementById('editChoiceModal'));
        modal.hide();
        
        // Перезагрузить список выборов
        loadAddressChoices();
        
        // Показать уведомление
        showNotification('Вариант выбора успешно обновлен', 'success');
        
    } catch (error) {
        console.error('Error updating choice:', error);
        showNotification('Ошибка при обновлении варианта выбора', 'error');
    }
}

// Удалить вариант выбора
async function deleteChoice(choiceId) {
    if (!confirm('Вы уверены, что хотите удалить этот вариант выбора?')) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(
            `/api/choices/admin/scenarios/${currentScenarioId}/choices/${choiceId}`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        if (!response.ok) {
            throw new Error('Failed to delete choice');
        }
        
        // Перезагрузить список выборов
        loadAddressChoices();
        
        // Показать уведомление
        showNotification('Вариант выбора успешно удален', 'success');
        
    } catch (error) {
        console.error('Error deleting choice:', error);
        showNotification('Ошибка при удалении варианта выбора', 'error');
    }
}

// Проверить, есть ли у адреса интерактивные выборы
async function checkAddressHasChoices(scenarioId, addressId) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(
            `/api/choices/admin/scenarios/${scenarioId}/addresses/${addressId}/has-choices`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        if (!response.ok) {
            return false;
        }
        
        const data = await response.json();
        return data.hasChoices;
        
    } catch (error) {
        console.error('Error checking address choices:', error);
        return false;
    }
}

// Показать уведомление
function showNotification(message, type = 'info') {
    // Создать элемент уведомления
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Добавить в DOM
    document.body.appendChild(notification);
    
    // Автоматически удалить через 5 секунд
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}
