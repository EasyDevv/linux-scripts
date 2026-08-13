#!/usr/bin/env bash

set -euo pipefail

cd /home/easydev/dev/public/llm-docs
exec bun run doc:dev -- "$@"
