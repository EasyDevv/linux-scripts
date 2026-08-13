#!/bin/bash

# Initialize monorepo configuration files script
# Works in both bash and fish shells

set -e

# Get the current directory where the script is executed
BASE_DIR="$(pwd)"

echo "Initializing monorepo configuration in: $BASE_DIR"

# Create .moon directory and moon.yml
mkdir -p "$BASE_DIR/.moon"
cat > "$BASE_DIR/.moon/moon.yml" << 'EOF'
# https://moonrepo.dev/docs/config/workspace
$schema: './cache/schemas/workspace.json'

# extends: './shared/workspace.yml'

projects:
  - 'apps/*'
  - 'packages/*'

EOF

# Create apps/app-01 directory and moon.yml
mkdir -p "$BASE_DIR/apps/app-01"
cat > "$BASE_DIR/apps/app-01/moon.yml" << 'EOF'
type: "application"

tasks:
  dev:
    command: "bunx --bun astro dev"
    local: true
  build:
    command: "bunx --bun astro build"
  preview:
    command: "bunx --bun astro preview"
    deps:
      - "build"
    local: true
  astro:
    command: "bunx --bun astro"
EOF

# Create packages/package-01 directory and moon.yml
mkdir -p "$BASE_DIR/packages/package-01"
cat > "$BASE_DIR/packages/package-01/moon.yml" << 'EOF'
type: "library"

tasks:
  dev:
    command: "bun build src/index.ts --outdir dist --watch"
    local: true
  build:
    command: "bun build src/index.ts --outdir dist"
EOF

# Create package.json
cat > "$BASE_DIR/package.json" << 'EOF'
{
  "name": "monorepo-root",
  "private": true,
  "infra": "monorepo",
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
EOF

# Create .gitignore
cat > "$BASE_DIR/.gitignore" << 'EOF'
# moon
.moon/cache
.moon/docker

# build output
dist/
# generated types
.astro/

# dependencies
node_modules/

# logs
*.log*

# environment variables
.env
.env.production

# macOS-specific files
.DS_Store
EOF

echo "✓ Created .moon/moon.yml"
echo "✓ Created apps/app-01/moon.yml"
echo "✓ Created packages/package-01/moon.yml"
echo "✓ Created package.json"
echo "✓ Created .gitignore"
echo ""
echo "Monorepo initialization complete!"
echo "Run from any directory, files will be created relative to execution location."