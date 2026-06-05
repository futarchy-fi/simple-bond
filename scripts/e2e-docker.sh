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

JSON_REPORT="${PLAYWRIGHT_JSON_OUTPUT_NAME:-test-results/report.json}"

docker run --rm \
    -v "$REPO":/work \
    -w /work \
    -e CI="${CI:-}" \
    -e PLAYWRIGHT_JSON_OUTPUT_NAME="$JSON_REPORT" \
    "$IMAGE" \
    bash -c '
        # Background static server for the `local` project (no-op for live ones).
        python3 -m http.server 8765 --directory frontend > /tmp/static-srv.log 2>&1 &
        for i in 1 2 3 4 5; do
            if curl -sf http://127.0.0.1:8765/ > /dev/null; then break; fi
            sleep 1
        done
        npx playwright test "$@"
    ' bash "$@"

# Aggregate the JSON report into the scoreboard capability flags. The
# aggregator is the sole writer of capabilities and is safe to re-run
# standalone against this saved report.
if [ -f "$REPO/$JSON_REPORT" ]; then
    node "$REPO/scripts/aggregate-capabilities.mjs" "$REPO/$JSON_REPORT"
else
    echo "e2e-docker: no JSON report at $JSON_REPORT; skipping capability aggregation" >&2
fi
