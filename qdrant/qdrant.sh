#!/bin/bash
# Qdrant CLI wrapper script
# Usage: ./qdrant.sh [args...]
# Usage: QDRANT_CLI_DIR=/path ./qdrant.sh [args...]
# Usage: ./qdrant.sh --cli-dir=/path [args...]

# Define required packages
PACKAGES=(
    "qdrant-client"
    "ollama"
    "aiohttp"
    "tqdm"
)

# Convert packages to --with options
WITH_ARGS=""
for package in "${PACKAGES[@]}"; do
    WITH_ARGS+=" --with $package"
done

# Parse CLI directory
for arg in "$@"; do
    case $arg in
        --cli-dir=*) CLI_DIR="${arg#*=}" ;;
    esac
done

# Default to environment variable if not set
: "${CLI_DIR:=$QDRANT_CLI_DIR}"

# Get current working directory (CLI directory)
CURRENT_DIR="$(pwd)"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find qdrant.py (Current working directory first, then CLI path, then script directory)
PY_DIR=""
if [[ -f "$CURRENT_DIR/qdrant.py" ]]; then
    PY_DIR="$CURRENT_DIR"
    echo "Using qdrant.py from current directory: $CURRENT_DIR"
elif [[ -n "$CLI_DIR" && -f "$CLI_DIR/qdrant.py" ]]; then
    PY_DIR="$CLI_DIR"
    echo "Using qdrant.py from CLI directory: $CLI_DIR"
elif [[ -f "$SCRIPT_DIR/qdrant.py" ]]; then
    PY_DIR="$SCRIPT_DIR"
    echo "Using qdrant.py from script directory: $SCRIPT_DIR"
fi

# Error if not found
if [[ -z "$PY_DIR" ]]; then
    echo "Error: qdrant.py not found"
    echo "Checked: current directory ($CURRENT_DIR), CLI path ($CLI_DIR), script directory ($SCRIPT_DIR)"
    echo "Usage: ./qdrant.sh [args...]"
    exit 1
fi

# Execute
exec uvx $WITH_ARGS python3 "$PY_DIR/qdrant.py" "$@"