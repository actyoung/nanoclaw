#!/bin/bash
# Build the NanoClaw agent container image
# Automatically detects system architecture (ARM64 for M-series Macs, AMD64 for Intel Macs)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Detect system architecture
# macOS: 'arm64' for M-series (M1/M2/M3/M4), 'x86_64' for Intel
# Linux: 'aarch64' for ARM64, 'x86_64' for AMD64
ARCH=$(uname -m)

# Normalize architecture names
if [[ "$ARCH" == "arm64" ]] || [[ "$ARCH" == "aarch64" ]]; then
    DOCKERFILE="Dockerfile.arm64"
    ARCH_NAME="ARM64 (Apple Silicon / M-series)"
elif [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    DOCKERFILE="Dockerfile.amd64"
    ARCH_NAME="AMD64 (Intel)"
else
    echo "Error: Unsupported architecture: $ARCH"
    echo "Supported architectures: arm64, aarch64, x86_64, amd64"
    exit 1
fi

# Check if the Dockerfile exists
if [[ ! -f "$DOCKERFILE" ]]; then
    echo "Error: Dockerfile not found: $DOCKERFILE"
    echo "Please ensure the Dockerfile exists for your architecture."
    exit 1
fi

# Update skills-cli with latest find-skills content from vercel-labs/skills repo
update_skills_cli() {
    local TMP_REPO="/tmp/skills-repo-nanoclaw"
    local SKILLS_CLI_DIR="./skills/skills-cli"
    local FIND_SKILLS_MD="$TMP_REPO/skills/find-skills/SKILL.md"
    local VERSION_FILE="$SKILLS_CLI_DIR/.version"

    echo "Checking for skills-cli updates..."

    # Clone repo
    rm -rf "$TMP_REPO"
    if ! git clone --depth 1 https://github.com/vercel-labs/skills.git "$TMP_REPO" 2>/dev/null; then
        echo "Warning: Failed to fetch latest skills info from vercel-labs/skills repo"
        return
    fi

    # Check if find-skills SKILL.md exists
    if [ ! -f "$FIND_SKILLS_MD" ]; then
        echo "Warning: find-skills/SKILL.md not found in cloned repo"
        rm -rf "$TMP_REPO"
        return
    fi

    # Extract commands from find-skills SKILL.md
    # Look for key commands section: "npx skills find", "npx skills add", etc.
    local EXTRACTED_COMMANDS=""
    if grep -q "npx skills find" "$FIND_SKILLS_MD"; then
        EXTRACTED_COMMANDS="find"
    fi
    if grep -q "npx skills add" "$FIND_SKILLS_MD"; then
        EXTRACTED_COMMANDS="${EXTRACTED_COMMANDS},add"
    fi
    if grep -q "npx skills check" "$FIND_SKILLS_MD"; then
        EXTRACTED_COMMANDS="${EXTRACTED_COMMANDS},check"
    fi
    if grep -q "npx skills update" "$FIND_SKILLS_MD"; then
        EXTRACTED_COMMANDS="${EXTRACTED_COMMANDS},update"
    fi

    # Remove leading comma if present
    EXTRACTED_COMMANDS=$(echo "$EXTRACTED_COMMANDS" | sed 's/^,//')

    # Read current .version file
    local CURRENT_VERSION="1.0.0"
    local CURRENT_COMMANDS="add,list,find,remove,check,update"
    local CURRENT_UPDATED_AT="2025-03-04"

    if [ -f "$VERSION_FILE" ]; then
        # shellcheck source=/dev/null
        source "$VERSION_FILE"
        CURRENT_COMMANDS="${COMMANDS:-$CURRENT_COMMANDS}"
        CURRENT_VERSION="${VERSION:-$CURRENT_VERSION}"
        CURRENT_UPDATED_AT="${UPDATED_AT:-$CURRENT_UPDATED_AT}"
    fi

    # Compare commands (sort and normalize for comparison)
    local SORTED_EXTRACTED
    local SORTED_CURRENT
    SORTED_EXTRACTED=$(echo "$EXTRACTED_COMMANDS" | tr ',' '\n' | sort | tr '\n' ',' | sed 's/,$//')
    SORTED_CURRENT=$(echo "$CURRENT_COMMANDS" | tr ',' '\n' | sort | tr '\n' ',' | sed 's/,$//')

    if [ "$SORTED_EXTRACTED" != "$SORTED_CURRENT" ] && [ -n "$EXTRACTED_COMMANDS" ]; then
        echo "Detected changes in find-skills commands:"
        echo "  Current: $CURRENT_COMMANDS"
        echo "  New:     $EXTRACTED_COMMANDS"

        # Update version (increment patch)
        local MAJOR MINOR PATCH
        MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
        MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
        PATCH=$(echo "$CURRENT_VERSION" | cut -d. -f3)
        PATCH=$((PATCH + 1))
        local NEW_VERSION="$MAJOR.$MINOR.$PATCH"

        # Update timestamp
        local NEW_UPDATED_AT
        NEW_UPDATED_AT=$(date +%Y-%m-%d)

        # Write new .version file
        cat > "$VERSION_FILE" << EOF
VERSION=$NEW_VERSION
UPDATED_AT=$NEW_UPDATED_AT
COMMANDS=$CURRENT_COMMANDS
EOF

        # Optionally extract and update the "Finding Skills" section in SKILL.md
        # This is a simplified update - in production you might want more sophisticated merging
        echo "Updated $VERSION_FILE:"
        echo "  Version: $NEW_VERSION"
        echo "  Updated: $NEW_UPDATED_AT"
        echo "  Commands: $CURRENT_COMMANDS"
    else
        echo "No changes detected in find-skills commands"
    fi

    rm -rf "$TMP_REPO"
}

# Run the update check
update_skills_cli

cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

echo "=========================================="
echo "Building NanoClaw agent container image"
echo "=========================================="
echo "Architecture: $ARCH_NAME"
echo "Dockerfile:   $DOCKERFILE"
echo "Image:        ${IMAGE_NAME}:${TAG}"
echo ""

${CONTAINER_RUNTIME} build -f "$DOCKERFILE" -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "=========================================="
echo "Build complete!"
echo "=========================================="
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "Architecture: $ARCH_NAME"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
