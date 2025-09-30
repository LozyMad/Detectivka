@echo off
echo 🔄 Автоматический коммит изменений...
echo.

REM Проверяем, есть ли изменения
git status --porcelain > temp_status.txt
if %errorlevel% neq 0 (
    echo ❌ Git не найден или не настроен
    del temp_status.txt
    pause
    exit /b 1
)

REM Проверяем, есть ли изменения для коммита
for /f %%i in (temp_status.txt) do (
    echo ✅ Найдены изменения для коммита
    goto :commit
)

echo ℹ️ Нет изменений для коммита
del temp_status.txt
pause
exit /b 0

:commit
del temp_status.txt

REM Добавляем все изменения
echo 📝 Добавляем изменения...
git add .

REM Создаем коммит с временной меткой
for /f "tokens=1-6 delims=: " %%a in ('echo %time%') do set timestamp=%%a%%b%%c
set commit_message=Auto-commit: %date% %time%

echo 💾 Создаем коммит: %commit_message%
git commit -m "%commit_message%"

if %errorlevel% neq 0 (
    echo ❌ Ошибка создания коммита
    pause
    exit /b 1
)

REM Пушим изменения
echo 🚀 Отправляем изменения на GitHub...
git push

if %errorlevel% neq 0 (
    echo ❌ Ошибка отправки на GitHub
    pause
    exit /b 1
)

echo ✅ Изменения успешно отправлены на GitHub!
echo.
pause

