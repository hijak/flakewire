# GitHub Secrets Configuration

This document describes the GitHub secrets that need to be configured for the CI/CD workflows to build and release the Flake Wire Electron app.

## Required Secrets

Navigate to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

### 1. TRAKT_CLIENT_ID
- **Required:** Yes
- **Purpose:** Trakt API client ID for OAuth authentication
- **How to obtain:**
  1. Go to https://trakt.tv/oauth/applications
  2. Sign in or create a Trakt account
  3. Click "New Application"
  4. Fill in the application details:
     - Name: Flake Wire
     - Description: Media streaming application
     - Redirect URI: `http://127.0.0.1:3001/auth/callback`
  5. Copy the "Client ID" value

### 2. TRAKT_CLIENT_SECRET
- **Required:** Yes
- **Purpose:** Trakt API client secret for OAuth authentication
- **How to obtain:**
  1. From the same Trakt application page as above
  2. Copy the "Client Secret" value

**Important:** Keep this secret secure and never commit it to the repository.

### 3. GITHUB_TOKEN
- **Required:** Automatically provided
- **Purpose:** Used for creating GitHub releases
- **How to obtain:** This is automatically provided by GitHub Actions - you don't need to create this secret manually.

## Setting Up Secrets

To add these secrets to your repository:

1. Go to your GitHub repository
2. Click on "Settings" (you need admin access)
3. In the left sidebar, click "Secrets and variables" → "Actions"
4. Click "New repository secret"
5. Enter the name exactly as shown above (e.g., `TRAKT_CLIENT_ID`)
6. Paste the corresponding value
7. Click "Add secret"
8. Repeat for all required secrets

## Testing Secrets

After adding the secrets, you can test them by:

1. Pushing a commit to the `main` or `develop` branch
2. The workflow will run and create a `.env` file with your secrets
3. Check the workflow logs (but note that secret values are masked in logs)
4. The built Electron app will include these credentials embedded in the `.env` file

## Security Notes

- Never commit actual secret values to the repository
- The `.env` file is in `.gitignore` to prevent accidental commits
- GitHub Actions masks secret values in logs automatically
- The secrets are only embedded in the built Electron app, not in the source code
- Users downloading the built app will have these credentials pre-configured

## Optional Secrets

The following environment variables from `.env.example` are NOT required as GitHub secrets because they are configured by users through the app's onboarding flow or have suitable defaults:

- **TMDB_API_KEY**: Users can configure their own TMDB API key through the app if needed
- **OMDB_API_KEY**: Has a default public key (`be62d2ad`)
- **FANARTTV_API_KEY**: Optional - only needed if you want enhanced artwork
- **Debrid API Keys** (REAL_DEBRID_API_KEY, PREMIUMIZE_API_KEY, ALLDEBRID_API_KEY): Configured by users through the app's onboarding flow

If you want to include any of these as defaults in the built app, you can add them as GitHub secrets using the same process.
