#!/usr/bin/env bash
# Read-only diagnostics: run on the Ubuntu server before reproducing on the tablet.
set -u

for task_tool in curl pm2 git; do
  if ! command -v "$task_tool" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$task_tool" >&2
    exit 1
  fi
done

printf 'Organizer access diagnostics. Times are UTC. Duration: about 90 seconds.\n'
printf 'Project revision: '
git -C "$(dirname "$0")/.." rev-parse --short HEAD
pm2 status
printf 'Now reproduce the problem on the tablet. Also check the phone on mobile data.\n'

task_started=$SECONDS
while (( SECONDS - task_started < 90 )); do
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  curl -q --noproxy '*' -sS --connect-timeout 1 --max-time 2 -o /dev/null \
    -w 'app-root http=%{http_code} total=%{time_total}s\n' \
    'http://127.0.0.1:3000/?diagnostic=organizer'
  curl -q --noproxy '*' -sS --connect-timeout 1 --max-time 2 -o /dev/null \
    -w 'app-login http=%{http_code} total=%{time_total}s\n' \
    'http://127.0.0.1:3000/admin-login?diagnostic=organizer'
  curl -q --noproxy '*' -sS --connect-timeout 1 --max-time 2 -o /dev/null \
    --resolve 'detektum.ru:443:127.0.0.1' \
    -w 'nginx-login http=%{http_code} total=%{time_total}s\n' \
    'https://detektum.ru/admin-login?diagnostic=organizer'
  sleep 2
done
pm2 status
printf 'Finished. This checks local Node and nginx; it does not test the external network path.\n'
