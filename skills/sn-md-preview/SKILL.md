---
name: sn-md-preview
description: Render a markdown file as a GitHub-styled HTML page with Mermaid diagrams, served locally with live reload. Copy as formatted HTML with embedded PNGs for Confluence.
user_invocable: true
---

# sn-md-preview

Render a markdown file as a GitHub-styled HTML page with interactive Mermaid diagrams, served locally with live reload. "Copy as HTML" button copies formatted content with embedded 2x PNGs for pasting into Confluence/docs.

## Instructions

1. **Detect the target file**: If the user provided an argument (e.g., `/sn-md-preview docs/foo.md`), use that path. Otherwise, look at the conversation context for the most recently discussed `.md` file. If ambiguous, ask the user which file to preview.

2. **Resolve the path**: Convert relative paths to absolute using the current project root (the session's working directory). Verify the file exists.

3. **One-time setup**: Check if `node_modules` exists in `.claude/skills/sn-md-preview/`. If not, run:
   ```bash
   npm install --prefix .claude/skills/sn-md-preview
   ```

4. **Launch the server**: Run the serve script in the background:
   ```bash
   node .claude/skills/sn-md-preview/serve.js "<absolute-path-to-md-file>"
   ```
   Use the Bash tool with `run_in_background: true`.

5. **Report to user**: Tell them:
   - The local URL (from server output, typically `http://localhost:3333`)
   - Live reload is active — edits to the source file auto-refresh the browser
   - "Copy as HTML" button copies the page with Mermaid diagrams as embedded 2x PNGs
   - Say "stop preview" to kill the server

6. **Stopping**: When the user says "stop preview", kill the background node process:
   ```bash
   pkill -f "serve.js.*<the-md-file>"
   ```
