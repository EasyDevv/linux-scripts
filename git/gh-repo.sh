#!/bin/bash

# Script to create a GitHub repository and connect it to the current local project
# Usage: gh-repo [repository-name]

# --- Color Definitions ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

set -euo pipefail

# --- Check Prerequisites ---
if ! command -v gh &>/dev/null; then
  echo -e "${RED}Error: GitHub CLI (gh) is not installed.${NC}"
  echo -e "${YELLOW}Please install it from https://cli.github.com/${NC}"
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo -e "${RED}Error: Not in a git repository${NC}"
  exit 1
fi

# --- Get Repository Name ---
DEFAULT_REPO_NAME="${1:-$(basename "$(pwd)")}"
if [[ -t 0 ]]; then
  read -rp "$(printf "%b" "${YELLOW}Repository name [${DEFAULT_REPO_NAME}]: ${NC}")" REPO_NAME
  REPO_NAME="${REPO_NAME#"${REPO_NAME%%[![:space:]]*}"}"
  REPO_NAME="${REPO_NAME%"${REPO_NAME##*[![:space:]]}"}"
  REPO_NAME="${REPO_NAME:-$DEFAULT_REPO_NAME}"
else
  REPO_NAME="$DEFAULT_REPO_NAME"
fi

GH_USER=$(gh api user --jq '.login')
REPO_FULL="${GH_USER}/${REPO_NAME}"

repo_https_url() {
  gh repo view "$REPO_FULL" --json url --jq '.url'
}

connect_origin() {
  local repo_url="$1"
  case "$repo_url" in
    https://github.com/* | http://github.com/* | git@github.com:*)
      ;;
    *)
      echo -e "${RED}Error: refusing to set origin to a non-GitHub URL.${NC}" >&2
      exit 1
      ;;
  esac
  if git remote get-url origin >/dev/null 2>&1; then
    echo -e "${YELLOW}Updating origin to ${repo_url}${NC}"
    git remote set-url origin "$repo_url"
  else
    echo -e "${YELLOW}Adding origin ${repo_url}${NC}"
    git remote add origin "$repo_url"
  fi
}

push_current_branch() {
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  echo -e "${CYAN}Pushing ${branch} to origin...${NC}"
  git push -u origin "$branch"
}

# --- Check If Repository Already Exists ---
echo -e "${CYAN}Checking if repository ${REPO_FULL} already exists...${NC}"
if gh repo view "$REPO_FULL" >/dev/null 2>&1; then
  echo -e "${GREEN}Repository ${REPO_FULL} already exists on GitHub.${NC}"
  REPO_URL=$(repo_https_url)
  connect_origin "$REPO_URL"
  push_current_branch
  echo -e "${GREEN}Repository ${REPO_NAME} is now connected and code has been pushed!${NC}"
  echo -e "${BLUE}Repository URL: ${REPO_URL}${NC}"
  exit 0
fi

# --- Create New Repository ---
echo -e "${CYAN}Repository ${REPO_FULL} does not exist. Creating new repository.${NC}"
if [[ -t 0 ]]; then
  echo -e "${YELLOW}Select repository visibility:${NC}"
  echo -e "${YELLOW}1) Private (default)${NC}"
  echo -e "${YELLOW}2) Public${NC}"
  read -rp "Enter your choice (1 or 2): " visibility_choice
else
  visibility_choice=1
fi

case "$visibility_choice" in
  2)
    VISIBILITY="public"
    ;;
  *)
    VISIBILITY="private"
    ;;
esac

echo -e "${CYAN}Creating GitHub repository: ${REPO_FULL} with visibility: ${VISIBILITY}${NC}"

if ! gh repo create "$REPO_FULL" --"$VISIBILITY"; then
  echo -e "${RED}Failed to create repository${NC}"
  exit 1
fi

REPO_URL=$(repo_https_url)
connect_origin "$REPO_URL"
if ! push_current_branch; then
  echo -e "${RED}Repository created, but pushing code failed.${NC}"
  echo -e "${BLUE}Repository URL: ${REPO_URL}${NC}"
  exit 1
fi

echo -e "${GREEN}Repository ${REPO_NAME} created successfully and code pushed!${NC}"
echo -e "${BLUE}Repository URL: ${REPO_URL}${NC}"
