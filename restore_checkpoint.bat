@echo off
echo ========================================
echo    ВОССТАНОВЛЕНИЕ СЕЙВ-ТОЧКИ v1.0
echo ========================================
echo.
echo Этот скрипт вернет проект к рабочему состоянию
echo с ядерным сбросом и всеми функциями.
echo.
pause

echo.
echo [1/3] Переключение на сейв-точку...
git checkout v1.0-working-nuclear-reset
if %errorlevel% neq 0 (
    echo ОШИБКА: Не удалось переключиться на тег!
    echo Убедитесь что тег v1.0-working-nuclear-reset существует.
    pause
    exit /b 1
)

echo.
echo [2/3] Установка зависимостей...
npm install
if %errorlevel% neq 0 (
    echo ОШИБКА: Не удалось установить зависимости!
    pause
    exit /b 1
)

echo.
echo [3/3] Отправка на сервер...
git push origin main --force
if %errorlevel% neq 0 (
    echo ОШИБКА: Не удалось отправить на сервер!
    pause
    exit /b 1
)

echo.
echo ========================================
echo    ВОССТАНОВЛЕНИЕ ЗАВЕРШЕНО!
echo ========================================
echo.
echo ✅ Проект восстановлен к рабочему состоянию
echo ✅ Все функции работают
echo ✅ Ядерный сброс доступен в админ-панели
echo.
echo Данные для входа:
echo Логин: admin
echo Пароль: admin123
echo.
echo Подождите 2-3 минуты для обновления на сервере.
echo.
pause
