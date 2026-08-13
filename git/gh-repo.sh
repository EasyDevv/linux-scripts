#!/bin/bash

# Script to create a GitHub repository and connect it to the current local project
# Usage: ./scripts/create-github-repo.sh [repository-name]

# --- Color Definitions ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

set -e # Exit on any error

# --- Check Prerequisites ---
# Check if gh CLI is installed
if ! command -v gh &>/dev/null; then
  echo -e "${RED}Error: GitHub CLI (gh) is not installed.${NC}"
  echo -e "${YELLOW}Please install it from https://cli.github.com/${NC}"
  exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo -e "${RED}Error: Not in a git repository${NC}"
  exit 1
fi

# --- Get Repository Name ---
# Get repository name from argument or default to current directory name
REPO_NAME="${1:-$(basename "$(pwd)")}"

# --- Check If Repository Already Exists ---
# Check if repository already exists on GitHub
echo -e "${CYAN}Checking if repository $REPO_NAME already exists...${NC}"
if gh repo view "$REPO_NAME" >/dev/null 2>&1; then
  echo -e "${GREEN}Repository $REPO_NAME already exists on GitHub.${NC}"

  # Get the repository URL
  REPO_URL=$(gh repo view "$REPO_NAME" --json url -q '.url')

  # Check if the remote is already connected
  if git remote get-url origin >/dev/null 2>&1; then
    CURRENT_REMOTE=$(git remote get-url origin)
    if [[ "$CURRENT_REMOTE" == *"$REPO_NAME"* ]]; then
      echo -e "${GREEN}Local repository is already connected to the remote.${NC}"
    else
      echo -e "${YELLOW}Connecting local repository to existing remote...${NC}"
      git remote set-url origin "$REPO_URL"
    fi
  else
    echo -e "${YELLOW}Connecting local repository to existing remote...${NC}"
    git remote add origin "$REPO_URL"
  fi

  # Push current code
  echo -e "${CYAN}Pushing code to existing repository...${NC}"
  git push -u origin main || git push -u origin master

  echo -e "${GREEN}Repository $REPO_NAME is now connected and code has been pushed!${NC}"
  echo -e "${BLUE}Repository URL: $REPO_URL${NC}"
  exit 0
fi

# --- Create New Repository ---
# Prompt user for visibility selection
echo -e "${CYAN}Repository $REPO_NAME does not exist. Creating new repository.${NC}"
echo -e "${YELLOW}Select repository visibility:${NC}"
echo -e "${YELLOW}1) Private (default)${NC}"
echo -e "${YELLOW}2) Public${NC}"
read -p "Enter your choice (1 or 2): " visibility_choice

# Set visibility based on user input
case "$visibility_choice" in
  2)
    VISIBILITY="public"
    ;;
  *)
    VISIBILITY="private"
    ;;
esac

echo -e "${CYAN}Creating GitHub repository: $REPO_NAME with visibility: $VISIBILITY${NC}"

# Create GitHub repository and push current code
if gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --push; then
  echo -e "${GREEN}Repository $REPO_NAME created successfully and code pushed!${NC}"
  echo -e "${BLUE}Repository URL: https://github.com/$(gh api user | jq -r '.login')/$REPO_NAME${NC}"
else
  echo -e "${RED}Failed to create repository${NC}"
  exit 1
fi
