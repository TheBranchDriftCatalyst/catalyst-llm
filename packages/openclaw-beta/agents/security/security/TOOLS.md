# SecurityAgent — Tool Access

## MCP Servers

| MCP | Access | Purpose |
|-----|--------|---------|
| `beads` | R | Read beads for security scan tasks |
| `filesystem` | R | Read source code, dependency manifests, configs |
| `time` | R | Timestamps for scan reports |
| `github` | R | Read PRs for security review, check dependency alerts |
| `fetch` | R | Query CVE databases, security advisories (sandboxed) |

## Security Scanning Workflow
1. Read bead for scan task details
2. Read source code and dependency manifests
3. Check for OWASP Top 10 vulnerabilities:
   - Injection (SQL, command, prompt)
   - Broken authentication
   - Sensitive data exposure
   - XXE, broken access control
   - Security misconfiguration
   - XSS, insecure deserialization
   - Known vulnerable components
   - Insufficient logging
4. Check dependencies against CVE databases via `fetch`
5. Write scan report to `security/scans/`
6. Update bead Security Gate fields

## Authorized File Paths (Write)
- `security/scans/**` — Scan result reports
- `agents/security/security/memory/` — Agent memory (scan history, patterns)

## Restricted
- **Read-only access to all application code** — cannot modify
- No shell access
- No infrastructure access
- `fetch` limited to security advisory domains (NVD, GitHub Advisory, Snyk)
- Cannot approve or merge PRs
