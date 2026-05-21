#!/usr/bin/env bash
# Run Playwright e2e tests inside the official Playwright Docker image,
# which has all required browser shared libraries pre-installed (we can't
# apt-install libnspr4 etc. without sudo on the dev host).
#
# Usage:
#   scripts/e2e-docker.sh                       # all projects
#   scripts/e2e-docker.sh --project live-mainnet
#   scripts/e2e-docker.sh --grep "A1"

set -e

IMAGE="mcr.microsoft.com/playwright:v1.60.0-noble"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

docker run --rm --network host \
    -v "$REPO":/work \
    -w /work \
    -e CI="${CI:-}" \
    "$IMAGE" \
    npx playwright test --reporter=list "$@"
