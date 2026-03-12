# 🚀 Инструкция по деплою проекта "Детективка"

## 📋 Предварительные требования

1. **Node.js** (версия 16 или выше)
2. **Git** установлен и настроен
3. **GitHub аккаунт** с созданным репозиторием
4. **Платформа для деплоя** (Timeweb, Render, Heroku, или другая)

## 🔧 Локальная настройка

### 1. Установка зависимостей
```bash
# В корневой папке проекта
npm install

# В папке backend
cd backend
npm install
cd ..
```

### 2. Настройка базы данных
```bash
# Создание базы данных (автоматически при первом запуске)
cd backend
node server.js
```

## 🌐 Настройка GitHub

### 1. Создание нового репозитория
1. Перейдите на GitHub.com
2. Нажмите "New repository"
3. Назовите репозиторий (например: `detectivka-game`)
4. Выберите "Public" или "Private"
5. **НЕ** инициализируйте с README, .gitignore или лицензией

### 2. Подключение к новому репозиторию
```bash
# Удалить старый remote (если нужно)
git remote remove origin

# Добавить новый remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Отправить код в новый репозиторий
git push -u origin main
```

## 🚀 Деплой на платформы

### Timeweb

1. Создайте приложение/сервис в панели Timeweb
2. Подключите репозиторий (Git) и настройте автодеплой при push
3. Задайте переменные окружения (NODE_ENV, PORT, JWT_SECRET, DB_TYPE, DATABASE_URL при использовании PostgreSQL)
4. Команда запуска: `npm start` (или через Procfile: `web: npm start`)

### Render

1. **Подключение к Render:**
   - Перейдите на [render.com](https://render.com)
   - Войдите через GitHub
   - Нажмите "New" → "Web Service"
   - Подключите ваш репозиторий

2. **Настройки:**
   - **Build Command:** `cd backend && npm install`
   - **Start Command:** `cd backend && npm start`
   - **Environment:** Node

### Heroku

1. **Установка Heroku CLI:**
   ```bash
   # Windows (через Chocolatey)
   choco install heroku-cli
   
   # Или скачайте с heroku.com
   ```

2. **Деплой:**
   ```bash
   # Вход в Heroku
   heroku login
   
   # Создание приложения
   heroku create your-app-name
   
   # Настройка buildpack
   heroku buildpacks:set heroku/nodejs
   
   # Деплой
   git push heroku main
   ```

## 📁 Структура проекта для деплоя

```
detectivka-game/
├── backend/                 # Backend приложение
│   ├── server.js           # Главный файл сервера
│   ├── package.json        # Зависимости backend
│   ├── controllers/        # Контроллеры
│   ├── models/            # Модели данных
│   ├── routes/            # API маршруты
│   └── config/            # Конфигурация
├── frontend/              # Frontend приложение
│   ├── index.html         # Главная страница
│   ├── admin-login.html   # Страница входа админа
│   ├── game-login.html    # Страница входа игрока
│   ├── game.html          # Игровой интерфейс
│   ├── admin.html         # Админ-панель
│   ├── css/               # Стили
│   └── js/                # JavaScript файлы
├── package.json           # Корневой package.json
├── Procfile              # Для Heroku и совместимых платформ
└── README.md             # Документация
```

## 🔧 Настройка файлов для деплоя

### Procfile (для Heroku)
```
web: cd backend && npm start
```

## 🌍 Переменные окружения

Создайте файл `.env` в папке `backend/`:
```env
NODE_ENV=production
PORT=3000
JWT_SECRET=your-super-secret-jwt-key
```

## 📊 Мониторинг и логи

### Render
- Логи в разделе "Logs"
- Мониторинг в "Metrics"

### Heroku
```bash
# Просмотр логов
heroku logs --tail

# Мониторинг
heroku ps
```

## 🔄 Обновление приложения

```bash
# Внесение изменений
git add .
git commit -m "Описание изменений"
git push origin main

# Автоматический деплой (если настроен)
# Или ручной деплой через панель управления
```

## 🐛 Решение проблем

### Проблема: Приложение не запускается
1. Проверьте логи в панели управления
2. Убедитесь, что все зависимости установлены
3. Проверьте переменные окружения

### Проблема: База данных не работает
1. Убедитесь, что SQLite файлы создаются
2. Проверьте права доступа к файлам
3. Для продакшена рассмотрите PostgreSQL

### Проблема: Статические файлы не загружаются
1. Проверьте пути к файлам в `server.js`
2. Убедитесь, что папка `frontend` доступна

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи приложения
2. Убедитесь в правильности настроек
3. Проверьте документацию платформы деплоя

---

**Удачного деплоя! 🎉**
