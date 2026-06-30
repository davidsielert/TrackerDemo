#!/usr/bin/env sh
set -eu

if curl -fsS -X DELETE http://tracker.localhost:4000/api/events >/dev/null 2>&1; then
  echo "Cleared local Node demo data."
  exit 0
fi

docker compose exec tracker npm run reset
