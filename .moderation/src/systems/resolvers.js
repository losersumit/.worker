/**
 * Fuzzy Channel & Role Resolvers
 * Matches user-provided hints (e.g. "generalzz", "bulletin") against
 * a Discord guild's channels / roles using Levenshtein distance.
 * No external dependencies — all fuzzy logic is implemented inline.
 */

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Strip everything that isn't a basic ASCII letter, digit, hyphen, or underscore.
 * This normalises both the user hint and the Discord names before comparison.
 * @param {string} str
 * @returns {string}
 */
function normalise(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '');
}

/**
 * Classic Levenshtein distance (edit distance) between two strings.
 * O(m·n) time / O(min(m,n)) space — fine for short Discord names.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep the shorter string in `b` so the working row is smaller
  if (a.length < b.length) [a, b] = [b, a];

  const bLen = b.length;
  let prev = Array.from({ length: bLen + 1 }, (_, i) => i);
  let curr = new Array(bLen + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[bLen];
}

/**
 * Maximum allowed edit distance relative to the hint length.
 * Short hints get a tight budget; longer ones get a bit more room.
 * @param {string} hint
 * @returns {number}
 */
function maxAllowedDistance(hint) {
  const len = hint.length;
  if (len <= 2) return 0;  // must be exact for very short hints
  if (len <= 5) return 1;
  if (len <= 10) return 2;
  return 3;
}

/**
 * Generic fuzzy matcher.
 * Scans a collection of { name, item } entries and returns the best match,
 * or an ambiguous-candidates object when there's a tie.
 * @param {{ name: string, item: any }[]} entries
 * @param {string} rawHint
 * @returns {any|null|{ ambiguous: true, candidates: any[] }}
 */
function fuzzyMatch(entries, rawHint) {
  const hint = normalise(rawHint);
  if (!hint) return null;

  // --- Pass 1: exact substring / prefix match (fast path) ---
  const exactMatches = entries.filter(e => normalise(e.name) === hint);
  if (exactMatches.length === 1) return exactMatches[0].item;

  // --- Pass 2: Levenshtein scoring ---
  const maxDist = maxAllowedDistance(hint);
  const scored = [];

  for (const entry of entries) {
    const norm = normalise(entry.name);
    if (!norm) continue;

    const dist = levenshtein(hint, norm);
    if (dist <= maxDist) {
      scored.push({ entry, dist });
    }
  }

  if (scored.length === 0) return null;

  // Sort ascending by distance
  scored.sort((a, b) => a.dist - b.dist);

  const best = scored[0].dist;
  const topCandidates = scored.filter(s => s.dist === best);

  // If multiple entries share the best distance → ambiguous
  if (topCandidates.length > 1) {
    return {
      ambiguous: true,
      candidates: topCandidates.map(s => s.entry.item),
    };
  }

  return topCandidates[0].entry.item;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Resolve a channel from a user's text hint.
 * @param {import('discord.js').Guild} guild
 * @param {string} hint - User-provided channel name (e.g. "general", "buletin")
 * @returns {import('discord.js').GuildChannel|null|{ ambiguous: true, candidates: import('discord.js').GuildChannel[] }}
 */
export function resolveChannel(guild, hint) {
  if (!guild || !hint) return null;

  // Only consider text-based channels (text, announcements, forums, voice-text)
  const entries = guild.channels.cache
    .filter(ch => ch.name) // safety — unnamed channels shouldn't exist but guard anyway
    .map(ch => ({ name: ch.name, item: ch }));

  return fuzzyMatch(entries, hint);
}

/**
 * Resolve a role from a user's text hint.
 * @param {import('discord.js').Guild} guild
 * @param {string} hint - User-provided role name (e.g. "moderator", "modd")
 * @returns {import('discord.js').Role|null|{ ambiguous: true, candidates: import('discord.js').Role[] }}
 */
export function resolveRole(guild, hint) {
  if (!guild || !hint) return null;

  // Exclude @everyone — it's handled separately in resolvePingTarget
  const entries = guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({ name: r.name, item: r }));

  return fuzzyMatch(entries, hint);
}

/**
 * Convert a natural-language ping target into a Discord mention string.
 * Handles special keywords ("everyone", "here") and falls back to fuzzy role matching.
 * @param {import('discord.js').Guild} guild
 * @param {string} text - e.g. "everyone", "operators", "here"
 * @returns {string|null} A mention string like "@everyone" or "<@&roleId>", or null if unresolvable.
 */
export function resolvePingTarget(guild, text) {
  if (!guild || !text) return null;

  const lower = text.trim().toLowerCase();

  // Special keywords
  if (lower === 'everyone') return '@everyone';
  if (lower === 'here') return '@here';

  // Attempt fuzzy role resolution
  const role = resolveRole(guild, text);

  // If ambiguous or null, we can't produce a mention
  if (!role || role.ambiguous) return null;

  return `<@&${role.id}>`;
}
