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

# Update Homebrew tap
publish-homebrew \
  --tap spqw/homebrew-tap \
  --formula vcopilot \
  --repo spqw/lib-copilot \
  --tag "$TAG" \
  --asset "$TARBALL" \
  --desc "GitHub Copilot CLI - pipe-friendly LLM interface" \
  --depends-on node \
  --bin vcopilot

# Update mise plugin (regenerates scripts if changed)
publish-mise \
  --plugin-repo spqw/asdf-vcopilot \
  --repo spqw/lib-copilot \
  --tool vcopilot \
  --asset "vcopilot-{version}.tgz" \
  --type npm

rm "$TARBALL"

echo ""
echo "Released ${TAG}"
echo "  GitHub:   https://github.com/spqw/lib-copilot/releases/tag/${TAG}"
echo "  npm:      @spqw/vcopilot@${VERSION}"
echo "  Homebrew: brew upgrade spqw/homebrew-tap/vcopilot"
echo "  mise:     mise upgrade vcopilot  (auto-discovers new tags)"
