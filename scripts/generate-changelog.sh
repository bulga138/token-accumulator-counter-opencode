#!/bin/bash
set -euo pipefail

# Generate changelog from commits since last tag
# Usage: ./scripts/generate-changelog.sh [previous_tag]

PREV_TAG="${1:-$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo '')}"

echo "## What's Changed"
echo ""

if [ -n "$PREV_TAG" ]; then
  COMMITS=$(git log ${PREV_TAG}..HEAD --pretty=format:"%s")
  echo "Since ${PREV_TAG}:"
else
  COMMITS=$(git log --pretty=format:"%s")
  echo "Initial release:"
fi

echo ""
echo "### New Features"
FEAT_COMMITS=$(echo "$COMMITS" | grep "^feat:" || true)
if [ -n "$FEAT_COMMITS" ]; then
  echo "$FEAT_COMMITS" | sed 's/^feat:/-/'
else
  echo "None"
fi

echo ""
echo "### Bug Fixes"
FIX_COMMITS=$(echo "$COMMITS" | grep "^fix:" || true)
if [ -n "$FIX_COMMITS" ]; then
  echo "$FIX_COMMITS" | sed 's/^fix:/-/'
else
  echo "None"
fi

echo ""
echo "### Other Changes"
OTHER_COMMITS=$(echo "$COMMITS" | grep -E "^(docs|chore|refactor|test):" || true)
if [ -n "$OTHER_COMMITS" ]; then
  echo "$OTHER_COMMITS" | sed 's/^[^:]*:/-/'
else
  echo "None"
fi