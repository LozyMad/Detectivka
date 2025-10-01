# Детективка - Детективная игра

Веб-приложение для проведения детективных игр с использованием геолокации.

## Возможности

- 🎮 Создание игровых комнат с таймерами
- 📍 Управление адресами и сценариями
- 👥 Система пользователей с разными уровнями доступа
- ❓ Система вопросов и ответов
- 📊 Статистика и аналитика

## Технологии

- **Backend**: Node.js, Express.js, SQLite3
- **Frontend**: HTML5, CSS3, JavaScript (ES6+), Bootstrap 5
- **Аутентификация**: JWT токены
- **База данных**: SQLite3

## Установка и запуск

### Локальная разработка

1. Клонируйте репозиторий
2. Установите зависимости:
   ```bash
   npm install
   ```
3. Запустите сервер:
   ```bash
   npm start
   ```
4. Откройте http://localhost:3000

### Переменные окружения

- `PORT` - порт сервера (по умолчанию 3000)
- `JWT_SECRET` - секретный ключ для JWT (по умолчанию 'your-secret-key')

## Структура проекта

```
├── backend/
│   ├── config/          # Конфигурация базы данных
│   ├── controllers/     # Контроллеры API
│   ├── middleware/      # Middleware функции
│   ├── models/          # Модели данных
│   ├── routes/          # Маршруты API
│   └── server.js        # Главный файл сервера
├── frontend/
│   ├── css/            # Стили
│   ├── js/             # JavaScript файлы
│   └── *.html          # HTML страницы
└── package.json        # Зависимости проекта
```

## API Endpoints

### Аутентификация
- `POST /api/auth/login` - Вход в систему
- `POST /api/auth/room-login` - Вход в игровую комнату

### Администрирование
- `GET /api/admin/users` - Список пользователей
- `POST /api/admin/users` - Создание пользователя
- `GET /api/admin/scenarios` - Список сценариев
- `POST /api/admin/scenarios` - Создание сценария

### Игровые комнаты
- `GET /api/rooms` - Список комнат
- `POST /api/rooms` - Создание комнаты
- `POST /api/rooms/:id/start` - Запуск таймера

## Уровни доступа

- **super_admin** - Полный доступ ко всем функциям
- **admin** - Ограниченный доступ (комнаты, ответы, статистика)
- **user** - Обычные пользователи

## 🚀 Развертывание в интернете

### Railway (рекомендуется)
1. Зарегистрируйтесь на [Railway.app](https://railway.app)
2. Подключите GitHub репозиторий
3. Railway автоматически развернет приложение
4. Получите URL вида: `https://your-app.railway.app`

### Render
1. Зарегистрируйтесь на [Render.com](https://render.com)
2. Создайте новый Web Service
3. Подключите GitHub репозиторий
4. Установите Build Command: `npm install`
5. Установите Start Command: `npm start`

### Heroku
1. Зарегистрируйтесь на [Heroku.com](https://heroku.com)
2. Установите Heroku CLI
3. Создайте приложение: `heroku create your-app-name`
4. Разверните: `git push heroku main`

## 🌐 Домен

**Домен НЕ обязателен!** Все платформы предоставляют бесплатные поддомены:
- Railway: `https://your-app.railway.app`
- Render: `https://your-app.onrender.com`
- Heroku: `https://your-app.herokuapp.com`

Если нужен собственный домен, можно купить на:
- [Namecheap](https://namecheap.com) - $8-15/год
- [GoDaddy](https://godaddy.com) - $10-20/год

## Лицензия

MIT License

