const express = require('express');
const router = express.Router();
const axios = require('axios');
const SecureStorage = require('../services/secureStorage');
const OAuthService = require('../services/oauthService');

let secureStorage = new SecureStorage();
let oauthService = new OAuthService();
function setSecureStorage(storage) { secureStorage = storage; }

// Get user ID from JWT or use default
const getUserId = (req) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return 'default';
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development';
    const user = jwt.verify(token, JWT_SECRET);
    return user?.id || 'default';
  } catch (e) {
    return 'default';
  }
};

// Get a valid Trakt access token. Prefer current user scope; fall back to 'default'.
const getValidTraktAccessToken = async (userId) => {
  try {
    const scopes = [];
    if (userId) scopes.push(userId);
    scopes.push('default');
    for (const scope of scopes) {
      const td = await secureStorage.getOAuthToken(scope, 'trakt');
      if (!td || !td.token) continue;
      let token = td.token;
      let expired = false;
      try { expired = token.expires_at ? (new Date(token.expires_at) <= new Date()) : false; } catch { expired = false; }
      if (expired && token.refresh_token) {
        try {
          const newTok = await oauthService.refreshTraktToken(token.refresh_token);
          await secureStorage.storeOAuthToken(scope, 'trakt', newTok);
          token = newTok;
          expired = false;
        } catch (e) {
          console.warn('Trakt token refresh failed for scope', scope, e.message || e);
        }
      }
      if (!expired && token.access_token) return token.access_token;
    }
    return null;
  } catch (error) {
    console.error('Error getting Trakt token:', error);
    return null;
  }
};

// Get TV show schedule for a specific month/year
router.get('/schedule/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    const userId = getUserId(req);
    const traktToken = await getValidTraktAccessToken(userId);

    // Validate year and month
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);

    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }

    // Calculate start and end dates for the month
    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0); // Last day of month

    // Format dates for Trakt API (YYYY-MM-DD)
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Prepare container
    const episodesByDate = {};

    if (traktToken) {
      try {
        // Use Trakt calendar for user's shows
        const msPerDay = 24 * 60 * 60 * 1000;
        const days = Math.max(1, Math.min(31, Math.ceil((endDate.getTime() - startDate.getTime()) / msPerDay) + 1));
        const showsCal = await axios.get(
          `https://api.trakt.tv/calendars/my/shows/${startDateStr}/${days}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'trakt-api-version': '2',
              'trakt-api-key': process.env.TRAKT_CLIENT_ID,
              'Authorization': `Bearer ${traktToken}`
            }
          }
        );
        const list = Array.isArray(showsCal.data) ? showsCal.data : [];
        for (const item of list) {
          const aired = item?.first_aired || item?.episode?.first_aired || null;
          if (!aired) continue;
          const d = String(aired).split('T')[0];
          if (!episodesByDate[d]) episodesByDate[d] = [];
          episodesByDate[d].push({
            ...(item.episode || {}),
            first_aired: aired,
            show: item.show || {},
            type: 'episode'
          });
        }
      } catch (e) {
        console.warn('Trakt shows calendar error:', e?.response?.status || e?.message || e);
      }
    }

    // Get movies scheduled for release in this month
    try {
      const moviesResponse = await axios.get(
        `https://api.trakt.tv/calendars/all/movies/${startDateStr}/${endDateStr}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': process.env.TRAKT_CLIENT_ID,
            ...(traktToken ? { 'Authorization': `Bearer ${traktToken}` } : {})
          }
        }
      );

      if (moviesResponse.data) {
        moviesResponse.data.forEach(movie => {
          const movieDate = movie.released.split('T')[0];
          if (!episodesByDate[movieDate]) {
            episodesByDate[movieDate] = [];
          }
          episodesByDate[movieDate].push({
            ...movie,
            type: 'movie'
          });
        });
      }
    } catch (error) {
      console.warn('Error fetching movies:', error.message);
    }

    // Sort episodes and movies by time
    Object.keys(episodesByDate).forEach(date => {
      episodesByDate[date].sort((a, b) => {
        const timeA = a.first_aired || a.released || '';
        const timeB = b.first_aired || b.released || '';
        return timeA.localeCompare(timeB);
      });
    });

    res.json({
      year: yearNum,
      month: monthNum,
      startDate: startDateStr,
      endDate: endDateStr,
      episodesByDate
    });

  } catch (error) {
    console.error('Calendar schedule error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Get today's schedule
router.get('/today', async (req, res) => {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    // Redirect to the specific month endpoint
    res.redirect(`/api/calendar/schedule/${year}/${month}`);
  } catch (error) {
    console.error('Today schedule error:', error);
    res.status(500).json({ error: 'Failed to fetch today\'s schedule' });
  }
});

module.exports = { router, setSecureStorage };
