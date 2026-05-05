export interface CheckpointData {
  repo: string | null;
  branch: string | null;
  agent: string | null;
  lastCommit: string | null;
  repoUrl: string | null;
  summary: string | null;
  done: string[];
  next: string[];
  issues: string[];
  decisions: string[];
}

export function parseCheckpoint(content: string): CheckpointData | null {
  if (!content.includes("**Repo / branch:**") || !content.includes("**Agent:**")) {
    return null;
  }

  function extractInline(label: string): string | null {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\`?([^\`\n]+)\`?`);
    const m = content.match(re);
    return m ? m[1].trim() : null;
  }

  let repo: string | null = null;
  let branch: string | null = null;
  const repoBranchMatch = content.match(/\*\*Repo \/ branch:\*\*\s*`([^`]+)`\s*@\s*`([^`]+)`/);
  if (repoBranchMatch) {
    repo = repoBranchMatch[1].trim();
    branch = repoBranchMatch[2].trim();
  }

  const agent = extractInline("Agent");
  const lastCommit = extractInline("Last commit");
  const repoUrl = extractInline("Repo URL");

  function extractSection(header: string): string[] {
    const re = new RegExp(`###\\s+${header}\\s*\\n([\\s\\S]*?)(?=\\n###|$)`);
    const m = content.match(re);
    if (!m) return [];
    const block = m[1];
    if (/^\s*_\(none\)_\s*$/.test(block.trim())) return [];
    return block
      .split("\n")
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("_("));
  }

  function extractSummaryText(): string | null {
    const re = /###\s+Summary\s*\n([\s\S]*?)(?=\n###|$)/;
    const m = content.match(re);
    if (!m) return null;
    const text = m[1].trim();
    if (!text || /^_\(none\)_$/.test(text)) return null;
    return text;
  }

  return {
    repo,
    branch,
    agent,
    lastCommit,
    repoUrl,
    summary: extractSummaryText(),
    done: extractSection("Done"),
    next: extractSection("Next"),
    issues: extractSection("Issues"),
    decisions: extractSection("Decisions"),
  };
}
