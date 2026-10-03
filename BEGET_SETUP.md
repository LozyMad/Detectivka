# Перенос Детективки с Timeweb на Beget

Репозиторий: https://github.com/LozyMad/Detectivka.git, ветка `main`.
Приложение: Node.js/Express, HTML/CSS/JS, SQLite в локальном окружении.
На Timeweb проверьте `DB_TYPE` до переноса: локальные настройки не доказывают,
что действующий сервер использует ту же базу.

## Реквизиты текущего переноса

- Домен: `detektum.ru`, регистратор и DNS-провайдер REG.RU.
- DNS-серверы: `ns1.reg.ru`, `ns2.reg.ru`; менять NS для этого переноса не нужно.
- Новый VPS Beget: `159.194.245.92`, Ubuntu 26.04, Node.js 22.
- Проект на Beget: `/root/apps/Detectivka`, процесс PM2 `detectivka`.
- Используется подготовленная локальная копия SQLite: Timeweb недоступен.
- Пароль admin изменён пользователем; PM2 online, автозапуск сохранён.
- На 3 октября 2026 года приложение на Beget отвечает HTTP 200 на порту 3000.
- В REG.RU пользователь сохранил A-записи `@` и `www` → `159.194.245.92`;
  это подтверждено скриншотом. Google DNS уже возвращает новый IP для обоих имён;
  часть других DNS-проверок пока возвращает старый IP.
- Nginx настроен для домена; проверка конфигурации успешна, локальный запрос
  с Host detektum.ru отвечает HTTP 200. Внешний запрос по IP тоже отвечает,
  внешний https://www.detektum.ru отвечает HTTP 200, HTTP перенаправляется на HTTPS.
- Certbot установлен. Действующий сертификат Let's Encrypt подтверждён снаружи;
  SAN содержит detektum.ru и www.detektum.ru, действует до 1 января 2027 года.
- Пользователь подтвердил, что сайт открывается. На Beget локальный HTTPS-запрос
  с Host/SNI detektum.ru отвечает HTTP 200; внешний www тоже проверен с HTTP 200.
  Из сети агента TLS для основного имени ещё даёт таймаут после подключения TCP,
  при этом www работает. Причина этой особенности сети не установлена.
- `certbot renew --dry-run` завершился успешно для обоих имён; продление проверено.
- Локальный workflow направлен на https://www.detektum.ru/api/deploy.
  Пользователь обновил GitHub DEPLOY_SECRET. Публикация workflow и проверка
  первого автодеплоя пока не выполнены.

Следующий текущий шаг — установить Certbot в SSH-консоли Beget:

```bash
apt update
apt install -y certbot python3-certbot-nginx
certbot --version
```

Выпуск сертификата выполняется после подтверждения новых DNS-записей:

```bash
certbot --nginx -d detektum.ru -d www.detektum.ru --redirect
```

Следующий шаг в SSH-консоли Beget:

```bash
cd /root/apps/Detectivka
sed 's/example\.com/detektum.ru/g' deploy/beget/nginx.conf > /etc/nginx/sites-available/detectivka
ln -sfn /etc/nginx/sites-available/detectivka /etc/nginx/sites-enabled/detectivka
nginx -t
```

После успешной проверки Nginx:

```bash
systemctl enable --now nginx
systemctl reload nginx
curl -I -H 'Host: detektum.ru' http://127.0.0.1/
```

После HTTP 200 и проверки внешнего доступа на порт 80 в REG.RU замените A-записи
`@` и `www` на `159.194.245.92`. Затем дождитесь обновления DNS и выпустите
сертификат для `detektum.ru` и `www.detektum.ru`. Автодеплой GitHub переключается
на Beget после обновления DEPLOY_SECRET и публикации нового workflow в main.

## 1. Создать сервер

В панели Beget откройте облачные серверы / VPS и создайте сервер с приложением
[Node.js](https://beget.com/ru/cloud/marketplace/nodejs).
В этот образ входят Node.js, PM2 и Nginx. Для начала можно выбрать 2 ГБ RAM;
необходимые ресурсы зависят от количества игроков. Нужен публичный IPv4.
Обычный виртуальный хостинг требует другой настройки: эта инструкция для VPS.

Сохраните IP и данные SSH из панели. Сервер Timeweb пока оставьте работающим.
Ни домен, ни VPS этой инструкцией автоматически не покупаются.

### Если создан сервер с чистой Ubuntu 26.04

Новый сервер Beget: `159.194.245.92`. На нём подтверждены Ubuntu 26.04 и
доступ пользователя root через консоль Beget. Node.js пока не установлен.
Для этой ОС [репозиторий Ubuntu](https://packages.ubuntu.com/resolute/nodejs)
содержит Node.js 22. Выполните в консоли сервера от root:

```bash
apt update
apt install -y nodejs npm nginx git curl ca-certificates build-essential python3
npm install -g pm2@latest
systemctl enable --now nginx
node --version
npm --version
pm2 --version
nginx -v
```

Установка PM2 описана в [официальной документации](https://doc.pm2.io/en/runtime/quick-start/).
Ожидается Node.js `v22.x`; перед загрузкой кода проверьте, что все команды
завершились успешно. Установка на сервере пока требует действий в консоли:
SSH-вход локальным ключом не настроен.

## 2. Загрузить код на Beget

Подключитесь по SSH к новому серверу. Дальнейшие команды выполняются в Linux,
под пользователем, которому принадлежат проект и процесс PM2. Не запускайте
PM2 попеременно от root и обычного пользователя: у них разные списки процессов.

```bash
node --version
pm2 --version
nginx -v
mkdir -p ~/apps
cd ~/apps
git clone --branch main https://github.com/LozyMad/Detectivka.git Detectivka
cd Detectivka
npm ci --omit=dev
npm --prefix backend ci --omit=dev
```

Нужны зависимости из ОБОИХ package.json: `xlsx` есть в backend, `pg` — в корне.
Windows-папки `node_modules` на Linux не переносятся. Отдельной сборки фронтенда нет.
Если репозиторий закрыт, используйте SSH deploy key с правом чтения.

Файлы `deploy/beget/` и изменения workflow из локальной папки должны попасть в
репозиторий перед клонированием либо быть отдельно скопированы на сервер.
Node.js 18 указан в старом `.nvmrc`; для нового сервера используйте поддерживаемую
LTS из образа Beget и проверьте установку и запуск зависимостей на ней.

## 3. Перенести данные с Timeweb

### Вариант: Timeweb недоступен, используем локальную копию

В локальной базе подтверждены 2 сценария и 3 комнаты; основной файл изменён
1 октября 2026 года. Изменения, сделанные только на Timeweb, в эту копию не
попадут. При восстановлении Timeweb перенос его более свежих данных нужно
планировать отдельно, с учётом новых изменений на Beget.

Подготовленный архив находится в `deploy/beget/private/` и исключён из Git.
Для повторного создания запустите `deploy/beget/prepare-local-bundle.py`
через Python 3. Скрипт создаёт отдельные снимки SQLite через backup API,
проверяет их, копирует uploads и конфигурации, генерирует новые production
JWT_SECRET и DEPLOY_SECRET. Локальная база и backend/.env сохраняются.

На компьютере в новом окне PowerShell передайте готовый архив:

```powershell
scp "C:\Users\Lozy\Desktop\Detectivka\deploy\beget\private\detectivka-local-20261003-145634-92c137.tar.gz" root@159.194.245.92:/root/
```

После завершения передачи в SSH-консоли Beget, до первого запуска сервера:

```bash
cd /root/apps/Detectivka
tar -xzf /root/detectivka-local-20261003-145634-92c137.tar.gz
chmod 600 backend/.env
node deploy/beget/set-admin-password.cjs
```

Введите и повторите новый пароль admin (не менее 12 символов). Ввод скрыт.
Скрипт обновляет только существующую учётную запись admin уровня super_admin.
После успешной смены пароля переходите к шагу 4. Раздел копирования с Timeweb
ниже при этом варианте пропустите.

Одного Git недостаточно. При SQLite нужны:

- `backend/database.sqlite` — пользователи, комнаты, сценарии;
- `backend/data/` — базы сценариев и адресная книга;
- `backend/uploads/` — загруженные изображения;
- `backend/.env` — реальные настройки и секреты (не публикуйте их).

Уточните путь проекта на Timeweb через `pm2 describe detectivka`.
В старых инструкциях указан `/root/Detectivka`, но он может отличаться.
Проверьте только несекретные параметры:

```bash
cd /путь/к/Detectivka
sed -n '/^DB_TYPE=/p; /^PORT=/p; /^NODE_ENV=/p' backend/.env
```

Если на Timeweb PostgreSQL, этот раздел копирования SQLite не подходит:
сначала подготовьте отдельный `pg_dump` и восстановление PostgreSQL,
сохранив также `backend/data/` и `backend/uploads/`.

Для согласованной копии SQLite остановите приложение в согласованное окно
переноса. Команды ниже останавливают игру до последующего `pm2 start`.
Не копируйте открытые SQLite-файлы обычным `scp` во время записи.

```bash
pm2 stop detectivka
umask 077
runtime_files=(backend/database.sqlite backend/data backend/.env)
if [ -d backend/uploads ]; then runtime_files+=(backend/uploads); fi
archive_path="$HOME/detectivka-runtime-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$archive_path" "${runtime_files[@]}"
printf '%s\n' "$archive_path"
```

Архив содержит пароли доступа и персональные данные. Передайте его по SSH,
например из терминала Timeweb на Beget:

```bash
scp "$archive_path" USER@BEGET_IP:~/
```

На Beget распакуйте архив в корень проекта ДО первого запуска приложения:

```bash
cd ~/apps/Detectivka
tar -xzf ~/detectivka-runtime-ДАТА-ВРЕМЯ.tar.gz
chmod 600 backend/.env
nano backend/.env
```

Установите `NODE_ENV=production`, `PORT=3000`; для переноса SQLite оставьте
`DB_TYPE=sqlite`. Сохраните действующие JWT_SECRET и DEPLOY_SECRET.
Для предварительной проверки можно снова запустить Timeweb: `pm2 start detectivka`.
Перед окончательным переключением повторите копирование с остановкой Timeweb
и Beget, чтобы изменения после первой копии не потерялись. После окончательной
копии старый сервер оставьте остановленным, иначе две базы начнут расходиться.

Если запускаете пустую базу, код создаёт `admin` с паролем `admin123`.
До открытия сайта для игроков замените этот пароль.

## 4. Запустить приложение на Beget

```bash
cd ~/apps/Detectivka
pm2 start deploy/beget/ecosystem.config.cjs
pm2 status
curl -I http://127.0.0.1:3000/
pm2 startup
```

Выполните команду автозапуска, которую напечатает `pm2 startup`, затем:

```bash
pm2 save
pm2 logs detectivka --lines 50 --nostream
```

Если процесс уже существует, используйте
`pm2 restart deploy/beget/ecosystem.config.cjs --update-env`.
Нужен один процесс: подписчики игровых событий хранятся в памяти процесса.

## 5. Настроить Nginx и проверить до смены DNS

```bash
sudo cp deploy/beget/nginx.conf /etc/nginx/sites-available/detectivka
sudo nano /etc/nginx/sites-available/detectivka
```

Замените `example.com` на домен. Если `www` не нужен, уберите его из server_name.
Проверьте `sudo nginx -T`: в образе уже может быть конфигурация приложения.
Для выбранного домена должен остаться один соответствующий server-блок.
Не перезаписывайте конфигурации других сайтов.

```bash
sudo ln -s /etc/nginx/sites-available/detectivka /etc/nginx/sites-enabled/detectivka
sudo nginx -t
sudo systemctl reload nginx
curl -I -H 'Host: example.com' http://127.0.0.1/
```

Если ссылка уже создана, повторно `ln` выполнять не нужно.
В сетевых правилах VPS разрешите SSH и TCP 80/443. Порт 3000 для внешних
подключений закройте: приложение слушает 0.0.0.0, публичный доступ идёт через Nginx.
Если используется UFW, сначала разрешите фактический порт SSH, затем 80/443;
не включайте firewall, пока доступ SSH не обеспечен.

Проверьте сайт с компьютера без смены DNS:

```powershell
curl.exe --resolve example.com:80:BEGET_IP http://example.com/
```

Для проверки в браузере можно временно задать соответствие домена и нового IP
в локальном hosts. Проверьте вход администратора, сценарии, баннеры, Excel
и обновления игровой комнаты в двух вкладках. Удалите временную запись hosts.

## 6. Подключить домен и HTTPS

У действующего DNS-провайдера домена добавьте/измените:

| Тип | Имя | Значение |
| --- | --- | --- |
| A | @ | публичный IPv4 Beget |
| A | www | тот же IPv4 (если нужен www) |

Покупать домен заново или переносить регистрацию необязательно.
Если хотите DNS Beget, сначала перенесите все существующие записи, включая
MX/TXT для почты, затем измените NS у регистратора на значения из панели Beget.
Если есть AAAA, он должен вести на настроенный IPv6 нового VPS; устаревший
AAAA может отправлять часть посетителей на старый сервер.

Дождитесь, пока домен и www указывают на новый сервер. Проверьте A и AAAA:

```powershell
Resolve-DnsName example.com -Type A
Resolve-DnsName example.com -Type AAAA
```

Установите Certbot по [инструкции Beget](https://beget.com/ru/kb/how-to/vps/vypusk-i-ustanovka-ssl-sertifikatov-ot-lets-encrypt-na-vps),
если он ещё не установлен в образе, и выпустите сертификат:

```bash
sudo certbot --nginx -d example.com -d www.example.com --redirect
sudo nginx -t
sudo certbot renew --dry-run
```

Для домена без www уберите второй `-d`. Проверьте HTTPS и игру с нового адреса.

## 7. Переключить автодеплой

В GitHub → Settings → Secrets and variables → Actions → Secrets обновите
Repository secret `DEPLOY_SECRET`: он должен совпадать со значением на Beget.
Изменённый workflow `Deploy to Beget` использует
`https://www.detektum.ru/api/deploy`, проверенный снаружи по HTTPS.
Repository variable DEPLOY_URL для этого workflow не требуется.

Файлы deploy/beget, ранее распакованные на Beget из архива, ещё не отслеживаются
Git на сервере. Перед первой публикацией нового workflow перенесите эту папку
в резервную копию за пределами проекта, чтобы git pull не столкнулся с ними:

```bash
cd /root/apps/Detectivka
mv deploy /root/detectivka-deploy-before-git-$(date +%Y%m%d-%H%M%S)
```

Работающий процесс PM2, backend/.env, SQLite и uploads этим не меняются.
Затем опубликуйте изменения workflow и файлов deploy/beget в main.
Git pull создаст отслеживаемые конфигурации из репозитория.

В Actions выберите `Deploy to Beget` → Run workflow.
Успешный ответ вебхука означает получение запроса; дополнительно проверьте
`pm2 status`, логи, `git log -1 --oneline` и сайт: установка зависимостей и
перезапуск должны завершиться успешно. Timeweb отключайте только после проверки
данных, HTTPS и автодеплоя. До отключения сохраните резервную копию.

Пока новый VPS и домен не выбраны, публикация и смена DNS не выполнены.
