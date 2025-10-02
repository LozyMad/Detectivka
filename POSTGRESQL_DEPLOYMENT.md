# 🐘 Деплой с PostgreSQL на Railway

## 📋 Подготовка к деплою

### 1. Локальное тестирование (опционально)

Если у вас установлен PostgreSQL локально:

```bash
# Создайте тестовую базу данных
createdb detectivka_test

# Запустите тест подключения
node test-postgresql.js
```

### 2. Миграция данных из SQLite (если нужно)

Если у вас есть данные в SQLite, которые нужно перенести:

```bash
# Убедитесь что PostgreSQL запущен локально
# Создайте базу данных: createdb detectivka

# Запустите миграцию
node migrate-to-postgresql.js
```

## 🚀 Деплой на Railway

### 1. Создание PostgreSQL базы данных

1. Зайдите в [Railway Dashboard](https://railway.app/dashboard)
2. Откройте ваш проект
3. Нажмите **"+ New"** → **"Database"** → **"Add PostgreSQL"**
4. Дождитесь создания базы данных

### 2. Настройка переменных окружения

В Railway Dashboard → Variables добавьте:

```env
DB_TYPE=postgresql
NODE_ENV=production
JWT_SECRET=your-super-secret-jwt-key-change-this
PORT=3000
```

**Важно:** `DATABASE_URL` будет автоматически создана Railway при добавлении PostgreSQL.

### 3. Деплой кода

```bash
# Коммитим изменения
git add .
git commit -m "Migrate to PostgreSQL"

# Пушим на Railway
git push origin main
```

### 4. Проверка деплоя

1. Откройте логи деплоя в Railway
2. Убедитесь что видите сообщения:
   - `Initializing PostgreSQL database...`
   - `PostgreSQL database initialized successfully`
   - `Server is running on port 3000`

## 🔧 Переключение между SQLite и PostgreSQL

Проект поддерживает оба типа баз данных. Для переключения:

### Локально (SQLite):
```env
DB_TYPE=sqlite
# или просто не указывайте DB_TYPE
```

### На продакшене (PostgreSQL):
```env
DB_TYPE=postgresql
DATABASE_URL=postgresql://username:password@host:port/database
```

## 📊 Преимущества PostgreSQL

✅ **Надежность**: Данные не пропадают при деплоях  
✅ **Масштабируемость**: Поддержка множественных подключений  
✅ **Универсальность**: Работает на любом хостинге  
✅ **Бэкапы**: Автоматические бэкапы Railway  
✅ **Производительность**: Лучше для продакшена  

## 🛠️ Устранение проблем

### Ошибка подключения к базе данных
```
Error: connect ECONNREFUSED
```
**Решение**: Убедитесь что PostgreSQL база создана в Railway и `DATABASE_URL` установлена.

### Ошибки миграции
```
Error: relation "users" does not exist
```
**Решение**: База данных автоматически инициализируется при первом запуске. Подождите завершения деплоя.

### Проблемы с синтаксисом SQL
**Решение**: Все SQL запросы адаптированы под PostgreSQL. Если видите ошибки, проверьте что `DB_TYPE=postgresql`.

## 📞 Поддержка

Если возникают проблемы:
1. Проверьте логи Railway
2. Убедитесь что все переменные окружения установлены
3. Проверьте что PostgreSQL база данных создана и активна

---

**🎉 После успешного деплоя ваш проект будет работать с надежной PostgreSQL базой данных!**
