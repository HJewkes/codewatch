---
"@codewatch/cli": patch
---

Guard the `graph mcp --http` server against DNS rebinding: refuse a non-loopback Host or a foreign Origin with 403, and require a bearer token from a 0600 token file the server writes at start (`~/.codewatch/mcp-http-<port>.token`).
