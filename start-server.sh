#!/usr/bin/env sh
# Юготарія: сервер онлайн-гри (Linux / macOS). Інший порт: ./start-server.sh --port 9000
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не знайдено. Встановіть версію LTS з https://nodejs.org"
  exit 1
fi
exec node server/server.js "$@"
