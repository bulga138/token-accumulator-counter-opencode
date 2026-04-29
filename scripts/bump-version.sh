#!/bin/bash
set -euo pipefail

# Bump version in package.json based on BUMP_TYPE environment variable
# Usage: BUMP_TYPE=major|minor|patch ./scripts/bump-version.sh

BUMP_TYPE="${BUMP_TYPE:-patch}"

# Read current version from package.json
CURRENT=$(node -p "require('./package.json').version")

# Parse version parts
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Calculate new version
case "$BUMP_TYPE" in
  major)
    NEW_VERSION="$((MAJOR + 1)).0.0"
    ;;
  minor)
    NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
    ;;
  patch)
    NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
    ;;
  *)
    echo "Error: Invalid BUMP_TYPE. Must be major, minor, or patch."
    exit 1
    ;;
esac

echo "Bumping version: $CURRENT → $NEW_VERSION"

# Update package.json
node -e "const pkg=require('./package.json'); pkg.version='$NEW_VERSION'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2))"

echo "Version updated to $NEW_VERSION"