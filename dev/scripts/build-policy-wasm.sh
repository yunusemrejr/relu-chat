#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
clang --target=wasm32 -O3 -fno-fast-math -nostdlib -Wl,--no-entry -Wl,--export-memory -Wl,--initial-memory=131072 -Wl,--max-memory=131072 -Wl,-z,stack-size=16384 -Wl,--strip-all dev/wasm/policy.c -o assets/models/policy/policy.wasm
chmod 644 assets/models/policy/policy.wasm
