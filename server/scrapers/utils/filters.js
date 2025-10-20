class ContentFilters {
    constructor() {
        this.qualityPatterns = {
            '4K': /2160p|4k|ultrahd|uhd/i,
            '1080p': /1080p|full.?hd|fhd/i,
            '720p': /720p|hd|hdtv/i,
            '480p': /480p|sd|dvd/i,
            'CAM': /cam|ts|telesync|hqcam|hdts/i,
            'SCR': /scr|screener|dvdscr|hdscr/i,
            'WEB': /webdl|webrip|web-dl|web-rip/i,
            'BluRay': /bluray|bdrip|brrip/i
        };

        this.undesirablePatterns = [
            /xxx|porn|adult/i,
            /sample|trailer/i,
            /password|rar/i,
            /subtitle|subtitles? only/i,
            /cam.?rip|ts.?rip/i
        ];

        this.languagePatterns = {
            'en': /english|eng|en/i,
            'es': /spanish|esp|es/i,
            'fr': /french|fra|fr/i,
            'de': /german|deu|de/i,
            'it': /italian|ita|it/i,
            'pt': /portuguese|por|pt/i,
            'ru': /russian|rus|ru/i
        };

        this.sizeUnits = {
            'GB': 1073741824,
            'MB': 1048576,
            'KB': 1024,
            'B': 1
        };
    }

    // Detect quality from release name
    detectQuality(releaseName) {
        for (const [quality, pattern] of Object.entries(this.qualityPatterns)) {
            if (pattern.test(releaseName)) {
                return quality;
            }
        }
        return 'Unknown';
    }

    // Check if release contains undesirable content
    hasUndesirableContent(releaseName) {
        return this.undesirablePatterns.some(pattern => pattern.test(releaseName));
    }

    // Detect language from release name
    detectLanguage(releaseName) {
        for (const [lang, pattern] of Object.entries(this.languagePatterns)) {
            if (pattern.test(releaseName)) {
                return lang;
            }
        }
        return 'en'; // Default to English
    }

    // Check if title matches the search query (with aliases)
    checkTitleMatch(searchTitle, releaseTitle, year = null, aliases = []) {
        const cleanSearchTitle = this.cleanTitle(searchTitle);
        const cleanReleaseTitle = this.cleanTitle(releaseTitle);

        // Direct match
        if (cleanReleaseTitle.includes(cleanSearchTitle) || cleanSearchTitle.includes(cleanReleaseTitle)) {
            return true;
        }

        // Check aliases
        for (const alias of aliases) {
            const cleanAlias = this.cleanTitle(alias.title);
            if (cleanReleaseTitle.includes(cleanAlias) || cleanAlias.includes(cleanReleaseTitle)) {
                return true;
            }
        }

        // Fuzzy matching (basic implementation)
        return this.fuzzyMatch(cleanSearchTitle, cleanReleaseTitle);
    }

    // Clean title for comparison (remove special characters, year, etc.)
    cleanTitle(title) {
        return title
            .toLowerCase()
            .replace(/\d{4}/g, '') // Remove years
            .replace(/[._-]/g, ' ') // Replace dots, underscores, hyphens with spaces
            .replace(/[^\w\s]/g, '') // Remove special characters except letters, numbers, spaces
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
    }

    // Basic fuzzy matching implementation
    fuzzyMatch(str1, str2, threshold = 0.7) {
        const words1 = str1.split(' ');
        const words2 = str2.split(' ');

        let matchCount = 0;
        for (const word1 of words1) {
            for (const word2 of words2) {
                if (word1 === word2 || word1.includes(word2) || word2.includes(word1)) {
                    matchCount++;
                    break;
                }
            }
        }

        const maxWords = Math.max(words1.length, words2.length);
        const matchRatio = matchCount / maxWords;

        return matchRatio >= threshold;
    }

    // Parse file size from string
    parseSize(sizeStr) {
        if (!sizeStr || typeof sizeStr !== 'string') {
            return 0;
        }

        const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*([KMGT]?B)/i);
        if (!match) {
            return 0;
        }

        const [, size, unit] = match;
        const multiplier = this.sizeUnits[unit.toUpperCase()] || 1;
        return Math.floor(parseFloat(size) * multiplier);
    }

    // Format file size for display
    formatSize(bytes) {
        if (bytes === 0) return 'Unknown';

        const units = ['B', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    // Check if quality meets minimum standards
    meetsQualityStandards(quality, minQuality = '480p') {
        const qualityHierarchy = ['CAM', 'SCR', '480p', '720p', '1080p', '4K'];
        const qualityIndex = qualityHierarchy.indexOf(quality);
        const minQualityIndex = qualityHierarchy.indexOf(minQuality);

        if (qualityIndex === -1) return false; // Unknown quality
        return qualityIndex >= minQualityIndex;
    }

    // Filter results based on various criteria
    filterResults(results, filters = {}) {
        console.log(`DEBUG: Filtering ${results.length} results with filters:`, filters);

        const filtered = results.filter((result, index) => {
            // Quality filter
            if (filters.quality && !this.meetsQualityStandards(result.quality, filters.quality)) {
                console.log(`DEBUG: Filtered result ${index} - Quality: ${result.quality} (min: ${filters.quality})`);
                return false;
            }

            // Minimum seeders filter
            if (filters.minSeeders && (result.seeders || 0) < filters.minSeeders) {
                console.log(`DEBUG: Filtered result ${index} - Seeders: ${result.seeders} (min: ${filters.minSeeders})`);
                return false;
            }

            // Maximum size filter
            if (filters.maxSize && result.size > filters.maxSize) {
                console.log(`DEBUG: Filtered result ${index} - Size: ${result.size} (max: ${filters.maxSize})`);
                return false;
            }

            // Language filter
            if (filters.language && result.language !== filters.language) {
                console.log(`DEBUG: Filtered result ${index} - Language: ${result.language} (wanted: ${filters.language})`);
                return false;
            }

            // Exclude undesirable content
            if (this.hasUndesirableContent(result.name || result.title)) {
                console.log(`DEBUG: Filtered result ${index} - Undesirable content: ${result.name || result.title}`);
                return false;
            }

            return true;
        });

        console.log(`DEBUG: Filtered ${results.length} -> ${filtered.length} results`);
        return filtered;
    }

    // Sort results by quality and seeders
    sortResults(results) {
        const qualityScore = {
            '4K': 100,
            '1080p': 80,
            '720p': 60,
            '480p': 40,
            'BluRay': 90,
            'WEB': 70,
            'SCR': 20,
            'CAM': 10,
            'Unknown': 0
        };

        return results.sort((a, b) => {
            // Primary sort by quality
            const qualityDiff = (qualityScore[b.quality] || 0) - (qualityScore[a.quality] || 0);
            if (qualityDiff !== 0) return qualityDiff;

            // Secondary sort by seeders
            const seedersDiff = (b.seeders || 0) - (a.seeders || 0);
            if (seedersDiff !== 0) return seedersDiff;

            // Tertiary sort by size (prefer reasonable sizes)
            const sizeA = a.size || 0;
            const sizeB = b.size || 0;
            const reasonableMin = 1073741824; // 1GB
            const reasonableMax = 8589934592; // 8GB

            const aReasonable = sizeA >= reasonableMin && sizeA <= reasonableMax;
            const bReasonable = sizeB >= reasonableMin && sizeB <= reasonableMax;

            if (aReasonable && !bReasonable) return -1;
            if (!aReasonable && bReasonable) return 1;

            return 0;
        });
    }
}

module.exports = ContentFilters;