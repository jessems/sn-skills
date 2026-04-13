---
name: snow-docs
description: Search and fetch verbatim content from docs.servicenow.com via the Fluid Topics internal API. Use whenever you need an authoritative quote or full topic text from the ServiceNow product documentation.
argument-hint: "<search query> [e.g. 'expense line user based asset cost center']"
allowed-tools: Bash, Read, Write
---

# snow-docs: ServiceNow Docs Fetcher

Retrieves verbatim content from `docs.servicenow.com` (Fluid Topics SaaS) by bypassing the SPA with the internal `khub` API.

## Why this exists

- `docs.servicenow.com` is a GWT single-page app. `WebFetch` returns only the bootloader HTML.
- The public-looking `/api/khub/search` is a decoy (405). The real route is **`/api/khub/topics/search`**.
- Anonymous curl is blocked at the CDN edge unless you carry the full browser cookie set (`FT_SESSION`, `INGRESSCOOKIE`, `AKA_A2`, etc.).
- One Playwright page load mints the cookies; after that, plain curl works for the entire session.

## Endpoints

| Purpose | Method | Path |
|---|---|---|
| Search | `POST` | `/docs/api/khub/topics/search` |
| Full topic HTML | `GET` | `/docs/api/khub/maps/{mapId}/topics/{topicId}/content` |
| Locales (sanity check) | `GET` | `/docs/api/khub/locales` |

Search request body:
```json
{"query":"<q>","contentLocale":"en-US","scope":"DEFAULT","page":1,"perPage":10}
```

Search response → each hit has `mapId`, `contentId`, `contentUrl`, `occurrences[].readerUrl`, `breadcrumb`, `htmlExcerpt`, `mapTitle` (release bundle name, e.g. `Washington DC IT Service Management`).

## Procedure

### Step 1 — Ensure a fresh cookie at `/tmp/snow_docs_cookie.txt`

Reuse it if present and < 30 minutes old; otherwise mint a new one:

```bash
COOKIE_FILE=/tmp/snow_docs_cookie.txt
if [ ! -f "$COOKIE_FILE" ] || [ $(( $(date +%s) - $(stat -f %m "$COOKIE_FILE" 2>/dev/null || echo 0) )) -gt 1800 ]; then
  cat > /tmp/snow_docs_mint.mjs <<'EOF'
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext();
const page = await ctx.newPage();
await page.goto('https://www.servicenow.com/docs/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
await page.evaluate(() => fetch('/docs/api/khub/locales', {credentials:'include'}));
await page.waitForTimeout(800);
const cookies = await ctx.cookies('https://www.servicenow.com');
process.stdout.write(cookies.map(c => `${c.name}=${c.value}`).join('; '));
await b.close();
EOF
  (cd /tmp && node snow_docs_mint.mjs) > "$COOKIE_FILE"
fi
```

Playwright is installed at `/tmp/node_modules/playwright` — run node from `/tmp` so the import resolves. If missing: `(cd /tmp && npm i playwright)`.

### Step 2 — Search

```bash
COOKIE=$(cat /tmp/snow_docs_cookie.txt)
curl -s --compressed -X POST "https://www.servicenow.com/docs/api/khub/topics/search" \
  -H "Cookie: $COOKIE" \
  -H "content-type: application/json" \
  -H "accept: application/json" \
  -H "referer: https://www.servicenow.com/docs/" \
  -H "origin: https://www.servicenow.com" \
  -H "user-agent: Mozilla/5.0" \
  -d '{"query":"<QUERY>","contentLocale":"en-US","scope":"DEFAULT","page":1,"perPage":10}'
```

### Step 3 — Fetch full topic content

For any hit, GET its `contentUrl` with the same cookie. The body is a DITA-rendered HTML fragment.

```bash
curl -s --compressed -H "Cookie: $COOKIE" \
  "https://www.servicenow.com/docs/api/khub/maps/<mapId>/topics/<contentId>/content"
```

Strip tags for readability when quoting:
```bash
... | sed -e 's/<style[^>]*>.*<\/style>//g' -e 's/<[^>]*>/ /g' -e 's/  */ /g'
```

## Result Filtering & Citation Rules

- Multiple releases return duplicate hits (Australia, Zurich, Yokohama, Xanadu, Washington DC, …). **Prefer the newest release bundle** available unless the user specifies a target release.
- Always cite with the `readerUrl` (human-readable), not the `contentUrl` (API).
- When quoting, quote verbatim and keep inline HTML stripped. Preserve bullet structure by converting `<li>` → `- `.

## Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| `405 Method Not Allowed` on `/api/khub/search` | Wrong path | Use `/api/khub/topics/search` |
| `404` with valid cookie | Wrong path or stale cookie | Re-mint cookie |
| HTML returned instead of JSON | Path doesn't exist → SPA fallback | Check path; every `/docs/**` non-API serves the SPA |
| curl works in Playwright page but not from shell | Missing cookies (edge drop) | Ensure full cookie string, not just `FT_SESSION` |
| `ERR_MODULE_NOT_FOUND playwright` | Wrong cwd | Run node from `/tmp` where `node_modules` lives |

## Output to the user

Report:
1. The search query used
2. Top N hits as: `{breadcrumb last segment} — {mapTitle} — {readerUrl}`
3. For any quoted text, the full `readerUrl` as source
