# Publishing notes

How to take what's in this directory and publish it across Medium, LinkedIn, and GitHub. Read once before you start.

## Files in this directory

| File | Purpose | Where it goes |
|---|---|---|
| `README.md` | Master / TOC / framing | Medium (lead-magnet article) + GitHub |
| `01-the-setup.md` | Chapter 1 | Medium + GitHub |
| `02-the-prompts.md` | Chapter 2 | Medium + GitHub |
| `03-the-review.md` | Chapter 3 | Medium + GitHub |
| `04-the-hard-ones.md` | Chapter 4 | Medium + GitHub |
| `05-instrumentation.md` | Chapter 5 | Medium + GitHub |
| `06-the-deploy.md` | Chapter 6 | Medium + GitHub |
| `linkedin-posts.md` | 7 paste-ready LinkedIn posts | LinkedIn (one per day) |
| `PUBLISHING.md` | This file | Repo only |

## Recommended cadence

Day 0: Publish the master article on Medium. Post LinkedIn intro (Post 0 in `linkedin-posts.md`). The intro post links to the master article.

Day 1–6: One Medium chapter per day. Each day, post the corresponding LinkedIn teaser (Posts 1–6) linking to that day's chapter.

Spread over a week is the right cadence. Faster looks like spam; slower loses momentum.

## Medium-specific adaptation

### Mermaid diagrams

Medium does **not** render Mermaid blocks natively. Each chapter has 1–4 Mermaid diagrams. For each one:

1. Export the Mermaid as PNG or SVG. Easiest path: open [mermaid.live](https://mermaid.live), paste the diagram source, click "PNG" or "SVG" download.
2. Replace the ` ```mermaid ... ``` ` block in the Medium article with the exported image.
3. For the `README.md`, this is two diagrams (the build shape and the chapter map).
4. For each chapter, this is 1–3 diagrams.

Total work: ~15 diagrams across the series. Budget 30 minutes.

Alternative: use [mermaid.ink](https://mermaid.ink) which provides direct image URLs you can embed in Medium without downloading. Less polished but faster.

### Internal links

The chapters cross-reference each other via relative links (`./02-the-prompts.md`). On GitHub these work natively. On Medium they need to be replaced with the Medium article URLs.

Workflow:
1. Publish the master article first (it has the most internal links). Get the URL.
2. Publish chapter 1. Update master to point to chapter 1's Medium URL. Update chapter 1's "Next" link to point to chapter 2 (placeholder until chapter 2 is published).
3. Repeat for each chapter, updating cross-references as you go.

This is tedious but inevitable. Budget 5 minutes per chapter for link updates.

### Code blocks

Medium handles fenced code blocks well. No adaptation needed — paste markdown directly via Medium's import tool (Story → ⋯ → "Import a story").

### Voice

Medium readers expect more polish than GitHub readers. The chapters are written in a working-engineer voice deliberately — that's the differentiator. **Resist the urge to soften it.** The honesty is the point.

One tweak: the master article opening ("This is not another 'look what I made with AI' post") works on Medium. On GitHub it can be replaced with a tighter framing if you want — but I'd leave it as-is for consistency.

### Featured image

Medium articles do better with a featured image at the top. Suggested: a screenshot of the parallelization map diagram from the master article. Or, more striking, a photo of the live Railway URL with a portion of the source code overlay. Either works.

### Tags

Suggested Medium tags per article (max 5 each):

- **Master**: AI, Software Engineering, Productivity, Engineering Leadership, Multi-Tenant
- **Ch 1 — Setup**: Software Architecture, AI Agents, Software Development, Git, DevOps
- **Ch 2 — Prompts**: Prompt Engineering, AI, Software Development, AI Agents, Productivity
- **Ch 3 — Review**: Code Review, AI, Software Engineering, Engineering Culture, Software Quality
- **Ch 4 — Hard Ones**: Software Engineering, AI, Software Quality, Engineering Leadership, Multi-Tenant
- **Ch 5 — Instrumentation**: Observability, Logging, Software Engineering, AI, DevOps
- **Ch 6 — Deploy**: DevOps, Docker, AI, Software Engineering, Deployment

## LinkedIn-specific adaptation

`linkedin-posts.md` has paste-ready text for each post. Important formatting rules LinkedIn enforces:

- **No markdown.** Asterisks, underscores, hash signs all show up as raw characters.
- **Line breaks matter.** Use them to create visual rhythm. Each "paragraph" should be 1–3 lines.
- **The first 2–3 lines must hook.** LinkedIn cuts after ~210 characters with "see more." Front-load the surprise.
- **Hashtags at the end only.** Inline hashtags weight worse and look amateurish.
- **No bare links.** LinkedIn deprioritises posts with naked URLs in the body. Either use the "add link" button (which creates a preview card), or put the link in the first comment after publishing.

The provided posts are already formatted to these rules. Replace `[LINK]` with the Medium URL and you're good to paste.

### Schedule

Don't post all seven on the same day. LinkedIn algorithmically suppresses repeated content from the same author within a short window. Optimal cadence:

- **Post 0 (intro)**: Tuesday morning (US time), or whatever your audience peak is. Publish master article on Medium first; LinkedIn post links to it.
- **Posts 1–6**: One per day, Tuesday through Sunday, same time of day. Each post links to the corresponding Medium chapter (which you'd publish the morning of that post).

Don't use a scheduling tool to fire posts at exactly the same minute every day. LinkedIn pattern-matches that as bot activity. Vary by 15–30 minutes per day.

### Engagement strategy

For each post:
- Reply to first 5 comments within 30 minutes of posting (boosts the post)
- Pin the most interesting reply if there is one
- Don't post the LinkedIn link to your own post — let it spread organically

If a post takes off, the algorithm will surface subsequent posts in the series to the same audience for free. The first post is the most expensive to land.

## GitHub-specific notes

The chapters live in this directory and are already in the format GitHub renders correctly. The Mermaid blocks render natively on GitHub (PR pages, README displays). No adaptation needed.

Make the tutorial branch easy to find:

1. Set the tutorial branch as a long-lived branch (not deleted after merge)
2. Add a top-level link from the main `README.md` of the repo: `📖 [How I built this with AI agents — read the case study](./tutorial/README.md)`
3. Optionally pin the tutorial PR in your repo (so visitors see it without scrolling)

You may want to also publish the tutorial as a GitHub repo of its own, separate from the codebase. In that case the chapters reference an external repo for the source, which is fine — they already include GitHub links to specific commits.

## Commit attribution

If you publish on Medium and link back to GitHub, the commit history is the primary source of truth for any technical claim in the series. Reviewers and readers will check. Make sure:

- Every commit SHA cited in the chapters resolves to a real commit
- The bug timeline in BUGS.md matches the dates and commits cited in Chapter 4
- The "tutorial/agent-orchestration" branch exists and is reachable

Treat this like an academic paper. The text is the argument; the repo is the evidence. Both have to hold up.

## What not to do

- Don't republish on Hacker News yourself. Let it spread organically. Self-submission to HN is a near-instant flag and the post will die.
- Don't repurpose this content as a paid course in the first 90 days. Free distribution while it's new builds reputation. Monetization is downstream.
- Don't over-promise. The series is honest about what's an opinion vs. what's a measured fact. Don't soften that for marketing — the honesty is the differentiator.
- Don't substitute "AI" for "agents" or vice versa indiscriminately. The chapters use "agent" specifically when meaning a parallel module-owning worker, and "AI" when meaning the broader category. Maintain the distinction.

## A note on timing

This series will date in 6–12 months as agent tooling evolves. The methodology will outlast the specific tools (Claude Code, Cursor agents, etc.) — the worktree-per-module pattern doesn't depend on any particular IDE — but the specific failure modes will shift.

Worth re-reading the chapters in 6 months and adding addenda if anything has changed materially. Don't rewrite; append a "2026 update" section.
