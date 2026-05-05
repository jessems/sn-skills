---
name: sn-docs
description: Search and fetch ServiceNow documentation as clean Markdown. Accepts a search query OR a docs.servicenow.com URL. Use proactively whenever the user asks how something works in ServiceNow, what OOB behavior is, how a ServiceNow feature/table/module is supposed to work, or when you need an authoritative quote or full topic text from the ServiceNow product documentation. Trigger on questions like "how does X work in ServiceNow", "what is the OOB behavior of Y", "how are CIs connected to rate cards", etc.
argument-hint: "<search query or docs.servicenow.com URL> [--release zurich|yokohama|xanadu]"
allowed-tools: Bash, Read, Write
---

# sn-docs: ServiceNow Documentation — Search & Fetch

Two-stage skill: **search** via the khub API (excellent semantic precision), then **fetch** clean Markdown from the official `ServiceNow/ServiceNowDocs` GitHub repo (LLM-optimized, no DITA artifacts).

The GitHub repo (`github.com/ServiceNow/ServiceNowDocs`) is the official LLM-targeted mirror of docs.servicenow.com, updated at least monthly. Content is cleaner than the khub content API (no `{#ariaid-title1}` noise, structured YAML frontmatter, relative links).

Default release: **australia** (current). Pass `--release zurich|yokohama|xanadu` to target a specific release branch.

## Input detection

- **URL mode**: Argument contains `docs.servicenow.com` or starts with `r/` → go to **Fetch by URL**
- **Search mode**: Anything else → go to **Search then Fetch**

---

## Fetch by URL (fast path)

Extract the path segment after `/docs/r/` (or after `r/` if already a path), strip the `.html` extension, then fetch from GitHub raw:

```bash
# Example: https://www.servicenow.com/docs/r/api-reference/server-api-reference/c_GlideRecord.html
# → subpath: api-reference/server-api-reference/c_GlideRecord
RELEASE=australia  # override if --release passed
SUBPATH="api-reference/server-api-reference/c_GlideRecord"
curl -sf "https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/${RELEASE}/markdown/${SUBPATH}.md"
```

If GitHub returns 404, fall back to **Search mode** using the topic name from the URL.

Done. Report content to the user, citing the canonical docs URL from the YAML frontmatter (`canonical_url` field).

---

## Search then Fetch

### Step 1 — Search via khub API

```bash
curl -s --compressed -X POST "https://www.servicenow.com/docs/api/khub/topics/search" \
  -H "content-type: application/json" \
  -H "accept: application/json" \
  -d '{"query":"<QUERY>","contentLocale":"en-US","scope":"DEFAULT","page":1,"perPage":10}'
```

Response contains `results[]`, each with: `mapId`, `mapTitle`, `contentId`, `contentUrl`, `htmlTitle`, `htmlExcerpt`, `occurrences[].readerUrl`, `occurrences[].breadcrumb`.

### Step 2 — Pick the best hit

- Multiple releases return duplicate hits (Australia, Zurich, Yokohama, …). **Prefer the newest** (`Australia` as of 2025) unless the user specifies a release.
- Show the user the top 3–5 hits as: `{breadcrumb last segment} — {mapTitle} — {readerUrl}` so they can pick if needed.

### Step 3 — Fetch content from GitHub raw

Convert the `readerUrl` to a GitHub raw URL using this rule:

```
readerUrl path:  r/{subpath}.html
GitHub raw URL:  https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/{release}/markdown/{subpath}.md
```

```bash
# From readerUrl: https://www.servicenow.com/docs/r/api-reference/c_GlideRecordClientSideAPI.html
RELEASE=australia
SUBPATH="api-reference/c_GlideRecordClientSideAPI"
curl -sf "https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/${RELEASE}/markdown/${SUBPATH}.md"
```

**Fallback** — If GitHub returns 404 (topic not in repo), fall back to the khub content API:

```bash
curl -s --compressed \
  "https://www.servicenow.com/docs/api/khub/maps/<mapId>/topics/<contentId>/content?format=markdown"
```

---

## Output rules

1. Always cite with the `canonical_url` from the file's YAML frontmatter (format: `https://www.servicenow.com/docs/<path>`). If using the khub fallback, cite the full readerUrl instead.
2. When quoting, quote verbatim. Preserve bullet and table structure.
3. Optionally surface YAML metadata: `last_updated`, `reading_time_minutes`, `breadcrumb` — useful context for the user.
4. If multiple pages were fetched, clearly separate them with headings.

---

## Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| GitHub 404 on content | Topic not in GitHub repo yet (new topic, or coverage gap) | Use khub content API fallback |
| khub search returns no results | Query too specific or wrong locale | Broaden the query, try different terms |
| `403`/`405` on khub search | ServiceNow may re-enable CDN auth | See Playwright fallback below |
| Wrong release content | Multiple releases in search results | Pass `--release` or pick Australia hit explicitly |

---

## Multi-release lookup

The GitHub repo has branches for each release family. To fetch docs for a specific release:

```bash
# Yokohama release
curl -sf "https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/yokohama/markdown/${SUBPATH}.md"
```

Available branches: `australia` (latest), `zurich`, `yokohama`, `xanadu`.

---

## Power mode: local clone (optional, for heavy use)

If you need maximum speed and zero rate limits, clone the repo once:

```bash
gh repo clone ServiceNow/ServiceNowDocs ~/Library/Caches/sn-docs -- --branch australia --depth 1
```

Then search and fetch locally:

```bash
# Full-text search across all docs
rg -l "rate card" ~/Library/Caches/sn-docs/markdown/

# Read a specific file
cat ~/Library/Caches/sn-docs/markdown/it-asset-management/c_SomeFile.md

# Update (run periodically)
git -C ~/Library/Caches/sn-docs pull
```

---

## Playwright cookie fallback (khub search only)

As of April 2025, the khub search endpoint works anonymously. If ServiceNow re-enables CDN-edge authentication:

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

Add `-H "Cookie: $(cat /tmp/snow_docs_cookie.txt)"` to khub curl calls. GitHub raw content is unauthenticated and unaffected.
