# skills — Claude Code Skills by jessems

A collection of [agent skills](https://vercel.com/docs/agent-resources/skills) for [Claude Code](https://claude.ai/claude-code).

## Install all skills

```bash
npx skills add jessems/skills
```

Or install a specific skill:

```bash
npx skills add jessems/skills --skill slick-preview
npx skills add jessems/skills --skill snow-docs
```

## ServiceNow

### `slick-preview`

Render a markdown file as a GitHub-styled HTML page with interactive Mermaid diagrams, served locally with live reload.

- Renders Mermaid diagrams as interactive SVG (with PNG fallback)
- "Copy for Confluence" — copies HTML with diagram placeholders
- "Copy for ServiceNow" — copies HTML with diagrams embedded as 2x PNGs
- Auto-reloads the browser when the file changes

**Requires:** Node.js, [`mmdc`](https://github.com/mermaid-js/mermaid-cli) (`npm i -g @mermaid-js/mermaid-cli`)

### `snow-docs`

Search and fetch ServiceNow documentation as clean Markdown. Accepts a search query or a `docs.servicenow.com` URL.

Use it whenever you need to know how something works in ServiceNow — OOB behavior, API reference, table schemas, etc.
