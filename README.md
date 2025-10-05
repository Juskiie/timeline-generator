# Commit Timeline Generator

Turn any GitHub repository’s commit history into a clean, story‑friendly webpage. This Node.js CLI pulls commits (oldest → newest) and produces a single, self‑contained HTML file with one section per commit: metadata, a Notes panel for your narrative, and unified diffs in code blocks. Paste the page into your personal site or drop in your stylesheet and write your build log.

---

## Features

* **One file output** – a standalone `.html` you can publish anywhere.
* **Section‑per‑commit** – date, short SHA link, message, and a Notes area for your story.
* **Unified diffs** – rendered in `<pre><code>` with lightweight inline coloring.
* **Chronological order** – reads forward in time (oldest → newest).
* **Namespaced styling** – minimal CSS under the `.gtl-*` namespace so you can safely override.
* **No build step** – zero dependencies beyond Node 18+ (built‑in `fetch`).

> **Public repos only** for now. Optional `GITHUB_TOKEN` support raises rate limits.

---

## Quick Start

### Requirements

* Node.js **18+** (for global `fetch`).

### Run

1. Save `generate-timeline.js` into your project root (or anywhere you prefer).
2. Execute:

```bash
node generate-timeline.js <owner>/<repo> [--branch <branch>] [--out <file.html>]
```

**Examples**

```bash
# Generate from main and write a default file name
node generate-timeline.js vercel/next.js

# Choose a branch and output path
node generate-timeline.js vercel/next.js --branch canary --out nextjs-log.html

# Use a token to raise rate limits (recommended for large repos)
GITHUB_TOKEN=ghp_xxx node generate-timeline.js owner/repo
```

Open the resulting HTML in your browser and replace each **Notes** block with your narrative: *why the change happened, trade‑offs, roadblocks, lessons learned.*

---

## CLI

```text
node generate-timeline.js <owner>/<repo> [--branch <branch>] [--out <file.html>]
```

| Flag       | Default                                 | Description            |
| ---------- | --------------------------------------- | ---------------------- |
| `--branch` | `main`                                  | Source branch to read. |
| `--out`    | `<owner>-<repo>-<branch>-timeline.html` | Output HTML path.      |

Environment:

* `GITHUB_TOKEN` (optional) – increases rate limits and reduces failures on big histories.

---

## Output

The generator writes a single HTML file containing:

* A header with repo name, branch, generation timestamp
* A timeline grid with one **article** per commit
* For each commit:

  * **#index**, **date**, linked **short SHA**, and **message**
  * **Notes** panel (editable placeholder text)
  * A **unified diff** (collapsible, copy‑to‑clipboard button)

### Styling

All styles are namespaced under the `.gtl-*` prefix (e.g., `.gtl-body`, `.gtl-item`, `.gtl-notes`).
You can:

* Inline your site CSS below the built‑in style block
* Or override the variables / classes in your stylesheet

CSS variables used:

```css
:root {
  --gtl-bg: #0b0c10;
  --gtl-card: #111218;
  --gtl-text: #e6e6e6;
  --gtl-sub: #a7adba;
  --gtl-accent: #7aa2f7;
  --gtl-muted: #2a2f3a;
}
```

### Interactions

* **Collapse/Expand diff** per commit
* **Copy diff** to clipboard

Both are implemented with a small inline `<script>` and no external dependencies.

---

## Rate Limits & Auth

* Unauthenticated requests are limited by GitHub; large histories may hit limits.
* Set `GITHUB_TOKEN` to raise limits and reduce throttling:

```bash
export GITHUB_TOKEN=ghp_...
node generate-timeline.js owner/repo
```

The script includes gentle delays and backoff. If you still hit limits, try again later or scope to a branch with fewer commits.

---

## How it Works

1. Pages through the GitHub Commits API for the chosen branch.
2. Fetches each commit’s **files** array to collect `patch` hunks.
3. Concatenates those into a unified‑diff block per commit (`--- a/file` / `+++ b/file` plus hunks).
4. Generates an HTML timeline (oldest → newest) with minimal CSS + JS.

> Binary files or renames may not include textual `patch` data. In those cases, the output includes a placeholder line.

---

## Troubleshooting

* **“Repo not found or branch missing”** – Check `<owner>/<repo>` and the `--branch` value.
* **Empty output / few commits** – Ensure you’re pointing at the correct branch.
* **Hit rate limits** – Provide `GITHUB_TOKEN`. For very large repos, re‑run if throttled.
* **No diff for some files** – Binary files and some rename operations don’t return textual patches from the API.

---

## Roadmap

* GitHub auth for **private repos**
* Optional filters (exclude merges/chore commits; date range; `--max`)
* Grouping by day/week; milestone markers from tags
* GitHub Action that builds and uploads the HTML artifact on push
* Export to **Markdown + CSS/JS bundle** option


---

## Contributing

PRs welcome! Please keep the output HTML self‑contained and the CSS namespaced (`.gtl-*`). If adding options, prefer sensible defaults and preserve the “one file” experience.

---

## License

MIT. See `LICENSE`.
