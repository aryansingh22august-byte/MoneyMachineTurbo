# Security Policy

## Supported Versions

We release security updates for the following versions:

| Version | Supported |
|---------|-----------|
| 1.x.x   | ✅ Yes    |
| < 1.0   | ❌ No     |

> **Always upgrade to the latest patch version** for security fixes.

## Reporting a Vulnerability

**Do not report security vulnerabilities via public GitHub issues.**

Instead, please email **security@aryansingh22august.com** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will:
1. Acknowledge receipt within 48 hours
2. Provide a timeline for fix
3. Credit you in the security advisory (unless you prefer anonymity)

## Disclosure Policy

- We follow **coordinated disclosure**
- Vulnerabilities are patched before public disclosure
- Security advisories published on GitHub Security Advisories
- CVE requested for significant issues

## Security Best Practices for Users

### Environment Variables
- **Never commit `.env` files** — they're in `.gitignore`
- Use strong secrets: `openssl rand -hex 32` for JWT_SECRET, SESSION_SECRET
- Rotate API keys periodically
- Use separate keys for dev/staging/production

### Deployment
- Enable **HTTPS only** in production
- Use **private networks** for inter-service communication (ML API, DB)
- Enable **secret scanning** on your fork
- Review **Dependabot alerts** weekly

### Authentication
- Site-wide access gate (ACCESS_PASSWORD) is **mandatory in production**
- OAuth sessions use HS256 with 32+ char secrets
- Upstox tokens expire daily — re-auth required

### Database
- PostgreSQL with parameterized queries (Drizzle ORM) — SQL injection resistant
- No raw SQL in application code
- Migrations reviewed before deploy

## Known Security Considerations

| Area | Risk | Mitigation |
|------|------|------------|
| Upstox WebSocket | Token in memory | Daily expiry, auto-clear on expiry |
| ML Service | Model deserialization | Only loads from trusted volume |
| WebSocket Server | Unauthenticated connections | Same-origin policy, rate limiting |
| Paper Trading | Virtual funds only | No real money at risk |

## Security Updates

Subscribe to:
- [GitHub Security Advisories](https://github.com/aryansingh22august-byte/MoneyMachineTurbo/security/advisories)
- [Releases](https://github.com/aryansingh22august-byte/MoneyMachineTurbo/releases) — security patches tagged

---

**Contact**: security@aryansingh22august.com