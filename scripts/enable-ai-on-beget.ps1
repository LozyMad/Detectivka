# Run from a local PowerShell terminal. SSH asks for the VPS password if needed.
# The API key travels through encrypted SSH stdin; it is never a command argument.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskConfigPath = Join-Path $taskRoot 'backend/.env.ai'
if (!(Test-Path -LiteralPath $taskConfigPath)) { throw 'Local backend/.env.ai is missing.' }
$taskConfig = [System.IO.File]::ReadAllText($taskConfigPath)
if ($taskConfig -notmatch '(?m)^AI_GRADING_ENABLED=1\s*$' -or
    $taskConfig -notmatch '(?m)^YANDEX_AI_API_KEY=\S+\s*$') {
    throw 'Add the API key and set AI_GRADING_ENABLED=1 in backend/.env.ai first.'
}
$taskRemoteScript = @'
set -eu
cd /root/apps/Detectivka
test -f backend/services/yandexGrading.js
test -f scripts/check-ai-grading.cjs
umask 077
stage=$(mktemp -d /root/apps/Detectivka/backend/.ai-setup.XXXXXX)
trap 'rm -f "$stage/incoming" "$stage/previous"; rmdir "$stage"' EXIT
cat > "$stage/incoming"
had_previous=0
if test -f backend/.env.ai; then
  cp backend/.env.ai "$stage/previous"
  had_previous=1
fi
chmod 600 "$stage/incoming"
mv "$stage/incoming" backend/.env.ai
if ! node -e 'const d=require("./backend/node_modules/dotenv"); d.config({path:"backend/.env"}); d.config({path:"backend/.env.ai"}); if(process.env.AI_GRADING_ENABLED!=="1"){console.error("AI flag is overridden by the existing server environment."); process.exit(1);}' || ! node scripts/check-ai-grading.cjs --full; then
  if test "$had_previous" = 1; then
    mv "$stage/previous" backend/.env.ai
  else
    rm -f backend/.env.ai
  fi
  echo 'API verification failed. Previous configuration restored; application was not restarted.' >&2
  exit 1
fi
pm2 restart detectivka --update-env
echo 'AI configuration installed. Start a NEW demo game to check automatic grading.'
'@
$taskRemoteScript = $taskRemoteScript.Replace("`r", '')
$taskEncodedScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskRemoteScript))
$taskSshCommand = 'bash -c "$(printf %s ' + $taskEncodedScript + ' | base64 -d)"'
Write-Host 'Connecting to Beget. Enter the VPS root password if SSH requests it.'
Write-Host 'Verification makes one paid Yandex request for seven sample answers. It does not change game data.'
$taskPreviousEncoding = $OutputEncoding
try {
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $taskConfig | & ssh -o StrictHostKeyChecking=yes -o ConnectTimeout=20 root@159.194.252.192 $taskSshCommand
    if ($LASTEXITCODE -ne 0) { throw 'Server setup did not complete. See the message above; no secret was logged.' }
} finally {
    $OutputEncoding = $taskPreviousEncoding
    $taskConfig = $null
}
