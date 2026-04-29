---
name: snow-docs
description: Search and fetch ServiceNow documentation as clean Markdown. Accepts a search query OR a docs.servicenow.com URL. Use proactively whenever the user asks how something works in ServiceNow, what OOB behavior is, how a ServiceNow feature/table/module is supposed to work, or when you need an authoritative quote or full topic text from the ServiceNow product documentation. Trigger on questions like "how does X work in ServiceNow", "what is the OOB behavior of Y", "how are CIs connected to rate cards", etc.
argument-hint: "<search query or docs.servicenow.com URL>"
allowed-tools: Bash, Read, Write
---

# snow-docs: ServiceNow Documentation — Search & Fetch

Unified skill that **searches** docs.servicenow.com and **fetches** full pages as clean Markdown.
All endpoints work **anonymously** — no cookies, no Playwright, no browser needed.

## Input detection

Determine the mode based on the argument:

- **URL mode**: Argument contains `docs.servicenow.com` or starts with `r/` → go to **Fetch by URL**
- **Search mode**: Anything else → go to **Search then Fetch**

---

## Fetch by URL (fast path)

Use the `sndoc` CLI:

```bash
# Strip https://www.servicenow.com/docs/ from full URLs, then pass the path:
sndoc r/australia/api-reference/server-api-reference/c_GlideRecord.html
```

If `sndoc` returns "no map found for version", the URL is outdated — fall back to **Search mode** using the topic name from the URL.

Done. Report the content to the user with the source URL.

---

## Search then Fetch

### Step 1 — Search

```bash
curl -s --compressed -X POST "https://www.servicenow.com/docs/api/khub/topics/search" \
  -H "content-type: application/json" \
  -H "accept: application/json" \
  -d '{"query":"<QUERY>","contentLocale":"en-US","scope":"DEFAULT","page":1,"perPage":10}'
```

Response contains `results[]`, each with: `mapId`, `mapTitle`, `contentId`, `contentUrl`, `htmlTitle`, `htmlExcerpt`, `occurrences[].readerUrl`, `occurrences[].breadcrumb`.

### Step 2 — Pick the best hit

- Multiple releases return duplicate hits (Australia, Zurich, Yokohama, Xanadu, Washington DC, …). **Prefer the newest release bundle** (`Australia` as of 2025) unless the user specifies a target release.
- Show the user the top 3–5 hits as: `{breadcrumb last segment} — {mapTitle} — {readerUrl}` so they can pick a different one if needed.

### Step 3 — Fetch content as Markdown

**Option A** — Use `sndoc` with the `readerUrl` path:

```bash
# Strip https://www.servicenow.com/docs/ from readerUrl
sndoc r/australia/api-reference/server-api-reference/c_GlideRecord.html
```

**Option B** — Fetch directly via the content API (uses `mapId` and `contentId` from search results):

```bash
curl -s --compressed \
  "https://www.servicenow.com/docs/api/khub/maps/<mapId>/topics/<contentId>/content?format=markdown"
```

Option B is faster (single call, no map/topic tree walking) and is preferred when you already have `mapId` and `contentId` from the search results.

---

## Output rules

1. Always cite with the full reader URL: `https://www.servicenow.com/docs/<readerUrl-path>`
2. When quoting, quote verbatim. Preserve bullet and table structure.
3. If multiple pages were fetched, clearly separate them with headings.

## Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| `sndoc` "no map found for version" | Outdated URL version segment | Search for the topic to get current URL |
| Empty or HTML response on content | `?format=markdown` not available for that topic | Omit `?format=markdown`, fetch HTML, strip tags with `sed -e 's/<style[^>]*>.*<\/style>//g' -e 's/<[^>]*>/ /g' -e 's/  */ /g'` |
| Search returns no results | Query too specific or wrong locale | Broaden the query, try different terms |
| `403`/`405` on anonymous requests | ServiceNow may re-enable CDN auth | Use the Playwright cookie fallback below |

## Playwright cookie fallback

As of April 2025, all khub endpoints work anonymously. If ServiceNow re-enables CDN-edge authentication in the future, mint a session cookie with Playwright and pass it to curl:

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

Then add `-H "Cookie: $(cat /tmp/snow_docs_cookie.txt)"` to curl calls. Playwright must be installed at `/tmp/node_modules/playwright` (`cd /tmp && npm i playwright`).
