#!/bin/bash

# Flake Wire Electron Build Script
# This script builds the complete Electron application for distribution

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Build configuration
BUILD_DIR="dist"
CLIENT_BUILD_DIR="client/dist"
CLIENT_BUILD_FALLBACK="client/build"

echo -e "${BLUE}🎬 Flake Wire Electron Build Script${NC}"
echo "=================================="

# Function to print status messages
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Pre-build checks
print_status "Starting pre-build checks..."

# Check Node.js and npm
if ! command_exists node; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

if ! command_exists npm; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

# Check if required directories exist
if [ ! -d "server" ]; then
    print_error "Server directory not found!"
    exit 1
fi

if [ ! -d "client" ]; then
    print_error "New client interface directory not found!"
    exit 1
fi

if [ ! -d "electron" ]; then
    print_error "Electron directory not found!"
    exit 1
fi

# Check if ffmpeg-static is installed in server
if [ ! -d "server/node_modules/ffmpeg-static" ]; then
    print_warning "ffmpeg-static not found. Installing now..."
    cd server && npm install ffmpeg-static && cd ..
fi

# Clean previous builds
print_status "Cleaning previous builds..."
rm -rf "$BUILD_DIR"
rm -rf "$CLIENT_BUILD_DIR"
rm -rf "$CLIENT_BUILD_FALLBACK"

# Install dependencies
print_status "Installing dependencies..."
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

# Build the new client interface
print_status "Building the new client interface..."
cd client
npm run build

if [ ! -d "dist" ]; then
    print_error "Client build failed! No dist directory created."
    exit 1
fi

print_status "Client build completed successfully!"
cd ..

# Build server (transpile if needed)
print_status "Preparing server files..."
# Server files are already in JavaScript format, no transpilation needed

# Create Electron build configuration
print_status "Preparing Electron build..."

# Set environment variables for build
export NODE_ENV=production
export ELECTRON_TRANSCODE=true

# Determine platform
PLATFORM=$(uname -s)
case $PLATFORM in
    Linux*)
        TARGET_PLATFORM="linux"
        print_status "Building for Linux..."
        ;;
    Darwin*)
        TARGET_PLATFORM="mac"
        print_status "Building for macOS..."
        ;;
    CYGWIN*|MINGW*|MSYS*)
        TARGET_PLATFORM="win"
        print_status "Building for Windows..."
        ;;
    *)
        print_warning "Unknown platform: $PLATFORM. Building for all platforms..."
        TARGET_PLATFORM="all"
        ;;
esac

# Build Electron app
print_status "Building Electron application..."

if [ "$TARGET_PLATFORM" = "all" ]; then
    npm run electron:pack
elif [ "$TARGET_PLATFORM" = "linux" ]; then
    npx electron-builder --linux
elif [ "$TARGET_PLATFORM" = "mac" ]; then
    npx electron-builder --mac
elif [ "$TARGET_PLATFORM" = "win" ]; then
    npx electron-builder --win
else
    npm run electron:pack
fi

# Check if build was successful
if [ ! -d "$BUILD_DIR" ]; then
    print_error "Electron build failed! No dist directory created."
    exit 1
fi

# List build artifacts
print_status "Build completed successfully! 🎉"
echo ""
echo -e "${GREEN}Build artifacts:${NC}"
ls -la "$BUILD_DIR"/

# Get the size of build artifacts
if command_exists du; then
    echo ""
    print_status "Build sizes:"
    du -h "$BUILD_DIR"/* 2>/dev/null || true
fi

# Instructions for running
echo ""
echo -e "${BLUE}🚀 To run the Electron application:${NC}"
echo ""
echo "Development mode:"
echo "  npm run electron:dev"
echo ""
echo "Production mode (from built package):"

case $PLATFORM in
    Linux*)
        echo "  ./$BUILD_DIR/Flake-Wire.AppImage"
        echo "  # or: dpkg -i $BUILD_DIR/flake-wire_*.deb"
        ;;
    Darwin*)
        echo "  open $BUILD_DIR/Flake-Wire.dmg"
        ;;
    CYGWIN*|MINGW*|MSYS*)
        echo "  $BUILD_DIR/Flake-Wire-Setup.exe"
        ;;
    *)
        echo "  Check the $BUILD_DIR directory for your platform's installer"
        ;;
esac

echo ""
echo -e "${GREEN}✅ Electron build process completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Notes:${NC}"
echo "- The application includes an embedded ffmpeg for MKV support"
echo "- MKV files will be automatically processed for compatibility"
echo "- The built application includes both server and client components"
echo "- No external server setup required for the built application"
