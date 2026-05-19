// ══════════════════════════════════════════════════════════════════
//  СОЗДАНО И РАЗРАБОТАНО TREAK_ (ВЯЧЕСЛАВ ЛЕБЕДЕВ)
//  Отдельная благодарность сообществу SA-GOP за вдохновение и поддержку в развитии этого бота.
//  LICENSE: MIT
// ══════════════════════════════════════════════════════════════════
import db from './database.js';

let discordClient = null;
let guildId = null;

const tagToIdCache = new Map();
let senatorsCache = [];
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;

let rosterCache = { data: null, lastUpdate: 0, ttl: 30 * 1000 };

const DEFAULT_PARTY_ORG = (process.env.DEFAULT_PARTY_ORG || '').trim() || 'Республиканская партия';
const SPEAKER_PARTY_ORG = 'Спикер Сената';
const RESOLVE_MISSING_TTL = 2 * 60 * 1000;
let lastResolveMissing = 0;

function isDiscordId(value) {
  return /^\d{15,20}$/.test(String(value || '').trim());
}

function normalizePartyOrg(partyOrg) {
  const clean = (partyOrg || '').trim();
  return clean || DEFAULT_PARTY_ORG;
}

function normalizeTag(raw) {
  if (!raw) return '';
  return raw.toString().trim().replace(/^@/, '').toLowerCase();
}

function refreshCachesFromSenators(senators) {
  for (const senator of senators) {
    const id = senator.discordId ? senator.discordId.toString().trim() : '';
    if (isDiscordId(id)) {
      tagToIdCache.set(id, id);
      if (senator.tag) tagToIdCache.set(normalizeTag(senator.tag), id);
    }
  }
}

export function setDiscordClient(client, targetGuildId) {
  discordClient = client;
  guildId = targetGuildId;
}

async function resolveTagToId(tag) {
  const norm = normalizeTag(tag);
  if (!norm) return null;
  const cached = tagToIdCache.get(norm);
  if (isDiscordId(cached)) return cached;
  if (!discordClient || !guildId) return null;

  try {
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) return null;

    const members = await guild.members.search({ query: norm, limit: 10 });
    const found = members.find(member =>
      member.user.username.toLowerCase() === norm ||
      (member.user.globalName || '').toLowerCase() === norm ||
      member.displayName.toLowerCase() === norm
    );

    if (!found) return null;
    tagToIdCache.set(norm, found.user.id);
    return found.user.id;
  } catch {
    return null;
  }
}

export async function toMentionAsync(tagOrId) {
  if (!tagOrId) return '*не назначен*';
  const clean = tagOrId.toString().trim().replace(/^@/, '');
  if (isDiscordId(clean)) return `<@${clean}>`;

  const norm = clean.toLowerCase();
  const cached = tagToIdCache.get(norm);
  if (isDiscordId(cached)) return `<@${cached}>`;
  const id = await resolveTagToId(clean);
  return id ? `<@${id}>` : `@${clean}`;
}

export function toMention(tagOrId) {
  if (!tagOrId) return '*не назначен*';
  const clean = tagOrId.toString().trim().replace(/^@/, '');
  if (isDiscordId(clean)) return `<@${clean}>`;
  const norm = clean.toLowerCase();
  const cached = tagToIdCache.get(norm);
  return isDiscordId(cached) ? `<@${cached}>` : `@${clean}`;
}

export async function fetchSenators(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && senatorsCache.length > 0 && (now - lastFetch) < CACHE_TTL) return senatorsCache;

  const senators = db.getActiveSenators();
  senatorsCache = senators;
  lastFetch = now;
  refreshCachesFromSenators(senators);
  return senators;
}

async function resolveMissingDiscordIds(senators) {
  if (!discordClient || !guildId) return;
  const now = Date.now();
  if (now - lastResolveMissing < RESOLVE_MISSING_TTL) return;
  lastResolveMissing = now;

  let resolved = 0;
  for (const senator of senators) {
    if (resolved >= 5) break;
    if (senator.discordId || !senator.tag) continue;
    const id = await resolveTagToId(senator.tag);
    if (!id) continue;

    db.upsertSenator({
      discordId: id,
      tag: senator.tag,
      name: senator.name || senator.tag,
      partyOrg: normalizePartyOrg(senator.partyOrg),
      active: true,
      reason: senator.reason || '',
      source: senator.source || 'manual'
    });
    resolved++;
  }

  if (resolved > 0) {
    senatorsCache = [];
    lastFetch = 0;
    rosterCache = { ...rosterCache, data: null, lastUpdate: 0 };
  }
}

export async function getActiveSenatorCount(forceRefresh = false) {
  return (await fetchSenators(forceRefresh)).length;
}

export async function getSenatorPartyOrg(discordId) {
  if (!discordId) return null;
  const senator = db.getSenatorByDiscordId(discordId);
  if (senator?.active) return normalizePartyOrg(senator.partyOrg);

  for (const entry of await fetchSenators()) {
    if (entry.discordId === discordId) return normalizePartyOrg(entry.partyOrg);
    if (entry.tag && tagToIdCache.get(normalizeTag(entry.tag)) === discordId) return normalizePartyOrg(entry.partyOrg);
  }

  return null;
}

export async function getPartyOrgs() {
  const orgs = new Set(db.getPartyOrgs());
  orgs.add(SPEAKER_PARTY_ORG);
  return [...orgs].sort((a, b) => a.localeCompare(b, 'ru'));
}

export async function getSenatorsByPartyOrg(partyOrg) {
  return db.getSenatorsByPartyOrg(partyOrg);
}

export async function deactivateSenator(tag, reason = '') {
  const senator = db.getSenatorByTag(tag) || db.getSenatorByDiscordId(tag);
  if (!senator) throw new Error(`Сенатор @${tag} не найден`);
  db.deactivateSenatorByTag(senator.tag || tag, reason);
  senatorsCache = [];
  lastFetch = 0;
  if (senator.tag) tagToIdCache.delete(normalizeTag(senator.tag));
}

export async function replaceSenator(oldTag, newTag, newName, partyOrg, reason = '') {
  db.replaceSenatorRecord(oldTag, newTag, newName, partyOrg, reason);
  senatorsCache = [];
  lastFetch = 0;

  const newClean = normalizeTag(newTag);
  if (newClean) {
    const resolved = await resolveTagToId(newClean);
    if (resolved) tagToIdCache.set(newClean, resolved);
  }
}

export async function formatSenateRoster() {
  const now = Date.now();
  if (rosterCache.data && (now - rosterCache.lastUpdate) < rosterCache.ttl) return rosterCache.data;

  db.cleanupDuplicateSenators();
  const senators = await fetchSenators(true);
  await resolveMissingDiscordIds(senators);
  if (!senators.length) {
    const result = { count: 0, text: '*Состав пока не настроен. Добавьте сенаторов через Discord.*' };
    rosterCache = { ...rosterCache, data: result, lastUpdate: now };
    return result;
  }

  const byGroup = new Map();
  for (const senator of senators) {
    const group = normalizePartyOrg(senator.partyOrg);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(senator);
  }

  const lines = [];
  const sortedGroups = [...byGroup.entries()].sort((a, b) => {
    const aKey = a[0] || '';
    const bKey = b[0] || '';
    const aSpeaker = aKey.toLowerCase() === SPEAKER_PARTY_ORG.toLowerCase();
    const bSpeaker = bKey.toLowerCase() === SPEAKER_PARTY_ORG.toLowerCase();
    if (aSpeaker && !bSpeaker) return -1;
    if (!aSpeaker && bSpeaker) return 1;
    return aKey.localeCompare(bKey, 'ru');
  });
  for (const [group, members] of sortedGroups) {
    lines.push(`**${group}**`);
    for (const member of members) {
      const label = member.name || member.tag || 'Без имени';
      let mention = member.discordId ? `<@${member.discordId}>` : '';
      if (!mention) {
        const resolvedId = member.tag ? await resolveTagToId(member.tag) : null;
        if (resolvedId) {
          mention = `<@${resolvedId}>`;
          db.upsertSenator({
            discordId: resolvedId,
            tag: member.tag,
            name: member.name || member.tag,
            partyOrg: normalizePartyOrg(member.partyOrg),
            active: true,
            reason: member.reason || '',
            source: member.source || 'manual'
          });
        }
      }
      if (!mention) mention = await toMentionAsync(member.tag);
      lines.push(`• ${mention} — ${label}`);
    }
    lines.push('');
  }

  const result = { count: senators.length, text: lines.join('\n').trim().substring(0, 4000) || '*Нет активных сенаторов*' };
  rosterCache = { ...rosterCache, data: result, lastUpdate: now };
  return result;
}

export async function syncSenatorsFromDiscordRole(roleId) {
  if (!discordClient || !guildId || !roleId) return { count: 0 };
  const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { count: 0 };

  const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return { count: 0 };

  const synced = [];
  for (const member of role.members.values()) {
    const existing = db.getSenatorByDiscordId(member.id);
    const tag = member.user.username || member.displayName || member.id;
    const name = member.displayName || member.user.globalName || member.user.username || tag;
    const senator = db.upsertSenator({
      discordId: member.id,
      tag,
      name,
      partyOrg: normalizePartyOrg(existing?.partyOrg),
      active: true,
      reason: '',
      source: 'discord-role'
    });
    if (senator) synced.push(senator);
  }

  senatorsCache = [];
  lastFetch = 0;
  rosterCache = { ...rosterCache, data: null, lastUpdate: 0 };
  refreshCachesFromSenators(synced);
  return { count: synced.length };
}

export async function ensureBotDbSheet() {
  senatorsCache = db.getActiveSenators();
  refreshCachesFromSenators(senatorsCache);
}

export function ensureDefaultPartyOrg() {
  const changes = db.setDefaultPartyOrg(DEFAULT_PARTY_ORG);
  if (changes > 0) {
    senatorsCache = [];
    lastFetch = 0;
    rosterCache = { ...rosterCache, data: null, lastUpdate: 0 };
  }
  return changes;
}

export function getTagToIdCache() {
  return tagToIdCache;
}

export function setTagId(tag, id) {
  if (tag && isDiscordId(id)) tagToIdCache.set(normalizeTag(tag), id);
}
