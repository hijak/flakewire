#!/usr/bin/env node

/**
 * Flake Wire Electron Build Script (Node.js version)
 * Cross-platform build script for the Electron application
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Build configuration
const BUILD_DIR = 'dist';
const CLIENT_BUILD_DIR = 'client/dist';
const CLIENT_BUILD_FALLBACK = 'client/build';

// Utility functions
function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function logInfo(message) {
    log(`[INFO] ${message}`, colors.green);
}

function logWarning(message) {
    log(`[WARN] ${message}`, colors.yellow);
}

function logError(message) {
    log(`[ERROR] ${message}`, colors.red);
}

function logStep(message) {
    log(`🔄 ${message}`, colors.blue);
}

function logSuccess(message) {
    log(`✅ ${message}`, colors.green);
}

function commandExists(command) {
    try {
        require('child_process').execSync(`which ${command}`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function execCommand(command, cwd = process.cwd(), options = {}) {
    try {
        logInfo(`Running: ${command}`);
        const result = execSync(command, {
            cwd,
            stdio: 'inherit',
            ...options
        });
        return result;
    } catch (error) {
        logError(`Command failed: ${command}`);
        throw error;
    }
}

function checkPrerequisites() {
    logStep('Checking prerequisites...');

    // Check Node.js and npm
    if (!commandExists('node')) {
        logError('Node.js is not installed. Please install Node.js first.');
        process.exit(1);
    }

    if (!commandExists('npm')) {
        logError('npm is not installed. Please install npm first.');
        process.exit(1);
    }

    // Check required directories
    const requiredDirs = ['server', 'client', 'electron'];
    for (const dir of requiredDirs) {
        if (!fs.existsSync(dir)) {
            logError(`Required directory not found: ${dir}`);
            process.exit(1);
        }
    }

    logSuccess('Prerequisites check passed');
}

function installDependencies() {
    logStep('Installing dependencies...');

    // Install root dependencies
    execCommand('npm install');

    // Install server dependencies
    execCommand('npm install', path.join(process.cwd(), 'server'));

    // Install client dependencies
    execCommand('npm install', path.join(process.cwd(), 'client'));

    // Check ffmpeg-static
    const ffmpegStaticPath = path.join('server', 'node_modules', 'ffmpeg-static');
    if (!fs.existsSync(ffmpegStaticPath)) {
        logWarning('ffmpeg-static not found. Installing now...');
        execCommand('npm install ffmpeg-static', path.join(process.cwd(), 'server'));
    }

    logSuccess('Dependencies installed');
}

function cleanBuilds() {
    logStep('Cleaning previous builds...');

    const dirsToClean = [BUILD_DIR, CLIENT_BUILD_DIR, CLIENT_BUILD_FALLBACK];
    for (const dir of dirsToClean) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    logSuccess('Previous builds cleaned');
}

function buildClient() {
    logStep('Building the new client interface...');

    const clientDir = path.join(process.cwd(), 'client');
    execCommand('npm run build', clientDir);

    const distPath = path.join(clientDir, 'dist');
    if (!fs.existsSync(distPath)) {
        logError('Client build failed! No dist directory created.');
        process.exit(1);
    }

    logSuccess('Client build completed');
}

function prepareServer() {
    logStep('Preparing server files...');
    // Server files are already in JavaScript format
    logSuccess('Server preparation completed');
}

function buildElectron() {
    logStep('Building Electron application...');

    // Set environment variables
    process.env.NODE_ENV = 'production';
    process.env.ELECTRON_TRANSCODE = 'true';

    // Determine platform
    const platform = process.platform;
    let buildCommand = 'npm run electron:pack';

    switch (platform) {
        case 'linux':
            logInfo('Building for Linux...');
            buildCommand = 'npx electron-builder --linux';
            break;
        case 'darwin':
            logInfo('Building for macOS...');
            buildCommand = 'npx electron-builder --mac';
            break;
        case 'win32':
            logInfo('Building for Windows...');
            buildCommand = 'npx electron-builder --win';
            break;
        default:
            logWarning(`Unknown platform: ${platform}. Building for all platforms...`);
            buildCommand = 'npm run electron:pack';
    }

    try {
        execCommand(buildCommand);
    } catch (error) {
        logError('Electron build failed');
        throw error;
    }

    // Check if build was successful
    if (!fs.existsSync(BUILD_DIR)) {
        logError('Electron build failed! No dist directory created.');
        process.exit(1);
    }

    logSuccess('Electron build completed');
}

function showResults() {
    logStep('Build completed successfully! 🎉');

    console.log('\n' + colors.green + 'Build artifacts:' + colors.reset);

    if (fs.existsSync(BUILD_DIR)) {
        const files = fs.readdirSync(BUILD_DIR);
        files.forEach(file => {
            const filePath = path.join(BUILD_DIR, file);
            const stats = fs.statSync(filePath);
            const size = stats.isFile() ? ` (${(stats.size / 1024 / 1024).toFixed(2)} MB)` : '';
            console.log(`  ${file}${size}`);
        });
    }

    console.log('\n' + colors.blue + '🚀 To run the Electron application:' + colors.reset);
    console.log('\nDevelopment mode:');
    console.log('  npm run electron:dev');
    console.log('\nProduction mode (from built package):');

    const platform = process.platform;
    switch (platform) {
        case 'linux':
            console.log(`  ./${BUILD_DIR}/Flake-Wire.AppImage`);
            console.log(`  # or: dpkg -i ${BUILD_DIR}/flake-wire_*.deb`);
            break;
        case 'darwin':
            console.log(`  open ${BUILD_DIR}/Flake-Wire.dmg`);
            break;
        case 'win32':
            console.log(`  ${BUILD_DIR}/Flake-Wire-Setup.exe`);
            break;
        default:
            console.log(`  Check the ${BUILD_DIR} directory for your platform's installer`);
    }

    console.log('\n' + colors.green + '✅ Electron build process completed successfully!' + colors.reset);
    console.log('\n' + colors.yellow + 'Notes:' + colors.reset);
    console.log('- The application includes an embedded ffmpeg for MKV support');
    console.log('- MKV files will be automatically processed for compatibility');
    console.log('- The built application includes both server and client components');
    console.log('- No external server setup required for the built application');
}

// Main build process
async function main() {
    try {
        console.log(colors.blue + '🎬 Flake Wire Electron Build Script' + colors.reset);
        console.log('==================================');

        checkPrerequisites();
        cleanBuilds();
        installDependencies();
        buildClient();
        prepareServer();
        buildElectron();
        showResults();

    } catch (error) {
        logError(`Build failed: ${error.message}`);
        process.exit(1);
    }
}

// Handle process interruption
process.on('SIGINT', () => {
    logWarning('\nBuild process interrupted by user');
    process.exit(1);
});

process.on('SIGTERM', () => {
    logWarning('\nBuild process terminated');
    process.exit(1);
});

// Run the build
if (require.main === module) {
    main();
}

module.exports = { main };
