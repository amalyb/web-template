# Suggested Commit Message

```
fix(server): prevent code-split chunks from being served as text/html

Fixes production error: "Refused to execute script because its MIME type 
('text/html') is not executable"

Changes:
- Add explicit /static route handler BEFORE SSR catch-all
- Set fallthrough: false to prevent 404s from reaching SSR
- Enforce Content-Type headers for .js/.css/.json files
- Add long-lived cache headers for /static/** assets (immutable, 1y)
- Add no-cache headers for manifest files
- Create smoke test script to verify chunk integrity

This ensures:
1. Code-split chunks are NEVER rewritten to index.html
2. Missing chunks return proper 404 (not HTML)
3. All JavaScript files serve with application/javascript MIME type
4. Proper cache headers for performance

Testing:
- Run `npm run smoke:chunks` to verify chunk serving
- All chunks must return Content-Type: application/javascript
- Non-existent chunks must return 404 (not HTML)

Files modified:
- server/index.js (explicit /static route handler)
- package.json (add smoke:chunks script)
- scripts/smoke-chunk-integrity.js (new smoke test)

Deployment:
- Compatible with existing Render deployment
- No environment variable changes needed
- Works with @loadable/component SSR
```

---

## Short Version (for quick commits)

```
fix(server): serve code-split chunks with correct MIME type

- Add explicit /static route with fallthrough: false
- Set Content-Type: application/javascript for .js files
- Add chunk integrity smoke test script
- Prevents "MIME type text/html is not executable" error

Fixes production chunk loading errors.
```

