#!/usr/bin/env bash
# Run Playwright e2e tests inside the official Playwright Docker image.
# Spawns a tiny static server inside the container so the `local` project's
# baseURL (http://localhost:8765) is reachable without host networking.
#
# Usage:
#   scripts/e2e-docker.sh                       # all projects
#   scripts/e2e-docker.sh --project live-mainnet
#   scripts/e2e-docker.sh --grep "A1"

set -e

IMAGE="mcr.microsoft.com/playwright:v1.60.0-noble"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

docker run --rm \
    -v "$REPO":/work \
    -w /work \
    -e CI="${CI:-}" \
    "$IMAGE" \
    bash -c '
        # Background static server for the `local` project (no-op for live ones).
        python3 -m http.server 8765 --directory frontend > /tmp/static-srv.log 2>&1 &
        for i in 1 2 3 4 5; do
            if curl -sf http://127.0.0.1:8765/ > /dev/null; then break; fi
            sleep 1
        done
        npx playwright test --reporter=list "$@"
    ' bash "$@"
