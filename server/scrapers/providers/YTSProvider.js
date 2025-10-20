const BaseProvider = require('./BaseProvider');

class YTSProvider extends BaseProvider {
    constructor() {
        super('YTS', {
            baseURL: 'https://yts.mx',
            priority: 2,
            supportsMovies: true,
            supportsTV: false,
            minRequestInterval: 2000 // 2 seconds between requests
        });

        this.apiURL = 'https://yts.mx/api/v2';
    }

    async search(data) {
        try {
            const { title, year, imdb } = data;

            // YTS works best with IMDB ID
            let searchURL = `${this.apiURL}/list_movies.json`;
            const params = new URLSearchParams();

            if (imdb) {
                const imdbID = this.extractIMDBID(imdb);
                if (imdbID) {
                    params.append('query_term', imdbID);
                } else {
                    params.append('query_term', title);
                }
            } else {
                params.append('query_term', this.cleanSearchQuery(title, year));
            }

            // Add quality filter if specified
            if (data.quality) {
                const qualityMap = {
                    '720p': '720p',
                    '1080p': '1080p',
                    '4K': '2160p'
                };
                if (qualityMap[data.quality]) {
                    params.append('quality', qualityMap[data.quality]);
                }
            }

            // Sort by seeds for better results
            params.append('sort_by', 'seeds');
            params.append('order_by', 'desc');
            params.append('limit', '50');

            searchURL += `?${params.toString()}`;

            const response = await this.client.get(searchURL, {
                timeout: 15000,
                headers: {
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            const responseData = response.data;

            if (responseData.status !== 'ok') {
                console.error('YTS API error:', responseData.status_message);
                return [];
            }

            const movies = responseData.data?.movies || [];
            return this.processResults(movies, data);

        } catch (error) {
            console.error('YTS search error:', error.message);
            return [];
        }
    }

    processResults(movies, searchData) {
        const results = [];

        for (const movie of movies) {
            // Skip if movie doesn't match our search criteria
            if (!this.isMovieMatch(movie, searchData)) {
                continue;
            }

            // Process each torrent for this movie
            if (movie.torrents && Array.isArray(movie.torrents)) {
                for (const torrent of movie.torrents) {
                    const result = this.createResult({
                        name: `${movie.title_long}.${torrent.quality}.${torrent.type}`,
                        title: movie.title,
                        year: movie.year,
                        imdb: movie.imdb_code,
                        quality: this.normalizeQuality(torrent.quality),
                        size: this.filters.parseSize(torrent.size),
                        sizeStr: torrent.size,
                        seeders: torrent.seeds,
                        leechers: torrent.peers,
                        hash: torrent.hash,
                        url: `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title_long)}`,
                        magnet: `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title_long)}`,
                        type: 'movie',
                        language: 'en', // YTS content is primarily English
                        verified: true, // YTS torrents are generally verified
                        uploadedAt: movie.date_uploaded,
                        rating: movie.rating,
                        runtime: movie.runtime,
                        genres: movie.genres,
                        summary: movie.summary
                    });

                    // Apply minimum seeders filter
                    if (result.seeders >= this.minSeeders) {
                        results.push(result);
                    }
                }
            }
        }

        return results;
    }

    isMovieMatch(movie, searchData) {
        // Check if year matches (if specified)
        if (searchData.year && movie.year !== parseInt(searchData.year)) {
            return false;
        }

        // Check if IMDB matches (if specified)
        if (searchData.imdb && movie.imdb_code) {
            const searchIMDB = this.extractIMDBID(searchData.imdb);
            if (searchIMDB && searchIMDB !== movie.imdb_code) {
                return false;
            }
        }

        // Check title match
        if (!this.filters.checkTitleMatch(
            searchData.title,
            movie.title,
            searchData.year,
            searchData.aliases || []
        )) {
            return false;
        }

        return true;
    }

    normalizeQuality(quality) {
        const qualityMap = {
            '720p': '720p',
            '1080p': '1080p',
            '2160p': '4K',
            '3D': '1080p' // Treat 3D as 1080p for our purposes
        };

        return qualityMap[quality] || quality;
    }

    // YTS-specific method to get movie details by IMDB
    async getMovieDetails(imdb) {
        try {
            const imdbID = this.extractIMDBID(imdb);
            if (!imdbID) {
                throw new Error('Invalid IMDB ID format');
            }

            const url = `${this.apiURL}/movie_details.json?imdb_id=${imdbID}`;
            const response = await this.client.get(url);

            if (response.data.status !== 'ok') {
                throw new Error('Movie not found');
            }

            return response.data.data.movie;
        } catch (error) {
            console.error('YTS movie details error:', error.message);
            throw error;
        }
    }

    // YTS-specific method to get movie suggestions
    async getMovieSuggestions(imdb) {
        try {
            const imdbID = this.extractIMDBID(imdb);
            if (!imdbID) {
                throw new Error('Invalid IMDB ID format');
            }

            const url = `${this.apiURL}/movie_suggestions.json?imdb_id=${imdbID}`;
            const response = await this.client.get(url);

            if (response.data.status !== 'ok') {
                return [];
            }

            return response.data.data.movies || [];
        } catch (error) {
            console.error('YTS suggestions error:', error.message);
            return [];
        }
    }

    // Override availability check for YTS
    async isAvailable() {
        try {
            const response = await this.client.get(`${this.apiURL}/list_movies.json?limit=1`, {
                timeout: 10000
            });
            return response.data?.status === 'ok';
        } catch (error) {
            console.error('YTS availability check failed:', error.message);
            return false;
        }
    }
}

module.exports = YTSProvider;