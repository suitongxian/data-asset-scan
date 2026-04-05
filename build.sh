#!/bin/bash
# Electron build script for Mac/Linux
# Usage: ./build.sh [mac|linux|win|all]

set -e
cd "$(dirname "$0")"

PLATFORM="${1:-current}"

# Check dependencies
command -v node >/dev/null 2>&1 || { echo "Node.js not found"; exit 1; }
command -v yarn >/dev/null 2>&1 || { echo "yarn not found"; exit 1; }

echo "Installing dependencies..."
yarn install

echo "Building app..."
yarn vue-tsc
yarn vite build

echo "Packaging for: $PLATFORM"
case $PLATFORM in
    mac)     yarn electron-builder --mac ;;
    linux)   yarn electron-builder --linux ;;
    win)     yarn electron-builder --win ;;
    all)     yarn electron-builder --mac --linux --win ;;
    current) yarn electron-builder ;;
    *)       echo "Unknown platform: $PLATFORM"; exit 1 ;;
esac

echo "Build complete! Output: release/"
