#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/release.sh [patch|minor|major|v1.2.3]
# Builds, bumps version, commits, tags, pushes, and publishes a GitHub release.

BUMP="${1:-patch}"

# Bail on dirty working tree (besides package.json changes we're about to make)
if ! git diff --quiet --exit-code -- ':!package.json' ':!package-lock.json'; then
  echo "Error: uncommitted changes. Commit or stash first." >&2
  exit 1
fi

# Build and verify
echo "Building..."
npm run build

echo "Verifying binary..."
node dist/cli.js --help >/dev/null 2>&1

# Bump version
if [[ "$BUMP" =~ ^v[0-9] ]]; then
  npm version "${BUMP#v}" --no-git-tag-version
else
  npm version "$BUMP" --no-git-tag-version
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

echo "Releasing ${TAG}"

# Create tarball
npm pack
TARBALL="lib-copilot-${VERSION}.tgz"
mv "$TARBALL" "vcopilot-${VERSION}.tgz"
TARBALL="vcopilot-${VERSION}.tgz"

# Commit, tag, push
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "release: ${TAG}"
git tag "$TAG"
git push && git push --tags

# Publish GitHub release with tarball
gh release create "$TAG" "$TARBALL" \
  --title "$TAG" \
  --generate-notes

rm "$TARBALL"

echo ""
echo "Released ${TAG}"
echo "  https://github.com/spqw/lib-copilot/releases/tag/${TAG}"
