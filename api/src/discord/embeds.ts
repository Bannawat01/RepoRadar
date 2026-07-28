import type { NormalizedEvent } from '../types/index.js';

/**
 * Discord webhook payload shapes (only the fields RepoRadar uses).
 * See https://discord.com/developers/docs/resources/webhook#execute-webhook
 */
export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  url: string;
  color: number;
  author: { name: string; url: string; icon_url?: string };
  description?: string;
  fields: DiscordEmbedField[];
  footer: { text: string };
  timestamp: string;
}

export interface DiscordPayload {
  username: string;
  embeds: DiscordEmbed[];
}

/** Discord truncates silently; clip explicitly so the cut is visible. */
function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function baseEmbed(
  e: NormalizedEvent,
  emoji: string,
  color: number,
  fields: DiscordEmbedField[],
  footer: string,
): DiscordEmbed {
  return {
    title: clip(`${emoji} ${e.title}`, 256),
    url: e.url,
    color,
    author: {
      name: e.actor.login,
      url: e.actor.url,
      ...(e.actor.avatar ? { icon_url: e.actor.avatar } : {}),
    },
    ...(e.body ? { description: clip(e.body, 4000) } : {}),
    fields,
    footer: { text: footer },
    timestamp: new Date().toISOString(),
  };
}

function buildPushEmbed(e: NormalizedEvent): DiscordEmbed {
  const m = e.meta as {
    deleted?: boolean;
    created?: boolean;
    forced?: boolean;
    refKind?: string;
    ref?: string;
    commitCount?: number;
  };

  let color = 3066993;
  let emoji = '📦';
  if (m.deleted) {
    color = 15158332;
    emoji = '🗑️';
  } else if (m.created) {
    color = 3447003;
    emoji = '🌱';
  } else if (m.forced) {
    color = 15844367;
    emoji = '⚠️';
  }

  const fields: DiscordEmbedField[] = [
    { name: 'Repository', value: e.repo.name, inline: true },
    {
      name: m.refKind === 'tag' ? 'Tag' : 'Branch',
      value: m.ref || '—',
      inline: true,
    },
    { name: 'Commits', value: String(m.commitCount ?? 0), inline: true },
  ];

  return baseEmbed(e, emoji, color, fields, 'RepoRadar • push');
}

function buildPullRequestEmbed(e: NormalizedEvent): DiscordEmbed {
  const m = e.meta as {
    head?: string;
    base?: string;
    additions?: number | null;
    deletions?: number | null;
    changedFiles?: number | null;
    draft?: boolean;
  };
  const a = e.action;

  let color: number;
  let emoji: string;
  if (a === 'merged') {
    color = 3066993;
    emoji = '🟣';
  } else if (a === 'closed') {
    color = 15158332;
    emoji = '🔴';
  } else if (a === 'opened' || a === 'reopened') {
    color = 5793266;
    emoji = '🔀';
  } else {
    color = 9807270;
    emoji = '🔀';
  }

  const fields: DiscordEmbedField[] = [
    { name: 'Repository', value: e.repo.name, inline: true },
    { name: 'Flow', value: `\`${m.head}\` → \`${m.base}\``, inline: true },
  ];

  if (m.additions != null || m.deletions != null) {
    const files = m.changedFiles != null ? ` (${m.changedFiles} files)` : '';
    fields.push({
      name: 'Changes',
      value: `+${m.additions ?? 0} / -${m.deletions ?? 0}${files}`,
      inline: true,
    });
  }
  if (m.draft) fields.push({ name: 'Status', value: 'Draft', inline: true });

  return baseEmbed(
    e,
    emoji,
    color,
    fields,
    `RepoRadar • pull request • ${a}`,
  );
}

function buildIssuesEmbed(e: NormalizedEvent): DiscordEmbed {
  const m = e.meta as {
    state?: string;
    labels?: string[];
    changedLabel?: string | null;
  };
  const a = e.action;

  let color: number;
  let emoji: string;
  if (a === 'opened') {
    color = 15158332;
    emoji = '🐛';
  } else if (a === 'reopened') {
    color = 15105570;
    emoji = '🔄';
  } else if (a === 'closed') {
    color = 3066993;
    emoji = '✅';
  } else if (a === 'labeled' || a === 'unlabeled') {
    color = 10181046;
    emoji = '🏷️';
  } else {
    color = 9807270;
    emoji = '📝';
  }

  const labels =
    Array.isArray(m.labels) && m.labels.length ? m.labels.join(', ') : '—';

  const fields: DiscordEmbedField[] = [
    { name: 'Repository', value: e.repo.name, inline: true },
    { name: 'State', value: m.state || '—', inline: true },
    { name: 'Labels', value: labels, inline: false },
  ];
  if (m.changedLabel) {
    fields.splice(2, 0, {
      name: 'Changed label',
      value: m.changedLabel,
      inline: true,
    });
  }

  return baseEmbed(e, emoji, color, fields, `RepoRadar • issue • ${a}`);
}

/**
 * Route a normalized event to its embed builder. Replaces the n8n
 * "Route by Event" switch + the three Code nodes.
 */
export function buildDiscordPayload(e: NormalizedEvent): DiscordPayload {
  let embed: DiscordEmbed;
  switch (e.event) {
    case 'push':
      embed = buildPushEmbed(e);
      break;
    case 'pull_request':
      embed = buildPullRequestEmbed(e);
      break;
    case 'issues':
      embed = buildIssuesEmbed(e);
      break;
  }
  return { username: 'RepoRadar', embeds: [embed] };
}
