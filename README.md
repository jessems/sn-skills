# sn-skills — Claude Code Skills for ServiceNow

A collection of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that make working with ServiceNow faster and smarter.

## Install

Install all skills at once:

```bash
npx skills add jessems/sn-skills
```

Or install a specific skill:

```bash
npx skills add jessems/sn-skills --skill sn-docs
npx skills add jessems/sn-skills --skill sn-md-preview
```

---

## Skills

### `sn-docs` — ServiceNow Documentation Search & Fetch

Search and fetch ServiceNow documentation as clean Markdown — directly in your Claude Code session.

**Usage:**

```
/sn-docs how does GlideRecord work
/sn-docs https://www.servicenow.com/docs/r/australia/api-reference/...
```

- Pass a plain search query or a `docs.servicenow.com` URL
- Returns full page content as Markdown, cited with the source URL
- Always fetches from the latest release (currently Australia) unless you specify otherwise
- Works anonymously — no login, no browser, no Playwright needed

Claude will proactively use this skill whenever you ask about ServiceNow behavior, OOB functionality, APIs, table schemas, or anything that benefits from authoritative documentation.

---

### `sn-md-preview` — Markdown Preview with Mermaid & Live Reload

Render any Markdown file as a polished, GitHub-styled HTML page served locally — with live reload and Mermaid diagram support.

**Usage:**

```
/sn-md-preview docs/my-design.md
```

Or just say "preview this file" when a `.md` file is already in context.

**Features:**

- Renders Mermaid diagrams as interactive SVGs
- Live reload — browser auto-refreshes as you edit the file
- **"Copy as HTML"** button — copies the full page with Mermaid diagrams embedded as 2x PNGs, ready to paste into Confluence or ServiceNow knowledge articles
- Say "stop preview" to shut the server down

**Requires:** Node.js and [`mmdc`](https://github.com/mermaid-js/mermaid-cli)

```bash
npm install -g @mermaid-js/mermaid-cli
```

---

## Contributing

Skills live in `skills/<skill-name>/`. Each skill has a `SKILL.md` that defines the skill's name, description, and instructions for Claude.
