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

# Create tarball (scoped package @spqw/vcopilot -> spqw-vcopilot-VERSION.tgz)
npm pack
PACK_TARBALL=$(ls -1 spqw-vcopilot-*.tgz 2>/dev/null || ls -1 lib-copilot-*.tgz 2>/dev/null)
TARBALL="vcopilot-${VERSION}.tgz"
mv "$PACK_TARBALL" "$TARBALL"

# Commit, tag, push
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "release: ${TAG}"
git tag "$TAG"
git push && git push --tags

# Publish GitHub release with tarball
gh release create "$TAG" "$TARBALL" \
  --title "$TAG" \
  --generate-notes

# Publish to npm private registry
echo "Publishing to npm..."
npm publish

# Update Homebrew formula
SHA256=$(shasum -a 256 "$TARBALL" | awk '{print $1}')
URL="https://github.com/spqw/lib-copilot/releases/download/${TAG}/${TARBALL}"

TAP_DIR=$(mktemp -d)
git clone https://github.com/spqw/homebrew-tap.git "$TAP_DIR"

if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s|url \".*\"|url \"${URL}\"|" "$TAP_DIR/Formula/vcopilot.rb"
  sed -i '' "s|sha256 \".*\"|sha256 \"${SHA256}\"|" "$TAP_DIR/Formula/vcopilot.rb"
else
  sed -i "s|url \".*\"|url \"${URL}\"|" "$TAP_DIR/Formula/vcopilot.rb"
  sed -i "s|sha256 \".*\"|sha256 \"${SHA256}\"|" "$TAP_DIR/Formula/vcopilot.rb"
fi

git -C "$TAP_DIR" add Formula/vcopilot.rb
git -C "$TAP_DIR" commit -m "vcopilot ${VERSION}"
git -C "$TAP_DIR" push

rm -rf "$TAP_DIR"
rm "$TARBALL"

echo ""
echo "Released ${TAG}"
echo "  GitHub:   https://github.com/spqw/lib-copilot/releases/tag/${TAG}"
echo "  npm:      @spqw/vcopilot@${VERSION}"
echo "  Homebrew: brew upgrade spqw/homebrew-tap/vcopilot"
echo "  mise:     mise upgrade vcopilot  (auto-discovers new tags)"
