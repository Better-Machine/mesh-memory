# Privacy Checklist — mesh-memory

**Version:** 1.0.0  
**Purpose:** Pre-commit verification for privacy-sensitive data

---

## Checklist

Run before every commit:

- [ ] No LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x) in committed code
- [ ] No API keys (sk-*, Bearer tokens, etc.) in committed code
- [ ] No absolute home paths (/home/, /Users/) in committed code
- [ ] No passwords or secrets in logs or error messages
- [ ] Local config files (.local.json) are gitignored
- [ ] Test data uses mock IPs, not real infrastructure

---

## Commands

```bash
# Quick scan
cd /home/erik-ross/.openclaw/workspace/projects/mesh-memory

# Check for LAN IPs
echo "=== LAN IPs ==="
rg "192\.168\." src/ palace-mvp/ 2>/dev/null || echo "✓ Clean"

# Check for API keys
echo "=== API Keys ==="
rg -i "sk-[a-zA-Z0-9]{20,}" src/ palace-mvp/ 2>/dev/null || echo "✓ Clean"

# Check for hardcoded tokens
echo "=== Hardcoded Tokens ==="
rg -i "token.*['\"][a-f0-9]{20,}" src/ palace-mvp/ 2>/dev/null || echo "✓ Clean"

# Check for absolute paths
echo "=== Absolute Paths ==="
rg "/home/" src/ palace-mvp/ 2>/dev/null || echo "✓ Clean"

# Verify gitignore
echo "=== Gitignore Check ==="
grep "\.local\.json" .gitignore && echo "✓ .local.json gitignored" || echo "✗ WARNING"
```

---

## Allowed Exceptions

| Pattern | Location | Reason |
|---------|----------|--------|
| `192.168.x.x` | `*.schema.json` examples | Documentation placeholder (marked as example) |
| `replace-with-your-token` | Default values | Clear placeholder text |
| `process.env.*` | Code | Environment variable access is OK |

---

## Sanitization Rules

When logging objects that may contain sensitive data:

```javascript
const SENSITIVE_KEYS = /token|password|secret|key|authorization|credential/i;

function sanitizeForLogging(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
```

---

## Incident Response

If privacy violation detected:

1. **Stop** — Do not commit
2. **Identify** — Which files contain sensitive data
3. **Remove** — Strip sensitive data, use placeholders
4. **Verify** — Re-run checklist
5. **Document** — Note in commit message if fixing previous exposure
