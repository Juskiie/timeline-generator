#!/usr/bin/env node

/**
 * generate-timeline.js
 *
 * A zero-dependency Node.js CLI that fetches a GitHub repo's commit history
 * (public repos) and generates a single self-contained HTML file that acts as
 * a blog-style timeline template. Each commit becomes a section with metadata,
 * a placeholder for your narrative, and unified diff patches in code blocks.
 *
 * Usage:
 *   node generate-timeline.js <owner>/<repo> [--branch <branch>] [--out <file.html>]
 *
 * Examples:
 *   node generate-timeline.js vercel/next.js --branch canary --out nextjs-log.html
 *   GITHUB_TOKEN=ghp_XXXXX node generate-timeline.js owner/repo
 *
 * Notes:
 * - Public repos require no token, but you may hit rate limits; set GITHUB_TOKEN to raise limits.
 * - Outputs oldest → newest (chronological) so your story reads forward in time.
 * - CSS is namespaced under `.gtl-*` and easy to override with your site styles.
 */

const fs = require('fs');
const path = require('path');

// -------- CLI arg parsing (minimal) --------
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`\nUsage: node generate-timeline.js <owner>/<repo> [--branch <branch>] [--out <file.html>]\n`);
  process.exit(0);
}

const repoArg = args[0];
if (!/^[^\/]+\/[^\/]+$/.test(repoArg)) {
  console.error('Error: repo must be in the form "owner/repo".');
  process.exit(1);
}

function getFlag(name, fallback = undefined) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

const branch = getFlag('--branch', 'main');
const outPath = getFlag('--out', `${repoArg.replace('/', '-')}-${branch}-timeline.html`);

const [owner, repo] = repoArg.split('/');

// GitHub API base
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || '';

// Node 18+ has global fetch; if missing, advise user
if (typeof fetch !== 'function') {
  console.error('This script requires Node 18+ for built-in fetch.');
  process.exit(1);
}

// -------- Helpers --------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ghHeaders() {
  const h = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'commit-timeline-generator'
  };
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  return h;
}

function parseLinkHeader(link) {
  // Parses GitHub's Link header for pagination
  // returns { next: url | undefined }
  if (!link) return {};
  const parts = link.split(',').map((s) => s.trim());
  const out = {};
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

function htmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toISODate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
  } catch (_) {
    return dateStr;
  }
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '';
}

// Collate unified diffs from the GitHub commit files array
function buildUnifiedDiff(files) {
  if (!Array.isArray(files)) return '';
  const chunks = [];
  for (const f of files) {
    // GitHub returns a `patch` for text files. It may be undefined for binaries/renames.
    const filename = f.filename || 'unknown';
    const status = f.status; // added, modified, removed, renamed
    const header = `--- a/${filename}\n+++ b/${filename}`;
    const patch = f.patch ? f.patch : `# (${status}) No textual diff available.`;
    chunks.push(`${header}\n${patch}`);
  }
  return chunks.join('\n\n');
}

// -------- GitHub API calls --------
async function fetchAllCommits(owner, repo, branch) {
  const per_page = 100; // GitHub max
  let url = `${API}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${per_page}`;
  const commits = [];

  while (url) {
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 404) {
      throw new Error(`Repo not found or branch missing: ${owner}/${repo}#${branch}`);
    }
    if (res.status === 403) {
      // Possibly rate limited
      const ratelimit = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      let msg = 'Forbidden / rate limited';
      if (ratelimit === '0' && reset) {
        const secs = Math.max(0, parseInt(reset, 10) - Math.floor(Date.now()/1000));
        msg += ` (rate limit resets in ~${secs}s)`;
      }
      throw new Error(msg);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    commits.push(...data);

    const links = parseLinkHeader(res.headers.get('link'));
    url = links.next || null;

    // Small delay to be gentle if many pages
    if (url) await sleep(150);
  }
  return commits;
}

async function fetchCommitDetail(owner, repo, sha) {
  const url = `${API}/repos/${owner}/${repo}/commits/${sha}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch commit ${sha}: ${res.status} ${text}`);
  }
  return res.json();
}

// -------- HTML generation --------
function buildHTML({ meta, commits }) {
  const { owner, repo, branch, generatedAt } = meta;

  const head = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(repo)} – Commit Timeline</title>
  <style>
    /* \n     * Namespaced minimal styles. Override with your global CSS if desired.\n     */
    :root { --gtl-bg: #0b0c10; --gtl-card: #111218; --gtl-text: #e6e6e6; --gtl-sub: #a7adba; --gtl-accent: #7aa2f7; --gtl-muted: #2a2f3a; }
    .gtl-body { background: var(--gtl-bg); color: var(--gtl-text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji"; line-height: 1.6; }
    .gtl-container { max-width: 950px; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
    .gtl-header { display:flex; flex-direction:column; gap:.3rem; margin-bottom:1.5rem; }
    .gtl-title { font-size: 1.9rem; font-weight: 800; letter-spacing: .2px; }
    .gtl-meta { color: var(--gtl-sub); font-size: .95rem; }
    .gtl-help { color: var(--gtl-sub); font-size: .92rem; margin-top: .6rem; }

    .gtl-timeline { display: grid; gap: 1rem; position: relative; }
    .gtl-item { background: var(--gtl-card); border: 1px solid var(--gtl-muted); border-radius: 14px; padding: 1rem 1rem 0.25rem; }
    .gtl-item header { display:flex; flex-wrap:wrap; align-items: baseline; gap:.6rem 1rem; }
    .gtl-idx { font-weight: 700; color: var(--gtl-accent); }
    .gtl-sha a { color: var(--gtl-sub); text-decoration: none; }
    .gtl-sha a:hover { text-decoration: underline; }
    .gtl-date { color: var(--gtl-sub); }
    .gtl-msg { font-weight: 600; margin: .2rem 0 .6rem; }

    .gtl-notes { margin: .6rem 0 1rem; background: rgba(122,162,247,.06); border: 1px dashed var(--gtl-accent); padding: .75rem; border-radius: 10px; }
    .gtl-notes .gtl-notes-label { font-size: .9rem; color: var(--gtl-sub); margin-bottom: .35rem; }
    .gtl-notes p { margin: .2rem 0; }

    .gtl-diff-wrap { margin: .6rem 0 1rem; border-top: 1px solid var(--gtl-muted); padding-top: .6rem; }
    .gtl-diff-controls { display:flex; gap:.6rem; margin-bottom:.4rem; }
    .gtl-btn { font: inherit; font-weight: 600; border-radius: 8px; padding: .35rem .6rem; border: 1px solid var(--gtl-muted); background: #161821; color: var(--gtl-text); cursor: pointer; }
    .gtl-btn:hover { filter: brightness(1.08); }

    pre.gtl-code { background: #0d0f14; border:1px solid #1b1f2a; border-radius: 10px; padding: .75rem; overflow:auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: .85rem; line-height: 1.5; }
    code.gtl-diff .hunk { color:#9cdcfe; }
    code.gtl-diff .plus { color:#9ece6a; }
    code.gtl-diff .minus { color:#f7768e; }
    code.gtl-diff .meta { color:#7aa2f7; }

    .gtl-footer { color: var(--gtl-sub); font-size:.9rem; margin-top:1.2rem; text-align:center; }

    /* Print tweaks */
    @media print {
      .gtl-btn, .gtl-diff-controls { display:none !important; }
      .gtl-container { padding: 0; }
      .gtl-item { break-inside: avoid; }
    }
  </style>
</head>`;

  const intro = `<body class="gtl-body">
  <div class="gtl-container">
    <div class="gtl-header">
      <div class="gtl-title">${htmlEscape(owner)}/${htmlEscape(repo)} — Commit Timeline</div>
      <div class="gtl-meta">Branch: <strong>${htmlEscape(branch)}</strong> • Generated: ${htmlEscape(generatedAt)}</div>
      <div class="gtl-help">Each commit below has a "Notes" area. Replace the placeholder text with your story: why changes were made, decisions, roadblocks, and takeaways. You can delete any sections you don’t need.</div>
    </div>

    <main class="gtl-timeline">`;

  const items = commits.map((c, i) => {
    const idx = i + 1;
    const commitUrl = `https://github.com/${owner}/${repo}/commit/${c.sha}`;
    const date = toISODate(c.date);
    const msg = c.message || '(no message)';

    // Light syntax hints: wrap hunk headers and +/- lines in spans
    const escaped = htmlEscape(c.diff)
      .split('\n')
      .map((line) => {
        if (line.startsWith('@@')) return `<span class="hunk">${line}</span>`;
        if (line.startsWith('+++') || line.startsWith('---')) return `<span class="meta">${line}</span>`;
        if (line.startsWith('+')) return `<span class="plus">${line}</span>`;
        if (line.startsWith('-')) return `<span class="minus">${line}</span>`;
        return line;
      })
      .join('\n');

    return `
      <article class="gtl-item" id="c-${c.sha}">
        <header>
          <div class="gtl-idx">#${idx}</div>
          <div class="gtl-date">${date}</div>
          <div class="gtl-sha"><a href="${commitUrl}" target="_blank" rel="noopener noreferrer">${shortSha(c.sha)}</a></div>
        </header>
        <div class="gtl-msg">${htmlEscape(msg)}</div>

        <section class="gtl-notes">
          <div class="gtl-notes-label">Notes (replace this with your story)</div>
          <p><em>What changed? Why? Any alternatives considered? Roadblocks or bugs fixed? Lessons learned?</em></p>
        </section>

        <section class="gtl-diff-wrap">
          <div class="gtl-diff-controls">
            <button class="gtl-btn" data-action="toggle" aria-expanded="true">Collapse diff</button>
            <button class="gtl-btn" data-action="copy">Copy diff</button>
          </div>
          <pre class="gtl-code"><code class="gtl-diff" data-language="diff">${escaped}</code></pre>
        </section>
      </article>
    `;
  }).join('\n');

  const outro = `
    </main>
    <div class="gtl-footer">End of timeline • You can remove this footer.</div>
  </div>

  <script>
    // Minimal interactivity: collapse/expand and copy diff
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.gtl-btn');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const wrap = btn.closest('.gtl-item').querySelector('.gtl-diff-wrap');
      const pre = wrap.querySelector('pre');

      if (action === 'toggle') {
        const expanded = btn.getAttribute('aria-expanded') !== 'false';
        if (expanded) {
          pre.style.display = 'none';
          btn.textContent = 'Expand diff';
          btn.setAttribute('aria-expanded', 'false');
        } else {
          pre.style.display = '';
          btn.textContent = 'Collapse diff';
          btn.setAttribute('aria-expanded', 'true');
        }
      }

      if (action === 'copy') {
        const code = wrap.querySelector('code').innerText;
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => (btn.textContent = 'Copy diff'), 1000);
        }).catch(() => {
          btn.textContent = 'Copy failed';
          setTimeout(() => (btn.textContent = 'Copy diff'), 1200);
        });
      }
    });
  </script>
</body>
</html>`;

  return head + '\n' + intro + '\n' + items + '\n' + outro;
}

// -------- Main --------
(async function main() {
  try {
    console.log(`Fetching commits for ${owner}/${repo} (branch: ${branch}) ...`);
    const list = await fetchAllCommits(owner, repo, branch);

    if (!list.length) {
      throw new Error('No commits found. Check the branch name.');
    }

    // Oldest → newest
    list.reverse();

    // Fetch details with patches
    const commits = [];
    let n = 0;
    for (const c of list) {
      n++;
      process.stdout.write(`\rFetching commit ${n}/${list.length}: ${shortSha(c.sha)}   `);
      const detail = await fetchCommitDetail(owner, repo, c.sha);
      const files = detail.files || [];
      const diff = buildUnifiedDiff(files);
      commits.push({
        sha: c.sha,
        date: (c.commit && c.commit.author && c.commit.author.date) || c.committer?.date || '',
        message: (c.commit && c.commit.message) || '',
        diff,
      });
      // Be gentle with the API
      await sleep(120);
    }
    process.stdout.write('\n');

    const html = buildHTML({
      meta: { owner, repo, branch, generatedAt: new Date().toISOString() },
      commits,
    });

    const abs = path.resolve(outPath);
    fs.writeFileSync(abs, html, 'utf8');
    console.log(`\n✅ Wrote ${commits.length} commits to: ${abs}`);
    console.log('Tip: open it in a browser, replace the Notes with your story, and drop it into your site.');
  } catch (err) {
    console.error('\n\nError:', err.message);
    process.exit(1);
  }
})();
