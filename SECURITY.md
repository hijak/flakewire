# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public issue disclosing the vulnerability
2. **DO email** security concerns to: security@flakewire.app
3. **Provide** details about:
   - The affected components
   - Potential impact
   - Steps to reproduce (if applicable)
   - Any suggested mitigations

## Secure Development Practices

This project follows these security practices:

### API Key Management

- ✅ **No hardcoded API keys** in production code
- ✅ **User-specific storage** via encrypted secure storage
- ✅ **Environment variable fallbacks** for development
- ✅ **No sensitive data** in client-side code

### Authentication & Authorization

- ✅ **JWT-based authentication** with secure secrets
- ✅ **OAuth integration** with token validation
- ✅ **Session management** with secure cookie handling

### Data Protection

- ✅ **Encrypted storage** for API keys and tokens
- ✅ **No sensitive data** in configuration files
- ✅ **Environment variable isolation** via .gitignore

### Deployment Security

- ✅ **No credentials** in Docker images or builds
- ✅ **Secure artifact handling** in CI/CD pipelines
- ✅ **Version-based releases** with proper changelog

## Current Security Status

This repository has undergone security review and remediation:

- **Fixed**: Hardcoded API keys removed
- **Implemented**: Dynamic API key retrieval from user storage
- **Enhanced**: Build and deployment security

For security questions, please contact: security@flakewire.app