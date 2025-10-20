const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const os = require('os');

function resolveCacheDir() {
  if (process.env.TRANSCODE_DIR) return process.env.TRANSCODE_DIR;
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'transcoded');
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      return path.join(base, 'Flake Wire', 'Transcoded');
    } else if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Caches', 'Flake Wire', 'Transcoded');
    } else {
      const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
      return path.join(base, 'flake-wire', 'transcoded');
    }
  } catch (_) {
    return path.join(process.cwd(), 'data', 'transcoded');
  }
}

class MKVTranscoder {
  constructor() {
    this.transcodingSessions = new Map();
    // Use a persistent cache directory under user profile
    this.outputDir = resolveCacheDir();
    this.forceTranscode = (process.env.FORCE_TRANSCODE === '1' || process.env.FORCE_TRANSCODE === 'true' || (process.versions && process.versions.electron && process.env.ELECTRON_TRANSCODE !== 'false'));

    // Try to use embedded static ffmpeg if available (better codec support in Electron)
    try {
      let ffmpegPath = require('ffmpeg-static');
      if (ffmpegPath) {
        // In asar, binaries must be loaded from the unpacked directory
        if (ffmpegPath.includes('app.asar')) {
          ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
        }
        ffmpeg.setFfmpegPath(ffmpegPath);
        console.log('MKV: Using embedded ffmpeg binary at', ffmpegPath);
      }
    } catch (e) {
      console.warn('MKV: ffmpeg-static not available, relying on system ffmpeg');
    }

    // Ensure output directory exists
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        console.log(`MKV: Created transcoding directory at ${this.outputDir}`);
      }
    } catch (error) {
      console.error(`MKV: Failed to create transcoding directory: ${error.message}`);
      // Fallback to /tmp directory
      this.outputDir = path.join('/tmp', 'transcoded');
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }
      console.log(`MKV: Using fallback transcoding directory at ${this.outputDir}`);
    }
  }

  async getRemuxedUrl(originalUrl, filename) {
    try {
      // Check if file is already remuxed
      const cacheKey = this.getCacheKey(originalUrl, filename);
      const cachedPath = path.join(this.outputDir, `${cacheKey}/output.mp4`);

      if (fs.existsSync(cachedPath)) {
        console.log(`MKV: Using cached remuxed file for ${filename}`);
        return `/api/remuxed/${cacheKey}/output.mp4`;
      }

      // Start remuxing if not already in progress
      if (!this.transcodingSessions.has(cacheKey)) {
        console.log(`MKV: Starting fast remuxing for ${filename}`);
        this.startRemuxing(originalUrl, filename, cacheKey);
      }

      // Return the remuxing URL (client will poll for availability)
      return `/api/remuxed/${cacheKey}/output.mp4`;
    } catch (error) {
      console.error('MKV remuxing error:', error);
      throw error;
    }
  }

  async getTranscodedUrl(originalUrl, filename) {
    // Keep old method for backward compatibility
    return this.getRemuxedUrl(originalUrl, filename);
  }

  getCacheKey(url, filename) {
    // Create a unique cache key based on URL hash
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(url + filename).digest('hex');
    return hash.substring(0, 16);
  }

  async startRemuxing(originalUrl, filename, cacheKey) {
    const outputPath = path.join(this.outputDir, cacheKey);

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const sessionId = cacheKey;
    this.transcodingSessions.set(sessionId, { status: 'remuxing', progress: 0 });

    try {
      console.log(`MKV: Fast remuxing ${filename} to MP4 format`);

      const outputMP4 = path.join(outputPath, 'output.mp4');
      const playlistPath = path.join(outputPath, 'playlist.m3u8');
      const segmentPath = path.join(outputPath, 'segment%03d.ts');

      const command = ffmpeg(originalUrl);
      if (this.forceTranscode) {
        console.log('MKV: Force transcoding to H.264/AAC (HLS) for maximum compatibility');
        command
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-preset veryfast',
            '-crf 23',
            '-pix_fmt yuv420p',
            '-f hls',
            '-hls_time 4',
            '-hls_playlist_type event',
            `-hls_segment_filename ${segmentPath}`
          ])
          .output(playlistPath);
      } else {
        command
          .outputOptions([
            '-c:v copy',              // Copy video stream (no re-encoding)
            '-c:a copy',              // Copy audio stream (no re-encoding)
            '-movflags +faststart',   // Optimize for streaming
            '-f mp4'                  // Output MP4 format
          ])
          .output(outputMP4);
      }

      // Update progress
      command.on('progress', (progress) => {
        const session = this.transcodingSessions.get(sessionId);
        if (session) {
          session.progress = Math.round(progress.percent || 0);
        }
      });

      command.on('end', () => {
        console.log(`MKV: ${this.forceTranscode ? 'Transcoding (HLS)' : 'Fast remuxing'} completed for ${filename}`);
        const session = this.transcodingSessions.get(sessionId);
        if (session) {
          session.status = this.forceTranscode ? 'transcoded' : 'completed';
          session.progress = 100;
          session.outputUrl = this.forceTranscode ? `/api/transcoded/${sessionId}/playlist.m3u8` : `/api/remuxed/${sessionId}/output.mp4`;
        }

        // Clean up session after 1 hour
        setTimeout(() => {
          this.transcodingSessions.delete(sessionId);
        }, 3600000);
      });

      command.on('error', (error) => {
        console.error(`MKV: Remuxing failed for ${filename}:`, error);
        const session = this.transcodingSessions.get(sessionId);
        if (session) {
          session.status = 'failed';
          session.error = error.message;
        }

        // Clean up failed session
        setTimeout(() => {
          this.transcodingSessions.delete(sessionId);
          // Remove partial files
          try {
            fs.rmSync(outputPath, { recursive: true, force: true });
          } catch (e) {
            console.error('Failed to clean up partial remuxing:', e);
          }
        }, 60000);
      });

      // Start remuxing (much faster than transcoding!)
      command.run();

    } catch (error) {
      console.error(`MKV: Failed to start remuxing for ${filename}:`, error);
      const session = this.transcodingSessions.get(sessionId);
      if (session) {
        session.status = 'failed';
        session.error = error.message;
      }
    }
  }

  getTranscodingStatus(cacheKey) {
    return this.transcodingSessions.get(cacheKey) || null;
  }

  async cleanup() {
    // Clean up old transcoded files (older than 24 hours)
    try {
      const files = fs.readdirSync(this.outputDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(this.outputDir, file);
        const stats = fs.statSync(filePath);

        // Remove files older than 24 hours
        if (now - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (error) {
      console.error('MKV: Cleanup error:', error);
    }
  }
}

module.exports = MKVTranscoder;
