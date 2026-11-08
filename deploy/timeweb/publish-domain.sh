#!/usr/bin/env bash
# Finish the domain cutover after DNS A records point at the prepared Timeweb VM.
# This changes Nginx/TLS and the canonical URL, not application data.
set -Eeuo pipefail
client=/opt/detektum-certbot/bin/certbot
config=/etc/letsencrypt-ip
webroot=/var/www/detektum-acme
backup=/root/detektum-domain-before-https-20261108
test -x "$client"
test -e /etc/nginx/sites-enabled/detektum-ip-https
install -d -m 700 "$backup"
for name in detektum-domain-http detektum-ip-https; do
    if [[ ! -e $backup/$name ]]; then
        cp -a "/etc/nginx/sites-available/$name" "$backup/$name"
    fi
done
if [[ ! -e $backup/env-before ]]; then
    cp -a /home/detectum/apps/Detectivka/backend/.env "$backup/env-before"
fi

if [[ ! -e $config/live/detektum-domain/fullchain.pem ]]; then
    "$client" certonly --non-interactive --agree-tos --register-unsafely-without-email \
        --webroot --webroot-path "$webroot" \
        -d detektum.ru -d www.detektum.ru --cert-name detektum-domain \
        --config-dir "$config" --work-dir /var/lib/letsencrypt-ip --logs-dir /var/log/letsencrypt-ip \
        --deploy-hook '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'
fi

python3 <<'PY'
import json
import os
import re
from pathlib import Path

sites=Path('/etc/nginx/sites-available')
ip_path=sites/'detektum-ip-https'
ip=ip_path.read_text()
assert 'server_name 179.236.41.171;' in ip
assert '/live/detektum-ip/' in ip
# IP clients may not send SNI. Keep their IP certificate as the explicit default
# so GitHub Actions can continue using its direct-IP deployment URL.
domain=ip.replace('listen 443 ssl default_server;', 'listen 443 ssl;')
domain=domain.replace('server_name 179.236.41.171;', 'server_name detektum.ru;')
domain=domain.replace('/live/detektum-ip/', '/live/detektum-domain/')
domain=domain.replace('    add_header X-Robots-Tag "noindex, nofollow" always;\n', '')
ip=re.sub(r'listen\s+443\s+ssl\s*;', 'listen 443 ssl default_server;', ip)
assert 'listen 443 ssl default_server;' in ip
ip_path.write_text(ip)
domain+='''
server {
    listen 443 ssl;
    server_name www.detektum.ru;
    ssl_certificate /etc/letsencrypt-ip/live/detektum-domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt-ip/live/detektum-domain/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    return 301 https://detektum.ru$request_uri;
}
'''
(sites/'detektum-domain-https').write_text(domain)

env_path=Path('/home/detectum/apps/Detectivka/backend/.env')
lines=[line for line in env_path.read_text().splitlines() if not line.startswith('PLAYER_PUBLIC_BASE_URL=')]
lines.append('PLAYER_PUBLIC_BASE_URL=https://detektum.ru')
env_path.write_text('\n'.join(lines)+'\n')
os.chmod(env_path,0o600)
access=Path('/home/detectum/.detektum-first-access.json')
if access.exists():
    info=json.loads(access.read_text())
    info['url']='https://detektum.ru/admin-login'
    access.write_text(json.dumps(info,indent=2)+'\n')
    os.chmod(access,0o600)
PY

cat > /etc/nginx/sites-available/detektum-domain-http <<'HTTP'
server {
    listen 80;
    server_name detektum.ru www.detektum.ru;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/detektum-acme;
        try_files $uri =404;
    }
    location / { return 301 https://detektum.ru$request_uri; }
}
HTTP
if [[ ! -e /etc/nginx/sites-enabled/detektum-domain-https ]]; then
    ln -s /etc/nginx/sites-available/detektum-domain-https /etc/nginx/sites-enabled/detektum-domain-https
fi
nginx -t
systemctl reload nginx
systemctl enable --now detektum-certbot-ip.timer
"$client" renew --cert-name detektum-domain --dry-run --run-deploy-hooks \
    --non-interactive --agree-tos --register-unsafely-without-email --no-random-sleep-on-renew \
    --config-dir "$config" --work-dir /var/lib/letsencrypt-ip --logs-dir /var/log/letsencrypt-ip
openssl x509 -in "$config/live/detektum-domain/fullchain.pem" -noout -dates -ext subjectAltName
echo 'Domain HTTPS ready; IP HTTPS preserved; no database changes or application restart.'
