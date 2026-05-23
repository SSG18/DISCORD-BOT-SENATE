// ══════════════════════════════════════════════════════════════════
//  СОЗДАНО И РАЗРАБОТАНО by treak_ (discord)
//  Отдельная благодарность сообществу SA-GOP за вдохновение и поддержку в развитии этого бота.
//  LICENSE: MIT
// ══════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { nanoid } from 'nanoid';
import {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
  Events, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelType
} from 'discord.js';
import db from './database.js';
import {
  fetchSenators, getSenatorPartyOrg, getPartyOrgs, getSenatorsByPartyOrg,
  getActiveSenatorCount, replaceSenator, deactivateSenator,
  formatSenateRoster, ensureBotDbSheet, ensureDefaultPartyOrg, syncSenatorsFromDiscordRole,
  toMention, toMentionAsync, setDiscordClient, setTagId, getTagToIdCache
} from './senators.js';

// ════════════════════════════ CONFIG ═══════════════════════════════
const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

const CHAMBER_CHANNELS      = { senate: process.env.SENATE_CHANNEL_ID };
const MEETING_CHANNELS      = { senate: process.env.SENATE_MEETING_CHANNEL_ID };
const MEETING_MENTION_ROLES = { senate: process.env.SENATE_MENTION_ROLE_ID };
const SENATOR_REPLACEMENT_CHANNEL_ID = process.env.SENATOR_REPLACEMENT_CHANNEL_ID || '';
const CIVIC_INITIATIVE_CHANNEL_ID    = process.env.CIVIC_INITIATIVE_CHANNEL_ID    || '';

const ROLES = {
  SENATOR:    process.env.SENATOR_ROLE_ID,
  SENATOR_NV: process.env.SENATOR_NO_VOTE_ROLE_ID,
  CHAIRMAN:   process.env.CHAIRMAN_ROLE_ID,
  VICE_CHAIR: process.env.VICE_CHAIRMAN_ROLE_ID,
  FED_GOV:    process.env.FEDERAL_GOVERNMENT_ROLE_ID
};

const FEDERAL_GOV_IDS   = (process.env.FEDERAL_GOVERNMENT_USER_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const ADMIN_ROLE_IDS    = (process.env.ADMIN_ROLE_SEND_ID  || '').split(',').map(s => s.trim()).filter(Boolean);
const SYSADMIN_ROLE_IDS = (process.env.SYSADMIN_ROLE_ID   || '').split(',').map(s => s.trim()).filter(Boolean);
const BILLS_FORUM_CHANNEL_ID = process.env.BILLS_FORUM_CHANNEL_ID;

const FORUM_TAGS = {
  ON_REVIEW:    process.env.FORUM_TAG_ON_REVIEW,
  APPROVED:     process.env.FORUM_TAG_APPROVED,
  REJECTED:     process.env.FORUM_TAG_REJECTED,
  NOT_APPROVED: process.env.FORUM_TAG_NOT_APPROVED,
  SIGNED:       process.env.FORUM_TAG_SIGNED,
  VETOED:       process.env.FORUM_TAG_VETOED
};

const FOOTER      = '🦅 Идея и разработка by @treak_';
const FOOTER_ICON = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Republicanlogo.svg/1200px-Republicanlogo.svg.png';

const COLORS = {
  PRIMARY:   0x002868,
  SUCCESS:   0x2ECC71,
  DANGER:    0xBF0A30,
  WARNING:   0xF1C40F,
  SECONDARY: 0x7F8C8D,
  INFO:      0x3498DB,
  GOLD:      0xFFD700,
  NAVY:      0x1A237E
};

const BILL_FORMS = [
  { key: 'federal_law', label: 'Федеральный закон' },
  { key: 'federal_const_law', label: 'Федеральный конституционный закон' },
  { key: 'constitution_amendment', label: 'Проект поправок к Конституции' },
  { key: 'resolution', label: 'Проект постановления/резолюции' }
];
const BILL_FORM_LABELS = BILL_FORMS.reduce((acc, it) => { acc[it.key] = it.label; return acc; }, {});
const QUANT_ITEMS_PAGE_SIZE = 25;

// Таймауты эфемерных сообщений
const TTL_S  = 12000;   // короткие ответы / ошибки
const TTL_M  = 15000;   // подтверждения
const TTL_L  = 120000;  // интерактивные выборы
const TTL_I  = 90000;   // бездействие — закрыть сессию пользователя

const CHAMBER_NAMES       = { senate: '🏛️ Сенат Штата Сан-Андреас' };
const CHAMBER_CHAIR_ROLES = { senate: [ROLES.CHAIRMAN, ROLES.VICE_CHAIR] };
const CHANNEL_TO_CHAMBER  = Object.fromEntries(Object.entries(MEETING_CHANNELS).map(([k, v]) => [v, k]));

const EVENT_LABELS = {
  registration:         { emoji: '📥', title: 'Регистрация законопроекта' },
  vote_result:          { emoji: '🗳️', title: 'Результат голосования' },
  vote_annulled:        { emoji: '🔄', title: 'Голосование аннулировано' },
  vote_forced:          { emoji: '⚡', title: 'Принудительное голосование' },
  governor_review:      { emoji: '📩', title: 'Рассмотрение Губернатором' },
  governor_vetoed:      { emoji: '🚫', title: 'Вето Губернатора' },
  federal_gov_approval: { emoji: '✅', title: 'Подписан Федеральным правительством' },
  federal_gov_return:   { emoji: '↩️', title: 'Возвращён на доработку' },
  agenda_inclusion:     { emoji: '📋', title: 'Включён в повестку' },
  civic_initiative:     { emoji: '🏛️', title: 'Гражданская инициатива' },
  default:              { emoji: '📌', title: 'Событие' }
};

// ═══════════════════════════ STATE ═════════════════════════════════
const voteTimers       = new Map(); // proposalId → intervalId
const meetingTimers    = new Map(); // meetingId  → intervalId
const userSessions     = new Map(); // userId     → { commandName, replyId, channelId, timestamp, timeoutId }
const proceduralVotes  = new Map(); // id         → { ... }
const proceduralTimers = new Map(); // id         → intervalId
const proceduralHistory = new Map(); // id       → { question, for, against, abstain, isSecret, meetingId, startedAt, endedAt }
const agendaExcludeVotes  = new Map(); // id       → { ... }
const agendaExcludeTimers = new Map(); // id       → intervalId
const userMsgQueue = []; // { channelId, messageId, deleteAt }
const replacementTagCache = new Map(); // `${partyKey}:${safe}` → tag

const ERROR_CODE_INFO = {
  'E-AUTH': 'Недостаточно прав для действия.',
  'E-NOTFOUND': 'Запрошенный объект не найден.',
  'E-CHANNEL': 'Канал недоступен или не найден.',
  'E-DATA': 'Данные устарели или повреждены, требуется повторить действие.',
  'E-STATE': 'Операция недоступна в текущем состоянии.',
  'E-CONFIG': 'Ошибка конфигурации или отсутствуют настройки.',
  'E-UNKNOWN': 'Неизвестная ошибка, требуется проверка логов.'
};

// ── partyKey: детерминированный хеш (7 символов) ──────────────────
const partyKeyMap  = new Map();
const PARTY_KEY_LEN = 7;

function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff;
  return (h >>> 0).toString(36).padStart(6, '0');
}
const registerPartyOrg = org => { const k = 'p' + hashStr(org); partyKeyMap.set(k, org); return k; };
const lookupPartyOrg   = key => partyKeyMap.get(key) || null;

async function refreshPartyKeys() {
  partyKeyMap.clear();
  (await getPartyOrgs().catch(() => [])).forEach(o => registerPartyOrg(o));
}

// ── Сессии пользователей ──────────────────────────────────────────
async function trackSession(userId, commandName, replyId = null, timeoutId = null, channelId = null) {
  const old = userSessions.get(userId);
  if (old) {
    if (old.timeoutId) clearTimeout(old.timeoutId);
    if (old.replyId && old.channelId) {
      const ch = await client.channels.fetch(old.channelId).catch(() => null);
      if (ch?.messages) ch.messages.fetch(old.replyId).then(m => m.delete().catch(() => {})).catch(() => {});
    }
  }
  userSessions.set(userId, { commandName, replyId, channelId, timestamp: Date.now(), timeoutId });
}
function clearSession(userId) {
  const s = userSessions.get(userId);
  if (s?.timeoutId) clearTimeout(s.timeoutId);
  userSessions.delete(userId);
}
setInterval(() => {
  const now = Date.now();
  for (const [uid, s] of userSessions) if (now - s.timestamp > TTL_I) clearSession(uid);
}, 30000);

// ── Safe-теги для customId ────────────────────────────────────────
const tagToSafe  = tag  => (!tag || tag === '__none__') ? '__none__' : 't' + hashStr(tag.toLowerCase());
const safeToTag  = (safe, senators) => safe === '__none__' ? null : (senators.find(s => tagToSafe(s.tag) === safe)?.tag || null);
const resolveTagFromSafe = (partyKey, safe, senators) => {
  if (!safe || safe === '__none__') return null;
  const cached = replacementTagCache.get(`${partyKey}:${safe}`);
  if (cached) return cached;
  const found = senators.find(s => s.tag && tagToSafe(s.tag) === safe);
  if (found?.tag) replacementTagCache.set(`${partyKey}:${safe}`, found.tag);
  return found?.tag || null;
};

// ════════════════════════════ CLIENT ═══════════════════════════════
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildPresences, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});
const rest = new REST({ version: '10' }).setToken(TOKEN);

// ════════════════════════════ UTILITY ══════════════════════════════
const isAdmin    = m => [...ADMIN_ROLE_IDS, ...SYSADMIN_ROLE_IDS].some(id => m.roles.cache.has(id));
const isFedGov   = uid => FEDERAL_GOV_IDS.includes(uid);
const isChairman = (m, ch) => (CHAMBER_CHAIR_ROLES[ch] || []).some(id => m.roles.cache.has(id));
const isSenator  = m => [ROLES.SENATOR, ROLES.SENATOR_NV].some(r => r && m.roles.cache.has(r));
const getChamber = cid => CHANNEL_TO_CHAMBER[cid];
const truncate   = (s, max) => s && s.length > max ? s.substring(0, max - 1) + '…' : (s || '');
const discordTs  = (ts, f = 'f') => `<t:${Math.floor(Number(ts) / 1000)}:${f}>`;

function parseCustomDuration(str) {
  const units = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  let ms = 0, m;
  const re = /(\d+)([dhms])/g;
  while ((m = re.exec(str)) !== null) ms += parseInt(m[1]) * units[m[2]];
  return ms || 3600000;
}
function formatTimeLeft(ms) {
  if (ms <= 0) return '0с';
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), min = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d)   return `${d}д ${h}ч`;
  if (h)   return `${h}ч ${min}м`;
  if (min) return `${min}м ${sec}с`;
  return `${sec}с`;
}
function getVoteTypeText(vt) {
  return vt === 'for' ? '✅ За' : vt === 'against' ? '❌ Против' : vt === 'abstain' ? '⚪ Воздержался' : (vt || '?');
}
function getProposalStatusEmoji(status) {
  if (!status) return '•';
  if (status === 'Отозван') return '🗑️';
  if (status === 'Подписан' || status.includes('Подписан')) return '🖊️';
  if (status.startsWith('Принят')) return '✅';
  if (status.includes('Вето')) return '🚫';
  if (status.includes('Отклон') || status.includes('Не принято')) return '❌';
  if (status.includes('Ничья') || status.includes('решающий голос')) return '⚖️';
  return '•';
}
const getFormulaDesc = f => ({ '0': 'Простое большинство', '1': '⅔ голосов', '2': '¾ голосов', '3': 'Большинство от состава' }[f] || 'Простое большинство');
const calcQuorum     = total => Math.floor(total / 2);
async function getActiveMemberCount() { try { return await getActiveSenatorCount(false); } catch { return 56; } }

function buildEmbed(opts = {}) {
  const e = new EmbedBuilder().setColor(opts.color || COLORS.PRIMARY);
  if (opts.timestamp !== false) e.setTimestamp(opts.timestamp || Date.now());
  const footer = opts.footer || { text: FOOTER, iconURL: FOOTER_ICON };
  if (footer?.text) e.setFooter(footer);
  if (opts.author)    e.setAuthor(opts.author);
  if (opts.url)       e.setURL(opts.url);
  if (opts.title)     e.setTitle(opts.title);
  if (opts.description) e.setDescription(opts.description);
  if (opts.thumbnail) e.setThumbnail(opts.thumbnail);
  if (opts.image)     e.setImage(opts.image);
  if (opts.fields)    e.addFields(...opts.fields);
  const rawTitle = opts.title || '';
  const rawDesc  = opts.description || '';
  if ((rawTitle.startsWith('❌') || rawDesc.startsWith('❌')) && !rawTitle.includes('[E-')) {
    const code = resolveErrorCode(`${rawTitle} ${rawDesc}`);
    if (code) e.setTitle(`${rawTitle} [${code}]`);
  }
  return e;
}

function computeVoteCounts(proposalId, stage = 1) {
  let forC = 0, agaC = 0, absC = 0;
  for (const v of db.getVotes(proposalId, stage)) {
    if (v.voteType === 'for') forC++;
    else if (v.voteType === 'against') agaC++;
    else if (v.voteType === 'abstain') absC++;
  }
  return { forCount: forC, againstCount: agaC, abstainCount: absC, totalVoted: forC + agaC + absC };
}

function calcVoteResult(forC, agaC, absC, formula, total) {
  const voted = forC + agaC + absC;
  if (formula === '0') return { req: agaC + 1, isPassed: forC > agaC };
  if (formula === '1') { const req = Math.ceil(voted * 2 / 3); return { req, isPassed: forC >= req }; }
  if (formula === '2') { const req = Math.ceil(voted * 3 / 4); return { req, isPassed: forC >= req }; }
  if (formula === '3') { const req = Math.ceil(total / 2);     return { req, isPassed: forC >= req }; }
  return { req: agaC + 1, isPassed: forC > agaC };
}


async function canUserVote(userId) {
  try {
    const member = await client.guilds.cache.get(GUILD_ID).members.fetch(userId);
    if (!isSenator(member)) return { canVote: false, reason: '❌ Вы не являетесь сенатором.' };
    return { canVote: true };
  } catch { return { canVote: false, reason: '❌ Ошибка при проверке прав.' }; }
}

async function resolveUserByTag(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^<@!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d{15,20}$/.test(s)) return s;
  const username = s.replace(/^@/, '').toLowerCase();
  const cache = getTagToIdCache();
  if (cache.has(username)) return cache.get(username);
  try {
    const guild   = client.guilds.cache.get(GUILD_ID);
    const members = await guild.members.search({ query: username, limit: 10 });
    const found   = members.find(m => m.user.username.toLowerCase() === username || (m.user.globalName || '').toLowerCase() === username || m.displayName.toLowerCase() === username);
    if (found) { setTagId(username, found.user.id); return found.user.id; }
    return null;
  } catch { return null; }
}

function resolveErrorCode(text) {
  const msg = (text || '').toLowerCase();
  if (msg.includes('недостаточно прав') || msg.includes('только') && msg.includes('спикер')) return 'E-AUTH';
  if (msg.includes('не найден') || msg.includes('не найдена') || msg.includes('не найдены')) return 'E-NOTFOUND';
  if (msg.includes('канал') && (msg.includes('недоступ') || msg.includes('не найден'))) return 'E-CHANNEL';
  if (msg.includes('ошибка данных') || msg.includes('данные устарели')) return 'E-DATA';
  if (msg.includes('не активно') || msg.includes('нельзя') || msg.includes('уже запущено')) return 'E-STATE';
  if (msg.includes('не настро') || msg.includes('переменн') || msg.includes('конфиг')) return 'E-CONFIG';
  return 'E-UNKNOWN';
}

function formatErrorText(text) {
  const raw = String(text || '');
  if (!raw.trim().startsWith('❌') || raw.includes('[E-')) return raw;
  const code = resolveErrorCode(raw);
  return `${raw} [${code}]`;
}

function loadUserMsgQueue() {
  try {
    const raw = db.getBotSetting('user_msg_queue');
    if (!raw) return;
    const list = JSON.parse(raw);
    if (Array.isArray(list)) userMsgQueue.push(...list);
  } catch {}
}

function saveUserMsgQueue() {
  try {
    const trimmed = userMsgQueue.slice(-200);
    db.setBotSetting('user_msg_queue', JSON.stringify(trimmed));
  } catch {}
}

function enqueueUserMsg(channelId, messageId, deleteAt) {
  if (!channelId || !messageId) return;
  userMsgQueue.push({ channelId, messageId, deleteAt: deleteAt || (Date.now() + TTL_M) });
  saveUserMsgQueue();
}

async function cleanupUserMessages(forceAll = false) {
  const now = Date.now();
  const remaining = [];
  for (const item of userMsgQueue) {
    if (!item?.channelId || !item?.messageId) continue;
    if (!forceAll && item.deleteAt && item.deleteAt > now) { remaining.push(item); continue; }
    try {
      const ch = await client.channels.fetch(item.channelId).catch(() => null);
      const msg = ch?.messages ? await ch.messages.fetch(item.messageId).catch(() => null) : null;
      if (msg && msg.author?.id === client.user?.id) await msg.delete().catch(() => {});
    } catch {}
  }
  userMsgQueue.length = 0;
  userMsgQueue.push(...remaining);
  saveUserMsgQueue();
}

// ════════════════════════ REPLY HELPERS ════════════════════════════
async function replyEphemeral(interaction, content, delay = TTL_M) {
  try {
    let opts = typeof content === 'string' ? { content } : content;
    if (typeof opts?.content === 'string' && opts.content.trim().startsWith('❌') && !opts.content.includes('[E-')) {
      const code = resolveErrorCode(opts.content);
      opts = { ...opts, content: `${opts.content} [${code}]` };
    }
    const method = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
    if (method === 'reply') await interaction.reply({ ...opts, flags: 64 });
    else                    await interaction.editReply(opts);

    const sent = await interaction.fetchReply().catch(() => null);
    let timeoutId = null;
    if (delay > 0) timeoutId = setTimeout(() => interaction.deleteReply().catch(() => {}), delay);
    if (sent?.id && sent?.channelId) enqueueUserMsg(sent.channelId, sent.id, Date.now() + (delay || TTL_M));
    await trackSession(interaction.user.id, interaction.commandName || 'btn', sent?.id || null, timeoutId, sent?.channelId || interaction.channelId || null);
  } catch {}
}

async function updateEphemeral(interaction, payload, delay = TTL_L) {
  try {
    await interaction.update(payload);
    const sent = await interaction.fetchReply().catch(() => null);
    let timeoutId = null;
    if (delay > 0) timeoutId = setTimeout(() => interaction.deleteReply().catch(() => {}), delay);
    if (sent?.id && sent?.channelId) enqueueUserMsg(sent.channelId, sent.id, Date.now() + (delay || TTL_M));
    await trackSession(interaction.user.id, interaction.commandName || 'btn', sent?.id || null, timeoutId, sent?.channelId || interaction.channelId || null);
  } catch {}
}

async function sendEphemeralChunks(interaction, text, delay = TTL_L) {
  const chunks = [];
  let cur = '';
  for (const line of String(text || '').split('\n')) {
    if ((cur + line + '\n').length > 1800) { chunks.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  if (!chunks.length) { await replyEphemeral(interaction, 'ℹ️ Нет данных.', TTL_S); return; }

  await replyEphemeral(interaction, chunks[0], delay);
  for (let i = 1; i < chunks.length; i++) {
    const msg = await interaction.followUp({ content: chunks[i], flags: 64 }).catch(() => null);
    if (msg) {
      if (delay > 0) setTimeout(() => msg.delete().catch(() => {}), delay);
      enqueueUserMsg(msg.channelId, msg.id, Date.now() + (delay || TTL_M));
    }
  }
}

function formatMentionList(ids) {
  if (!ids.length) return '*нет*';
  return ids.map(id => `<@${id}>`).join('\n');
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildVoteListEmbeds(proposalId, stage = 1, opts = {}) {
  const p = db.getProposal(proposalId);
  if (!p) return null;
  const votes = db.getVotes(proposalId, stage);
  if (!votes.length) return null;
  const voting = db.getVoting(proposalId);

  const headerLines = [
    `**${p.number}** — ${p.name}`,
    `Этап: **${stage}**`,
    `Тип: **${p.isQuantitative ? 'Рейтинговое' : 'Обычное'}**`,
    `Голосование: **${voting?.isSecret ? 'Тайное' : 'Открытое'}**`
  ];
  if (opts.includeSecretWarning && voting?.isSecret) headerLines.push('## ⚠️ ТАЙНОЕ ГОЛОСОВАНИЕ НЕ ПУБЛИКУЙ РЕЗУЛЬТАТЫ');

  const fields = [];
  if (p.isQuantitative) {
    const items = db.getQuantitativeItems(proposalId);
    const itemMap = new Map(items.map(it => [it.itemIndex, it.text]));
    const byItem = new Map(items.map(it => [it.itemIndex, []]));
    const abstain = [];
    for (const v of votes) {
      if (v.voteType.startsWith('item_')) {
        const idx = parseInt(v.voteType.split('_')[1]);
        if (!byItem.has(idx)) byItem.set(idx, []);
        byItem.get(idx).push(v.userId);
      } else if (v.voteType === 'abstain') {
        abstain.push(v.userId);
      }
    }

    const sorted = [...byItem.entries()].sort((a, b) => a[0] - b[0]);
    for (const [idx, voters] of sorted) {
      const title = `📌 Пункт ${idx}${itemMap.get(idx) ? ` — ${truncate(itemMap.get(idx), 80)}` : ''} (${voters.length})`;
      const value = truncate(formatMentionList(voters), 1024);
      fields.push({ name: title, value, inline: false });
    }
    fields.push({ name: `⚪ Воздержались (${abstain.length})`, value: truncate(formatMentionList(abstain), 1024), inline: false });
  } else {
    const grouped = { for: [], against: [], abstain: [] };
    for (const v of votes) {
      if (v.voteType === 'for') grouped.for.push(v.userId);
      else if (v.voteType === 'against') grouped.against.push(v.userId);
      else grouped.abstain.push(v.userId);
    }
    fields.push({ name: `✅ За (${grouped.for.length})`, value: truncate(formatMentionList(grouped.for), 1024), inline: false });
    fields.push({ name: `❌ Против (${grouped.against.length})`, value: truncate(formatMentionList(grouped.against), 1024), inline: false });
    fields.push({ name: `⚪ Воздержались (${grouped.abstain.length})`, value: truncate(formatMentionList(grouped.abstain), 1024), inline: false });
  }

  const embeds = [];
  const fieldChunks = chunkArray(fields, 25);
  fieldChunks.forEach((chunk, idx) => {
    const embed = buildEmbed({
      color: COLORS.WARNING,
      title: idx === 0 ? '🗳️ Поимённое голосование' : '🗳️ Поимённое голосование — продолжение',
      description: idx === 0 ? headerLines.join('\n') : null
    });
    embed.addFields(...chunk);
    embeds.push(embed);
  });

  return embeds.length ? embeds : null;
}

async function sendEphemeralEmbeds(interaction, embeds, delay = TTL_L) {
  const chunks = chunkArray(embeds || [], 10);
  if (!chunks.length) { await replyEphemeral(interaction, 'ℹ️ Нет данных.', TTL_S); return; }

  await replyEphemeral(interaction, { embeds: chunks[0] }, delay);
  for (let i = 1; i < chunks.length; i++) {
    const msg = await interaction.followUp({ embeds: chunks[i], flags: 64 }).catch(() => null);
    if (msg) {
      if (delay > 0) setTimeout(() => msg.delete().catch(() => {}), delay);
      enqueueUserMsg(msg.channelId, msg.id, Date.now() + (delay || TTL_M));
    }
  }
}

// ════════════════════════ VALIDATION ═══════════════════════════════
function validateConfig() {
  const required = ['DISCORD_TOKEN','CLIENT_ID','GUILD_ID','SENATE_CHANNEL_ID','SENATE_MEETING_CHANNEL_ID',
    'FORUM_TAG_ON_REVIEW','FORUM_TAG_APPROVED','FORUM_TAG_REJECTED','FORUM_TAG_NOT_APPROVED','FORUM_TAG_SIGNED','FORUM_TAG_VETOED',
    'SENATOR_ROLE_ID','SENATOR_NO_VOTE_ROLE_ID','CHAIRMAN_ROLE_ID','VICE_CHAIRMAN_ROLE_ID',
    'FEDERAL_GOVERNMENT_USER_ID','ADMIN_ROLE_SEND_ID','SYSADMIN_ROLE_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) { console.error('❌ Отсутствуют переменные окружения:', missing.join(', ')); return false; }
  return true;
}
if (!validateConfig()) process.exit(1);

// ════════════════════════ COMMANDS ═════════════════════════════════
const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Справка по боту'),
  new SlashCommandBuilder().setName('crashinfo').setDescription('Расшифровка кодов ошибок'),
  new SlashCommandBuilder().setName('send').setDescription('Подать законопроект в Сенат'),
  new SlashCommandBuilder().setName('say').setDescription('Отправить сообщение от имени бота')
    .addStringOption(o => o.setName('text').setDescription('Текст сообщения').setRequired(true).setMaxLength(2000))
    .addChannelOption(o => o.setName('channel').setDescription('Канал отправки').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  new SlashCommandBuilder().setName('info').setDescription('не работает - для разработчика')
    .addStringOption(o => o.setName('proposal_id').setDescription('не работает').setRequired(true)),
  new SlashCommandBuilder().setName('vote').setDescription('Принудительно запустить голосование (без повестки)')
    .addStringOption(o => o.setName('proposal_id').setDescription('Номер SA-001').setRequired(true)),
  new SlashCommandBuilder().setName('create_meeting').setDescription('Создать заседание Сената'),
  new SlashCommandBuilder().setName('edit_agenda').setDescription('Редактировать повестку заседания'),
  new SlashCommandBuilder().setName('set').setDescription('Вручную установить количество сенаторов')
    .addIntegerOption(o => o.setName('count').setDescription('Количество').setRequired(true).setMinValue(1).setMaxValue(1000)),
  new SlashCommandBuilder().setName('setup_senate').setDescription('Создать главное сообщение Сената'),
  new SlashCommandBuilder().setName('setup_bills_forum').setDescription('Настроить форум-канал'),
  new SlashCommandBuilder().setName('replace_senator').setDescription('Замена сенатора'),
  new SlashCommandBuilder().setName('refresh_senate').setDescription('Синхронизировать состав из Discord')
].map(c => c.toJSON());

(async () => {
  try { await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands }); console.log('✅ Команды зарегистрированы.'); }
  catch (e) { console.error('❌ Ошибка регистрации команд:', e.message); }
})();

// ════════════════════════ HISTORY ══════════════════════════════════
async function updateHistoryMessage(proposalId) {
  try {
    const p = db.getProposal(proposalId);
    if (!p?.threadId) return;
    const thread = await client.channels.fetch(p.threadId).catch(() => null);
    if (!thread) return;
    const events = (p.events || []).sort((a, b) => a.timestamp - b.timestamp);
    let desc = '';
    for (const ev of events) {
      const { emoji, title } = EVENT_LABELS[ev.type] || EVENT_LABELS.default;
      desc += `${emoji} **${title}**\n⏰ ${discordTs(ev.timestamp, 'f')}\n`;
      if (ev.description) desc += `${ev.description}\n`;
      desc += '━━━━━━━━━━━━━━━━━━\n\n';
    }
    if (!desc) desc = '*История пуста.*';
    if (desc.length > 4096) desc = desc.substring(0, 4090) + '\n*...*';
    const embed = buildEmbed({ color: COLORS.NAVY, title: '📜 Хронология законопроекта', description: desc });
    if (p.historyMessageId) {
      const msg = await thread.messages.fetch(p.historyMessageId).catch(() => null);
      if (msg) { await msg.edit({ embeds: [embed] }); return; }
    }
    const msg = await thread.send({ embeds: [embed] });
    db.updateProposalHistoryMsg(proposalId, msg.id);
  } catch (e) { console.error('❌ updateHistoryMessage:', e.message); }
}

async function addProposalEvent(proposalId, event) {
  try {
    const p = db.getProposal(proposalId);
    if (!p) return;
    db.updateProposalEvents(proposalId, [...(p.events || []), event]);
    await updateHistoryMessage(proposalId);
  } catch (e) { console.error('❌ addProposalEvent:', e.message); }
}

// ════════════════════ SENATE MAIN MESSAGE ══════════════════════════
async function updateSenateMainMessage() {
  try {
    const channelId = db.getBotSetting('senate_msg_channel');
    const msgId     = db.getBotSetting('senate_msg_id');
    if (!channelId || !msgId) return;
    const ch  = await client.channels.fetch(channelId).catch(() => null);
    const msg = ch ? await ch.messages.fetch(msgId).catch(() => null) : null;
    if (!msg) return;
    const { count, text } = await formatSenateRoster();
    await msg.edit({
      embeds: [
        buildEmbed({
          color: COLORS.PRIMARY, title: '🏛️ Сенат Штата Сан-Андреас', thumbnail: FOOTER_ICON,
          description: [
            '## 🇺🇸 Законодательный и представительный орган Штата Сан-Андреас',
            '',
            '**📜 Подача законопроекта:** воспользуйтесь кнопкой **Подать законопроект** ниже',
            '**🏛️ Гражданская инициатива:** нажмите кнопку **Гражданская инициатива** ниже'
          ].join('\n'),
          fields: [
            { name: 'Особая благодарность ответственному за разработку', value: '@treak_', inline: true }
          ]
        }),
        buildEmbed({ color: COLORS.NAVY, title: `👥 Состав Сената — ${count} сенаторов`, description: text })
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('senate_submit_bill').setLabel('📝 Подать законопроект').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('senate_civic_initiative').setLabel('🏛️ Гражданская инициатива').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('senate_replace_senator').setLabel('🔄 Заменить сенатора').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('senate_help_info').setLabel('🧭 Как это работает').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
    moderateSenatorRole().catch(() => {});
  } catch (e) { console.error('❌ updateSenateMainMessage:', e.message); }
}

async function getSenateMainThread() {
  const channelId = db.getBotSetting('senate_msg_channel');
  const msgId     = db.getBotSetting('senate_msg_id');
  if (!channelId || !msgId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  const msg = ch?.messages ? await ch.messages.fetch(msgId).catch(() => null) : null;
  if (!msg) return null;
  const cachedThreadId = db.getBotSetting('senate_msg_thread_id');
  let thread = cachedThreadId ? await client.channels.fetch(cachedThreadId).catch(() => null) : null;
  if (!thread) {
    thread = await msg.startThread({ name: '💬 Замены сенаторов', autoArchiveDuration: 1440 }).catch(() => null);
    if (thread) db.setBotSetting('senate_msg_thread_id', thread.id);
  }
  if (thread?.archived) await thread.setArchived(false).catch(() => {});
  return thread;
}

async function getReplacementUserThread(user) {
  const channelId = db.getBotSetting('senate_msg_channel');
  if (!channelId || !user) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.threads) return null;
  const name = `🔄 Замена сенатора — ${user.username}`;
  let thread = null;
  try {
    const active = await ch.threads.fetchActive().catch(() => null);
    thread = active?.threads?.find(t => t.name === name && t.type === ChannelType.PrivateThread) || null;
  } catch {}
  if (!thread) {
    thread = await ch.threads.create({ name, autoArchiveDuration: 1440, type: ChannelType.PrivateThread }).catch(() => null);
  }
  if (thread) {
    await thread.members.add(user.id).catch(() => {});
    await addSysAdminsToThread(thread);
    if (thread.archived) await thread.setArchived(false).catch(() => {});
  }
  return thread;
}

async function addSysAdminsToThread(thread) {
  if (!thread || !SYSADMIN_ROLE_IDS.length) return;
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) return;
  for (const roleId of SYSADMIN_ROLE_IDS) {
    if (!roleId) continue;
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;
    for (const member of role.members.values()) {
      await thread.members.add(member.id).catch(() => {});
    }
  }
}

async function addUserToThreadByTag(thread, tag) {
  if (!thread || !tag) return;
  const userId = await resolveUserByTag(tag).catch(() => null);
  if (userId) await thread.members.add(userId).catch(() => {});
}

async function sendReplacementMessage(payload) {
  const thread = await getSenateMainThread();
  if (!thread) return null;
  return await thread.send(payload).catch(() => null);
}

const MODERATOR_CACHE = { lastUpdate: 0, ttl: 300000 };
async function moderateSenatorRole() {
  if (!ROLES.SENATOR) return;
  const now = Date.now();
  if (now - MODERATOR_CACHE.lastUpdate < MODERATOR_CACHE.ttl) return;
  MODERATOR_CACHE.lastUpdate = now;
  try {
    const senators = await fetchSenators(true);
    const senatorIds = new Set();
    const cache = getTagToIdCache();
    for (const s of senators) { const id = cache.get(s.tag.toLowerCase()); if (id) senatorIds.add(id); }
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;
    const role = guild.roles.cache.get(ROLES.SENATOR);
    if (!role) return;
    const toAdd = [], toRemove = [];
    for (const member of role.members.values()) if (!senatorIds.has(member.id)) toRemove.push(member);
    for (const id of senatorIds) { const m = await guild.members.fetch(id).catch(() => null); if (m && !m.roles.cache.has(ROLES.SENATOR)) toAdd.push(m); }
    const bs = 10;
    for (let i = 0; i < toAdd.length;    i += bs) await Promise.all(toAdd.slice(i, i + bs).map(m => m.roles.add(ROLES.SENATOR).catch(() => {})));
    for (let i = 0; i < toRemove.length; i += bs) await Promise.all(toRemove.slice(i, i + bs).map(m => m.roles.remove(ROLES.SENATOR).catch(() => {})));
  } catch (e) { console.error('❌ moderateSenatorRole:', e.message); }
}

// ════════════════════════ VOTE STATUS BUTTONS ══════════════════════
async function updateVoteButtonStatus(proposalId) {
  try {
    const p = db.getProposal(proposalId);
    if (!p?.threadId || !p.initialMessageId) return;
    const thread = await client.channels.fetch(p.threadId).catch(() => null);
    if (!thread || thread.archived) return;
    const msg    = await thread.messages.fetch(p.initialMessageId).catch(() => null);
    if (!msg) return;
    const voting = db.getVoting(proposalId);
    let row;
    if (voting?.open) {
      row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`start_voting_${proposalId}`).setLabel('🟢 Голосование идёт').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId(`annul_voting_${proposalId}`).setLabel('🔁 Переголосование').setStyle(ButtonStyle.Secondary)
      );
    } else if (voting && !voting.open) {
      row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`start_voting_${proposalId}`).setLabel('🔁 Повторное голосование').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`annul_voting_${proposalId}`).setLabel('🔁 Переголосование').setStyle(ButtonStyle.Secondary)
      );
    } else {
      row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`start_voting_${proposalId}`).setLabel('🗳️ Начать голосование').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`delete_proposal_${proposalId}`).setLabel('🗑️ Отозвать проект').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`annul_voting_${proposalId}`).setLabel('🔁 Переголосование').setStyle(ButtonStyle.Secondary).setDisabled(true)
      );
    }
    const extraRows = [];
    if (p.isQuantitative) {
      extraRows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`edit_quant_items_${proposalId}`).setLabel('✏️ Редактировать пункты').setStyle(ButtonStyle.Secondary).setDisabled(!!voting?.open)
      ));
    }
    await msg.edit({ components: [row, ...extraRows] }).catch(() => {});
  } catch (e) { if (e.code !== 10003 && e.code !== 10008) console.error('❌ updateVoteButtonStatus:', e.message); }
}

async function closeThreadWithTag(threadId, tagId) {
  try {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread) return;
    const opts = { archived: true, locked: true };
    if (tagId) opts.appliedTags = [tagId];
    await thread.edit(opts).catch(async () => {
      if (tagId) await thread.edit({ appliedTags: [tagId] }).catch(() => {});
      await thread.setArchived(true).catch(() => {});
    });
  } catch (e) { console.error('❌ closeThreadWithTag:', e.message); }
}

// ════════════════════════ MEETING EMBEDS ═══════════════════════════
async function formatAgendaText(meetingId, showResults = false) {
  const agenda = db.getAgenda(meetingId);
  if (!agenda.length) return '*Повестка не сформирована*';
  return agenda.map((p, i) => {
    const link = p.threadId ? `[${p.number}](https://discord.com/channels/${GUILD_ID}/${p.threadId})` : p.number;
    let suf = '';
    if (p.status === 'Отозван') suf = ' ~~[Отозван]~~';
    else if (showResults && p.status && p.status !== 'На рассмотрении') {
      const emoji = getProposalStatusEmoji(p.status);
      if (p.status.startsWith('Принят') || p.status.includes('Подписан')) suf = ` ${emoji} **${p.status}**`;
      else if (p.status === 'Отклонено' || p.status.includes('Не принято')) suf = ` ${emoji} *${p.status}*`;
      else suf = ` — *${p.status}*`;
    }
    return `${i + 1}. ${link} — ${p.name}${suf}`;
  }).join('\n');
}

function buildMeetingControls(meeting, state) {
  if (state === 'planned') return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`start_open_vote_${meeting.id}`).setLabel('🗳️ Запустить голосование за открытие').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`edit_agenda_${meeting.id}`).setLabel('✏️ Повестка').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cancel_meeting_${meeting.id}`).setLabel('🗑️ Отменить заседание').setStyle(ButtonStyle.Danger)
    )
  ];

  if (state === 'opening_vote') return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`meeting_open_vote_for_${meeting.id}`).setLabel('✅ За открытие').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`meeting_open_vote_against_${meeting.id}`).setLabel('❌ Против').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`meeting_open_vote_abstain_${meeting.id}`).setLabel('⚪ Воздержаться').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`close_meeting_vote_${meeting.id}`).setLabel('⏹️ Завершить досрочно').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`edit_agenda_${meeting.id}`).setLabel('✏️ Повестка').setStyle(ButtonStyle.Secondary)
    )
  ];

  if (state === 'in_session') return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`start_close_vote_${meeting.id}`).setLabel('🔚 Голосование за закрытие').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`edit_agenda_${meeting.id}`).setLabel('✏️ Повестка').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`procedural_question_${meeting.id}`).setLabel('⚙️ Процедурный вопрос').setStyle(ButtonStyle.Secondary)
    )
  ];

  if (state === 'closing_vote') return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`meeting_open_vote_for_${meeting.id}`).setLabel('✅ За закрытие').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`meeting_open_vote_against_${meeting.id}`).setLabel('❌ Против').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`meeting_open_vote_abstain_${meeting.id}`).setLabel('⚪ Воздержаться').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`close_meeting_vote_${meeting.id}`).setLabel('⏹️ Завершить досрочно').setStyle(ButtonStyle.Secondary)
    )
  ];

  return [];
}

function buildMeetingMainEmbed(meeting, agendaText, state, counts = {}) {
  if (state === 'planned') {
    const fields = [
      { name: '📜 Повестка заседания', value: agendaText, inline: false },
      { name: '📋 Статус', value: '🕐 Ожидание запуска голосования', inline: true }
    ];
    if (meeting?.meetingDate) fields.splice(1, 0, { name: '🗓️ Дата проведения', value: String(meeting.meetingDate), inline: true });
    return buildEmbed({
      color: COLORS.PRIMARY,
      title: `📋 Заседание назначено — ${meeting.title}`,
      description: '> Для открытия заседания необходимо провести голосование. Нажмите кнопку ниже.',
      fields
    });
  }

  if (state === 'opening_vote') {
    const leftText = counts.expiresAt ? formatTimeLeft(counts.left ?? 0) : '—';
    const endText  = counts.expiresAt ? discordTs(counts.expiresAt, 'R') : 'По завершению вручную';
    return buildEmbed({
      color: COLORS.INFO,
      title: '🗳️ Голосование за открытие заседания',
      description: `**${meeting.title}**\n\n> Решение принимается **простым большинством** голосов. Выберите свою позицию ниже.`,
      fields: [
        { name: '⏳ Осталось', value: leftText, inline: true },
        { name: '🕐 Завершение', value: endText, inline: true },
        { name: '👥 Всего сенаторов', value: String(meeting.totalMembers || 0), inline: true },
        { name: '📊 Кворум', value: String(meeting.quorum || 0), inline: true },
        { name: '✅ За', value: String(counts.forCount ?? 0), inline: true },
        { name: '❌ Против', value: String(counts.againstCount ?? 0), inline: true },
        { name: '⚪ Воздержались', value: String(counts.abstainCount ?? 0), inline: true },
        { name: '📜 Повестка заседания', value: agendaText, inline: false }
      ]
    });
  }

  if (state === 'in_session') {
    const fields = [
      { name: '📜 Повестка заседания', value: agendaText, inline: false }
    ];
    if (meeting.openedAt) fields.unshift({ name: '🕐 Открыто', value: discordTs(meeting.openedAt, 'f'), inline: true });
    return buildEmbed({
      color: COLORS.SUCCESS,
      title: `🏛️ Заседание открыто — ${meeting.title}`,
      description: '## ✅ Заседание ведётся\n\n> Работайте с повесткой. Для закрытия используйте соответствующую кнопку.',
      fields
    });
  }

  if (state === 'closing_vote') {
    const leftText = counts.expiresAt ? formatTimeLeft(counts.left ?? 0) : '—';
    const endText  = counts.expiresAt ? discordTs(counts.expiresAt, 'R') : 'По завершению вручную';
    return buildEmbed({
      color: COLORS.WARNING,
      title: '🔚 Голосование за закрытие заседания',
      description: `**${meeting.title}**\n\n> Для закрытия требуется **простое большинство** голосов.`,
      fields: [
        { name: '⏳ Осталось', value: leftText, inline: true },
        { name: '🕐 Завершение', value: endText, inline: true },
        { name: '👥 Сенаторов', value: String(meeting.totalMembers || 0), inline: true },
        { name: '✅ За', value: String(counts.forCount ?? 0), inline: true },
        { name: '❌ Против', value: String(counts.againstCount ?? 0), inline: true },
        { name: '⚪ Воздержались', value: String(counts.abstainCount ?? 0), inline: true },
        { name: '📜 Итоги повестки', value: agendaText, inline: false }
      ]
    });
  }

  if (state === 'completed') {
    return buildEmbed({
      color: COLORS.GOLD,
      title: `📊 Итоги заседания — ${meeting.title}`,
      description: ['## 🏁 Заседание завершено', counts.resultText || 'Итоги подведены.'].join('\n\n'),
      fields: [
        { name: '📅 Открыто', value: meeting.openedAt ? discordTs(meeting.openedAt, 'f') : '—', inline: true },
        { name: '📅 Закрыто', value: discordTs(Date.now(), 'f'), inline: true },
        { name: '📜 Итоги повестки', value: counts.agendaText || agendaText, inline: false }
      ]
    });
  }

  return buildEmbed({ color: COLORS.PRIMARY, title: `🏛️ Заседание — ${meeting.title}`, description: agendaText });
}

async function refreshMeetingMessage(meetingId) {
  try {
    const meeting = db.getMeeting(meetingId);
    if (!meeting) return;
    const ch  = await client.channels.fetch(meeting.channelId).catch(() => null);
    const msg = ch ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
    if (!msg || !msg.embeds.length) return;
    const showRes    = ['in_session', 'closing_vote'].includes(meeting.status);
    const agendaText = await formatAgendaText(meetingId, showRes);
    const fields = msg.embeds[msg.embeds.length - 1]?.fields || [];
    const lastEmbed = EmbedBuilder.from(msg.embeds[msg.embeds.length - 1]);
    const idx = fields.findIndex(f => f.name.includes('Повестка'));
    if (idx >= 0) {
      fields[idx] = { name: fields[idx].name, value: agendaText, inline: false };
      lastEmbed.setFields(fields);
      await msg.edit({ embeds: [...msg.embeds.slice(0, -1), lastEmbed], components: buildMeetingControls(meeting, meeting.status) }).catch(() => {});
    }
  } catch (e) { console.error('❌ refreshMeetingMessage:', e.message); }
}

// ════════════════════════ TIMERS ═══════════════════════════════════
async function startMeetingTicker(meetingId) {
  if (meetingTimers.has(meetingId)) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); }
  const tick = async () => {
    try {
      const meeting = db.getMeeting(meetingId);
      if (!meeting || (meeting.status !== 'opening_vote' && meeting.status !== 'closing_vote')) {
        clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); return;
      }
      const ch = meeting.channelId ? await client.channels.fetch(meeting.channelId).catch(() => null) : null;
      const announceMsg = ch && meeting.messageId ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
      if (!announceMsg) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); return; }

      if (!meeting.expiresAt) {
        const isClosing = meeting.status === 'closing_vote';
        await announceMsg.edit({
          embeds: [buildMeetingMainEmbed(meeting, await formatAgendaText(meetingId, isClosing), isClosing ? 'closing_vote' : 'opening_vote', {
            left: 0, expiresAt: null,
            forCount: meeting.openVotesFor.length, againstCount: meeting.openVotesAgainst.length, abstainCount: meeting.openVotesAbstain.length
          })],
          components: buildMeetingControls(meeting, isClosing ? 'closing_vote' : 'opening_vote')
        }).catch(() => {});
        return;
      }

      const left = meeting.expiresAt - Date.now();
      if (left <= 0) {
        clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId);
        const { openVotesFor: f, openVotesAgainst: a, openVotesAbstain: b } = meeting;
        if (meeting.status === 'opening_vote') {
          if (f.length > a.length) await openMeetingSession(meetingId, db.getMeeting(meetingId), f, a, b);
          else await closeMeetingSessionVote(meetingId, db.getMeeting(meetingId), f, a, b);
        } else {
          await finalizeMeetingCloseVote(meetingId);
        }
        return;
      }

      const isClosing  = meeting.status === 'closing_vote';
      const agendaText = await formatAgendaText(meetingId, isClosing);
      await announceMsg.edit({
        embeds: [buildMeetingMainEmbed(meeting, agendaText, isClosing ? 'closing_vote' : 'opening_vote', {
          left, expiresAt: meeting.expiresAt,
          forCount: meeting.openVotesFor.length, againstCount: meeting.openVotesAgainst.length, abstainCount: meeting.openVotesAbstain.length
        })],
        components: buildMeetingControls(meeting, isClosing ? 'closing_vote' : 'opening_vote')
      }).catch(() => {});
    } catch (e) {
      if (e.code === 10008 || e.code === 10003) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); }
      else console.error('❌ meetingTicker:', e.message);
    }
  };
  await tick();
  const m = db.getMeeting(meetingId);
  if (m?.expiresAt) meetingTimers.set(meetingId, setInterval(tick, 1000));
}

async function startVoteTicker(proposalId) {
  if (voteTimers.has(proposalId)) { clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId); }
  let lastUpdate = Date.now(), lastCount = 0;
  const tick = async () => {
    try {
      const p = db.getProposal(proposalId), voting = db.getVoting(proposalId);
      if (!p || !voting?.open) { clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId); return; }
      if (!voting.durationMs || !voting.expiresAt) return;
      const left = voting.expiresAt - Date.now();
      const thread = await client.channels.fetch(p.threadId).catch(() => null);
      if (!thread) { clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId); return; }
      if (left <= 0) {
        clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId);
        await finalizeVote(proposalId); return;
      }
      const curCount = db.getVotes(proposalId, voting.stage || 1).length;
      if (Date.now() - lastUpdate < 2000 && curCount === lastCount) return;
      lastUpdate = Date.now(); lastCount = curCount;

      const msgId   = voting.stage === 2 && voting.runoffMessageId ? voting.runoffMessageId : voting.messageId;
      const voteMsg = msgId ? await thread.messages.fetch(msgId).catch(() => null) : null;
      if (!voteMsg) return;

      if (p.isQuantitative) {
        const items = db.getQuantitativeItems(proposalId);
        const vbi = {}; items.forEach(it => { vbi[it.itemIndex] = 0; });
        for (const v of db.getVotes(proposalId, voting.stage || 1)) if (v.voteType.startsWith('item_')) { const idx = parseInt(v.voteType.split('_')[1]); vbi[idx] = (vbi[idx] || 0) + 1; }
        const fields = [
          { name: '⏳ Осталось', value: formatTimeLeft(left), inline: true },
          { name: '🕐 Завершение', value: discordTs(voting.expiresAt, 'R'), inline: true },
          { name: '🔒 Тип', value: voting.isSecret ? '🔐 Тайное' : '👁️ Открытое', inline: true }
        ];
        for (const item of items) fields.push({ name: `📌 Пункт ${item.itemIndex}`, value: `${vbi[item.itemIndex] || 0} голосов`, inline: false });
        await voteMsg.edit({ content: null, embeds: [buildEmbed({ color: COLORS.INFO, title: `🗳️ Голосование — ${p.number}${voting.stage === 2 ? ' · II тур' : ''}`, description: `**${p.name}**`, fields })] }).catch(() => {});
      } else {
        const { forCount, againstCount, abstainCount, totalVoted } = computeVoteCounts(proposalId, voting.stage || 1);
        await voteMsg.edit({ content: null, embeds: [buildEmbed({
          color: COLORS.INFO,
          title: `🗳️ Голосование — ${p.number}${voting.stage === 2 ? ' · II тур' : ''}`,
          description: `**${p.name}**`,
          fields: [
            { name: '⏳ Осталось',      value: formatTimeLeft(left),              inline: true },
            { name: '🕐 Завершение',    value: discordTs(voting.expiresAt, 'R'), inline: true },
            { name: '🔒 Тип',           value: voting.isSecret ? '🔐 Тайное' : '👁️ Открытое', inline: true },
            { name: '📊 Формула',       value: getFormulaDesc(voting.formula),    inline: true },
            { name: '✅ За',            value: String(forCount),     inline: true },
            { name: '❌ Против',        value: String(againstCount), inline: true },
            { name: '⚪ Воздержалось',  value: String(abstainCount), inline: true },
            { name: '📊 Проголосовало', value: String(totalVoted),   inline: true }
          ]
        })] }).catch(() => {});
      }
    } catch (e) { if (e.code !== 10003 && e.code !== 10008) console.error('❌ voteTicker:', e.message); }
  };
  await tick();
  voteTimers.set(proposalId, setInterval(tick, 1000));
}

async function restoreAllTimers() {
  console.log('🔄 Восстановление таймеров...');
  await refreshPartyKeys();
  for (const m of db.getOpenMeetings()) await startMeetingTicker(m.id).catch(() => {});
  for (const v of db.getOpenVotings()) await startVoteTicker(v.proposalId || v.id).catch(() => {});
  console.log('✅ Таймеры восстановлены');
}

// ════════════════════════ SLASH COMMANDS ═══════════════════════════
async function handleSlashCommand(interaction) {
  const c = interaction.commandName;
  trackSession(interaction.user.id, c, null, null, interaction.channelId);
  if      (c === 'help')              await showHelp(interaction);
  else if (c === 'crashinfo')         await handleCrashInfo(interaction);
  else if (c === 'send')              await showSendForm(interaction);
  else if (c === 'say')               await handleSayCommand(interaction);
  else if (c === 'create_meeting')    await createMeeting(interaction);
  else if (c === 'edit_agenda')       await handleEditAgendaCommand(interaction);
  else if (c === 'set')               await setChamberMembers(interaction);
  else if (c === 'info')              await handleInfoCommand(interaction);
  else if (c === 'vote')              await handleForceVoteCommand(interaction);
  else if (c === 'setup_senate')      await setupSenateMessage(interaction);
  else if (c === 'setup_bills_forum') await setupBillsForum(interaction);
  else if (c === 'replace_senator')   await handleReplaceSenatorCommand(interaction);
  else if (c === 'refresh_senate')    await handleRefreshSenate(interaction);
}

async function showHelp(interaction) {
  await interaction.deferReply({ flags: 64 });
  const m = interaction.member;
  const lines = ['## 📖 Справочник команд'];
  if (isSenator(m) || isAdmin(m)) lines.push('**Для сенаторов:**\n`/send` — подать законопроект\n`/replace_senator` — замена/добавление сенатора');
  if (isChairman(m, 'senate') || isAdmin(m)) lines.push('**Для Спикера:**\n`/create_meeting` — создать заседание\n`/edit_agenda` — редактировать повестку\n`/vote <SA-xxx>` — принудительное голосование\n`/set` — установить состав вручную\n`/setup_senate` — создать главное сообщение\n`/refresh_senate` — синхронизировать состав из Discord\n`/say` — отправить сообщение от имени бота\n`/info <SA-xxx>` — поимённый список в ЛС');
  lines.push('**Диагностика:**\n`/crashinfo` — расшифровка кодов ошибок');
  lines.push('**Формулы голосования:** `0` — простое большинство · `1` — ⅔ · `2` — ¾ · `3` — большинство от состава');
  await replyEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '📖 Справка', description: lines.join('\n\n') })] }, TTL_L);
}

async function handleCrashInfo(interaction) {
  const lines = Object.entries(ERROR_CODE_INFO).map(([code, desc]) => `**${code}** — ${desc}`);
  await replyEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '🧩 Коды ошибок', description: lines.join('\n') })] }, TTL_M);
}

async function handleSayCommand(interaction) {
  if (!isAdmin(interaction.member) && !isChairman(interaction.member, 'senate')) { await replyEphemeral(interaction, '❌ Недостаточно прав для выполнения этой команды.', TTL_S); return; }
  const text = (interaction.options.getString('text', false) || '').trim();
  if (!text) { await replyEphemeral(interaction, '❌ Укажите текст сообщения.', TTL_S); return; }
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (!channel || typeof channel.send !== 'function') { await replyEphemeral(interaction, '❌ Канал для отправки недоступен.', TTL_S); return; }
  try {
    await channel.send({ content: text });
    await replyEphemeral(interaction, '✅ Сообщение успешно отправлено.', TTL_S);
  } catch (e) { await replyEphemeral(interaction, `❌ Ошибка при отправке: ${e.message}`, TTL_S); }
}

async function showSendForm(interaction) {
  if (!isSenator(interaction.member) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Подавать законопроекты могут только сенаторы.', TTL_S); return; }
  await showCoauthorSelect(interaction);
}

async function showCoauthorSelect(interaction) {
  const senators = await fetchSenators();
  const myId     = interaction.user.id;
  const cache    = getTagToIdCache();
  const options  = senators
    .filter(s => s.tag && cache.get(s.tag.toLowerCase()) !== myId)
    .slice(0, 25)
    .map(s => {
      const resolvedId = cache.get(s.tag.toLowerCase()) || s.tag;
      const opt = new StringSelectMenuOptionBuilder().setLabel(truncate(s.name || s.tag, 100)).setValue(resolvedId);
      if (s.partyOrg) opt.setDescription(truncate(s.partyOrg, 100));
      return opt;
    });
  if (!options.length) { await showVoteTypeSelect(interaction, []); return; }
  const payload = {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '📝 Подача законопроекта — Шаг 1 из 3', description: 'Выберите соавторов из списка или пропустите этот шаг.' })],
    components: [
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('coauthor_select').setPlaceholder('Выберите соавторов (необязательно)').setMinValues(0).setMaxValues(Math.min(options.length, 5)).addOptions(options)),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('coauthor_skip').setLabel('⏭️ Продолжить без соавторов').setStyle(ButtonStyle.Secondary))
    ]
  };
  await replyEphemeral(interaction, payload, TTL_L);
}

async function showVoteTypeSelect(interaction, coauthors) {
  const coStr = coauthors.length ? coauthors.join(',') : '__none__';
  const payload = {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '📝 Подача законопроекта — Шаг 2 из 3', description: 'Выберите тип голосования для подаваемого законопроекта.' })],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`vote_type_select_${coStr}`).setPlaceholder('Выберите тип голосования').addOptions(
        new StringSelectMenuOptionBuilder().setLabel('📋 Обычное голосование').setDescription('За / Против / Воздержался').setValue('regular'),
        new StringSelectMenuOptionBuilder().setLabel('📊 Рейтинговое голосование').setDescription('Голосование по пунктам повестки').setValue('quantitative')
      )
    )]
  };
  await replyEphemeral(interaction, payload, TTL_L);
}

async function showBillFormSelect(interaction, coStr) {
  const options = BILL_FORMS.map(it => new StringSelectMenuOptionBuilder().setLabel(it.label).setValue(it.key));
  const payload = {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '📝 Подача законопроекта — Шаг 3 из 3', description: 'Выберите форму законопроекта.' })],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`bill_form_select_${coStr}`).setPlaceholder('Форма законопроекта').addOptions(options)
    )]
  };
  await replyEphemeral(interaction, payload, TTL_L);
}

function buildProposalModal(coStr, voteType, billForm) {
  const modal = new ModalBuilder().setCustomId(`send_modal|${coStr}|senate|${voteType}|${billForm || 'none'}`)
    .setTitle(voteType === 'regular' ? '📝 Подача законопроекта' : '📊 Рейтинговое голосование');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proj_name').setLabel('Наименование законопроекта').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proj_link').setLabel('Ссылка на документ законопроекта').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500))
  );
  if (voteType === 'quantitative') modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('items').setLabel('Пункты голосования (через ;)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Пункт 1; Пункт 2; Пункт 3').setMaxLength(2000)));
  return modal;
}

async function handleProposalModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  try {
    const rest2    = interaction.customId.replace(/^send_modal[_|]/, '');
    let billForm = 'none', voteType = 'regular', chamber = 'senate', coStr = '__none__';
    if (rest2.startsWith('|') || rest2.includes('|')) {
      const parts = rest2.split('|').filter(Boolean);
      coStr = parts[0] || '__none__';
      chamber = parts[1] || 'senate';
      voteType = parts[2] || 'regular';
      billForm = parts[3] || 'none';
    } else {
      const parts = rest2.split('_');
      billForm = parts[parts.length - 1];
      voteType = parts[parts.length - 2];
      chamber = parts[parts.length - 3];
      coStr = parts.slice(0, -3).join('_');
    }
    if (!CHAMBER_CHANNELS[chamber]) { await replyEphemeral(interaction, '❌ Палата не найдена.', TTL_S); return; }
    const coauthors    = coStr && coStr !== '__none__' ? coStr.split(',').filter(Boolean) : [];
    const forumChannel = await client.channels.fetch(BILLS_FORUM_CHANNEL_ID || CHAMBER_CHANNELS[chamber]).catch(() => null);
    if (!forumChannel) { await replyEphemeral(interaction, '❌ Форум-канал недоступен.', TTL_S); return; }
    const name = interaction.fields.getTextInputValue('proj_name').trim();
    const link = interaction.fields.getTextInputValue('proj_link').trim();
    if (!name || !link) { await replyEphemeral(interaction, '❌ Пожалуйста, заполните все обязательные поля.', TTL_S); return; }
    let partyOrg = await getSenatorPartyOrg(interaction.user.id).catch(() => null) || '';
    if (partyOrg.length > 100) partyOrg = truncate(partyOrg, 100);
    const number = db.getNextProposalNumber();
    const id     = nanoid(8);
    const now    = Date.now();
    const authorTag    = `<@${interaction.user.id}>`;
    const coauthorTags = coauthors.map(c => `<@${c}>`).join(', ');
    const billFormLabel = billForm && billForm !== 'none' ? BILL_FORM_LABELS[billForm] : '';
    db.createProposal({ id, number, name, partyOrg, link, billForm: billFormLabel || '', chamber, status: 'На рассмотрении', createdAt: now, authorId: interaction.user.id, isQuantitative: voteType === 'quantitative', coauthors,
      events: [{ type: 'registration', chamber, timestamp: now, description: `Внесён в ${CHAMBER_NAMES[chamber]}.\nАвтор: ${authorTag}${coauthorTags ? `\nСоавторы: ${coauthorTags}` : ''}${billFormLabel ? `\nФорма: ${billFormLabel}` : ''}` }] });
    if (voteType === 'quantitative') {
      (interaction.fields.getTextInputValue('items') || '').split(';').map(s => s.trim()).filter(Boolean)
        .forEach((text, i) => db.addQuantitativeItem({ proposalId: id, itemIndex: i + 1, text }));
    }
    const fields = [
      { name: '📝 Наименование', value: name, inline: false },
      { name: '👤 Автор', value: authorTag, inline: true },
      { name: '📅 Зарегистрирован', value: discordTs(now, 'f'), inline: true },
      { name: '🔗 Документ', value: `[Открыть документ](${link})`, inline: true },
      { name: '📊 Статус', value: 'На рассмотрении', inline: true }
    ];
    if (partyOrg)    fields.splice(1, 0, { name: '🏛️ Фракция / Орг.', value: partyOrg, inline: true });
    if (billFormLabel) fields.splice(2, 0, { name: '📄 Форма', value: billFormLabel, inline: true });
    if (coauthorTags) fields.push({ name: '✍️ Соавторы', value: coauthorTags, inline: false });
    const threadMsg = await forumChannel.threads.create({
      name: truncate(`${number} — ${name}`, 100),
      appliedTags: FORUM_TAGS.ON_REVIEW ? [FORUM_TAGS.ON_REVIEW] : [],
      message: {
        embeds: [buildEmbed({
          color: COLORS.PRIMARY,
          title: `📋 ${number}${voteType === 'quantitative' ? ' · Рейтинговое' : ''}`,
          description: ['## 🧾 Законопроект зарегистрирован', `**Палата:** ${CHAMBER_NAMES[chamber]}`, '', '> Ожидайте включения в повестку заседания и запуска голосования.'].join('\n'),
          fields
        })],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`start_voting_${id}`).setLabel('🗳️ Начать голосование').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`delete_proposal_${id}`).setLabel('🗑️ Отозвать проект').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`annul_voting_${id}`).setLabel('🔁 Переголосование').setStyle(ButtonStyle.Secondary).setDisabled(true)
          ),
          ...(voteType === 'quantitative'
            ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`edit_quant_items_${id}`).setLabel('✏️ Редактировать пункты').setStyle(ButtonStyle.Secondary))]
            : [])
        ]
      }
    });
    const starterMsg = await threadMsg.fetchStarterMessage().catch(() => null);
    if (starterMsg) db.updateProposalInitialMsg(id, starterMsg.id);
    db.updateProposalThread(id, threadMsg.id);
    if (voteType === 'quantitative') {
      const items = db.getQuantitativeItems(id);
      if (items.length) {
        const ie = buildEmbed({ color: COLORS.INFO, title: `📊 Структура рейтингового голосования — ${number}` });
        items.forEach((it, i) => ie.addFields({ name: `📌 Пункт ${i + 1}`, value: it.text, inline: false }));
        await threadMsg.send({ embeds: [ie] });
      }
    }
    await updateHistoryMessage(id);
    await replyEphemeral(interaction, `✅ Законопроект **${number}** успешно зарегистрирован: ${threadMsg.url}`, TTL_M);
  } catch (e) { console.error('❌ handleProposalModal:', e); await replyEphemeral(interaction, '❌ Ошибка при регистрации: ' + e.message, TTL_S); }
}

// ════════════════════ CIVIC INITIATIVE ═════════════════════════════
async function handleCivicInitiativeButton(interaction) {
  const modal = new ModalBuilder().setCustomId('civic_initiative_modal').setTitle('🏛️ Гражданская инициатива');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ci_description').setLabel('Описание инициативы').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Опишите своё видение инициативы, её цели и обоснование...').setMaxLength(2000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ci_laws').setLabel('Затрагиваемые законы / правовые нормы').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Укажите нормы, которые должны быть приняты или изменены...').setMaxLength(1000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ci_links').setLabel('Ссылки на документы (необязательно)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('https://... (по одной ссылке на строку)').setMaxLength(1000))
  );
  await interaction.showModal(modal);
}

async function handleCivicInitiativeModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const channelId = CIVIC_INITIATIVE_CHANNEL_ID;
  if (!channelId) { await replyEphemeral(interaction, '❌ Канал гражданских инициатив не настроен (CIVIC_INITIATIVE_CHANNEL_ID).', TTL_S); return; }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) { await replyEphemeral(interaction, '❌ Канал инициатив недоступен.', TTL_S); return; }
  const description = interaction.fields.getTextInputValue('ci_description').trim();
  const laws        = interaction.fields.getTextInputValue('ci_laws').trim();
  const links       = interaction.fields.getTextInputValue('ci_links').trim();
  const now = Date.now();
  const fields = [
    { name: '📋 Описание инициативы', value: description, inline: false },
    { name: '⚖️ Затрагиваемые законы', value: laws, inline: false },
    { name: '👤 Автор', value: `<@${interaction.user.id}>`, inline: true },
    { name: '📅 Дата подачи', value: discordTs(now, 'f'), inline: true }
  ];
  if (links) fields.push({ name: '🔗 Прилагаемые документы', value: links, inline: false });
  try {
    await ch.send({ embeds: [buildEmbed({ color: COLORS.GOLD, title: '🏛️ Гражданская инициатива', description: '> Обращение гражданина к законодательному органу штата.', fields })] });
    await replyEphemeral(interaction, '✅ Ваша гражданская инициатива успешно направлена в Сенат. Сенаторы рассмотрят её при ближайшей возможности.', TTL_M);
  } catch (e) { await replyEphemeral(interaction, '❌ Ошибка при отправке инициативы: ' + e.message, TTL_S); }
}

// ════════════════════════ SETUP ════════════════════════════════════
async function setupBillsForum(interaction) {
  if (!isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только администраторы.', TTL_S); return; }
  const forumId = BILLS_FORUM_CHANNEL_ID || interaction.channelId;
  let forum;
  try { forum = await client.channels.fetch(forumId); } catch { await replyEphemeral(interaction, '❌ Укажите BILLS_FORUM_CHANNEL_ID в .env.', TTL_S); return; }
  if (forum.type !== ChannelType.GuildForum) { await replyEphemeral(interaction, '❌ Требуется форум-канал.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  try {
    const thread = await forum.threads.create({
      name: '📋 Порядок подачи законопроектов',
      message: {
        embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '🏛️ Законодательный портал — Сенат Штата Сан-Андреас', thumbnail: FOOTER_ICON,
          description: ['## 📜 Подача законопроектов', '', '**Жизненный цикл:**', '`📥 Регистрация` → `📋 Повестка` → `🗳️ Голосование` → `📩 Губернатор` → `🏛️ Фед. правительство` → `🖊️ Подписан`', '', '### 🧭 Ключевые правила', '— Голосование запускается только после включения в повестку заседания.'].join('\n') })],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('senate_submit_bill').setLabel('📝 Подать законопроект').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('senate_help_info').setLabel('🧭 Как это работает').setStyle(ButtonStyle.Secondary)
        )]
      },
      appliedTags: FORUM_TAGS.ON_REVIEW ? [FORUM_TAGS.ON_REVIEW] : []
    });
    await thread.setLocked(true).catch(() => {});
    await replyEphemeral(interaction, `✅ Опубликовано: ${thread.url}`, TTL_M);
  } catch (e) { await replyEphemeral(interaction, '❌ Ошибка: ' + e.message, TTL_S); }
}

async function setupSenateMessage(interaction) {
  if (!isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только администраторы.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  const { count, text } = await formatSenateRoster();
  const msg = await interaction.channel.send({
    embeds: [
      buildEmbed({ color: COLORS.PRIMARY, title: '🏛️ Сенат Штата Сан-Андреас', thumbnail: FOOTER_ICON,
        description: ['## 🇺🇸 Официальный законодательный орган Штата Сан-Андреас', '', '**⚖️ Полномочия:** принятие законов, утверждение бюджета, формирование повестки заседаний', '', '**📜 Подача законопроекта:** воспользуйтесь кнопкой ниже и заполните форму', '**🏛️ Гражданская инициатива:** нажмите кнопку ниже и опишите свою инициативу'].join('\n'),
        fields: [{ name: 'Орган', value: 'Сенат Штата Сан-Андреас', inline: true }, { name: 'Государство', value: 'США', inline: true }, { name: 'Поддержка', value: 'Республиканская партия США', inline: true }]
      }),
      buildEmbed({ color: COLORS.NAVY, title: `👥 Состав Сената — ${count} сенаторов`, description: text })
    ],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('senate_submit_bill').setLabel('📝 Подать законопроект').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('senate_civic_initiative').setLabel('🏛️ Гражданская инициатива').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('senate_replace_senator').setLabel('🔄 Заменить сенатора').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('senate_help_info').setLabel('🧭 Как это работает').setStyle(ButtonStyle.Secondary)
    )]
  });
  db.setBotSetting('senate_msg_channel', interaction.channelId);
  db.setBotSetting('senate_msg_id', msg.id);
  await replyEphemeral(interaction, `✅ Главное сообщение создано: ${msg.url}`, TTL_M);
}

async function setChamberMembers(interaction) {
  await interaction.deferReply({ flags: 64 });
  if (!isAdmin(interaction.member) && !isChairman(interaction.member, 'senate')) { await replyEphemeral(interaction, '❌ Недостаточно прав.', TTL_S); return; }
  const count = interaction.options.getInteger('count'), quorum = calcQuorum(count);
  for (const m of db.getOpenMeetings()) db.updateMeeting(m.id, { totalMembers: count, quorum });
  await replyEphemeral(interaction, `✅ Состав обновлён: **${count}** сенаторов. Кворум: **${quorum}**.`, TTL_M);
}

async function handleRefreshSenate(interaction) {
  if (!isAdmin(interaction.member) && !isChairman(interaction.member, 'senate')) { await replyEphemeral(interaction, '❌ Недостаточно прав.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  await syncSenatorsFromDiscordRole(ROLES.SENATOR).catch(() => {});
  await fetchSenators(true);
  await refreshPartyKeys();
  await updateSenateMainMessage();
  await replyEphemeral(interaction, `✅ Состав синхронизирован: **${await getActiveMemberCount()}** сенаторов.`, TTL_M);
}

async function handleInfoCommand(interaction) {
  const isDm = interaction.channel?.type === ChannelType.DM;
  await interaction.deferReply(isDm ? {} : { flags: 64 });

  const sendInfoReply = async (payload, delay = TTL_S) => {
    const method = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
    const opts = method === 'reply' && !isDm ? { ...payload, flags: 64 } : payload;
    await interaction[method](opts);
    if (delay > 0) setTimeout(() => interaction.deleteReply().catch(() => {}), delay);
  };

  if (isDm) { await sendInfoReply({ content: '❌ Команда доступна только на сервере.' }); return; }
  const member = interaction.member;
  if (!member || !isAdmin(member)) { await sendInfoReply({ content: '❌ Недостаточно прав.' }); return; }

  const num = interaction.options.getString('proposal_id', true).trim().toUpperCase();
  const p = db.getAllProposals().find(x => x.number === num);
  if (!p) { await sendInfoReply({ content: `❌ Законопроект **${num}** не найден.` }); return; }
  const votesAll = db.getVotesAllStages(p.id);
  if (!votesAll.length) { await sendInfoReply({ content: '❌ Голосов не обнаружено.' }); return; }

  const stages = [...new Set(votesAll.map(v => v.stage))].sort((a, b) => a - b);
  const embeds = [];
  stages.forEach((stage, idx) => {
    const part = buildVoteListEmbeds(p.id, stage, { includeSecretWarning: idx === 0 });
    if (part?.length) embeds.push(...part);
  });
  if (!embeds.length) { await sendInfoReply({ content: 'ℹ️ Поимённый список не найден.' }); return; }

  try {
    const chunks = chunkArray(embeds, 10);
    const first = chunks.shift();
    await interaction.user.send({ embeds: first });
    for (const chunk of chunks) await interaction.user.send({ embeds: chunk });
    await replyEphemeral(interaction, '✅ Список отправлен в личные сообщения.', TTL_M);
  } catch {
    await replyEphemeral(interaction, '❌ Не удалось отправить ЛС. Проверьте настройки приватности.', TTL_M);
  }
}

// ════════════════════════ FORCE VOTE ═══════════════════════════════
async function handleForceVoteCommand(interaction) {
  if (!isChairman(interaction.member, 'senate') && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const num = interaction.options.getString('proposal_id').trim().toUpperCase();
  const proposals = db.getAllProposals().filter(p => p.number === num);
  if (!proposals.length) { await replyEphemeral(interaction, `❌ Законопроект **${num}** не найден.`, TTL_S); return; }
  const p = proposals[0];
  if (db.getVoting(p.id)?.open) { await replyEphemeral(interaction, '❌ Голосование по этому законопроекту уже идёт.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`force_vote_modal_${p.id}`).setTitle(`Принудительное голосование — ${num}`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('force_reason').setLabel('Основание для принудительного запуска').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_duration').setLabel('Время голосования (1h / 30m / 0 = вручную)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('1h / 30m / 0').setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_secret').setLabel('Тайное голосование? (0 — нет, 1 — да)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_formula').setLabel('Формула: 0=больш, 1=⅔, 2=¾, 3=состав').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1))
  );
  await interaction.showModal(modal);
}

async function handleForceVoteModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid    = interaction.customId.replace('force_vote_modal_', '');
  const reason = interaction.fields.getTextInputValue('force_reason');
  const rawDur = interaction.fields.getTextInputValue('vote_duration').trim();
  const ms     = rawDur === '0' ? 0 : parseCustomDuration(rawDur);
  const isSecret = interaction.fields.getTextInputValue('vote_secret').trim() === '1';
  const fInput   = interaction.fields.getTextInputValue('vote_formula').trim();
  const formula  = ['0','1','2','3'].includes(fInput) ? fInput : '0';
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  await launchVoting(interaction, p, ms, isSecret, formula, true, reason);
}

// ════════════════════ MEETING CREATION ═════════════════════════════
async function createMeeting(interaction) {
  const chamber = getChamber(interaction.channelId);
  if (!chamber) { await replyEphemeral(interaction, '❌ Используйте команду в канале заседаний.', TTL_S); return; }
  if (!isChairman(interaction.member, chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер может создавать заседания.', TTL_S); return; }
  const pending = db.getPendingProposals();
  if (!pending.length) { await replyEphemeral(interaction, '❌ Нет законопроектов в статусе «На рассмотрении».', TTL_S); return; }
  await replyEphemeral(interaction, {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '📋 Создание заседания — Шаг 1', description: 'Выберите законопроекты для включения в повестку заседания.' })],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`meeting_agenda_select_${chamber}`)
        .setPlaceholder('Выберите законопроекты').setMinValues(1).setMaxValues(Math.min(pending.length, 10))
        .addOptions(pending.map(p => new StringSelectMenuOptionBuilder().setLabel(truncate(`${p.number} — ${p.name}`, 100)).setValue(p.id).setDescription(truncate(p.name, 100))))
    )]
  }, TTL_L);
}

async function createMeetingFromSelection(interaction, chamber, selectedIds) {
  const modal = new ModalBuilder().setCustomId(`meeting_details_${chamber}|${selectedIds.join('|')}`).setTitle('Создание заседания');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('meeting_title').setLabel('Наименование заседания').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Внеочередное заседание').setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('meeting_date').setLabel('Дата и время (необязательно)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('2026-05-10 19:00 или «сейчас»').setMaxLength(100))
  );
  await interaction.showModal(modal);
}

async function handleMeetingDetailsModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const parts       = interaction.customId.split('|');
  const chamber     = parts[0].replace('meeting_details_', '');
  const proposalIds = parts.slice(1).filter(Boolean);
  const title       = interaction.fields.getTextInputValue('meeting_title');
  const meetingDateInput = interaction.fields.getTextInputValue('meeting_date') || '—';
  const totalMembers = await getActiveMemberCount();
  const quorum       = calcQuorum(totalMembers);
  const id           = nanoid(8);
  const now          = Date.now();
  db.createMeeting({ id, title, meetingDate: meetingDateInput, chamber, channelId: interaction.channelId, messageId: null, threadId: null, createdAt: now, durationMs: 0, expiresAt: 0, open: false, quorum, totalMembers, status: 'planned', openedAt: null });
  db.updateMeetingSpeaker(id, interaction.user.id);
  for (const pid of proposalIds) {
    if (!pid.trim() || !db.proposalExists(pid.trim())) continue;
    db.addToAgenda(id, pid.trim());
    await addProposalEvent(pid.trim(), { type: 'agenda_inclusion', timestamp: now, chamber, description: `Включён в повестку «${title}»` });
  }
  const agendaText   = await formatAgendaText(id);
  const mentionRole  = MEETING_MENTION_ROLES[chamber];
  const payload = {
    content: mentionRole ? `<@&${mentionRole}>` : null,
    embeds: [buildMeetingMainEmbed({ id, title, meetingDate: meetingDateInput, quorum, totalMembers }, agendaText, 'planned')],
    components: buildMeetingControls({ id }, 'planned')
  };
  const announceMsg = await interaction.channel.send(payload);
  db.updateMeetingMessage(id, announceMsg.id);
  await replyEphemeral(interaction, `✅ Заседание создано. Запустите голосование кнопкой под повесткой: ${announceMsg.url}`, TTL_M);
}

// ════════════════════ MEETING VOTE HANDLERS ════════════════════════
async function handleStartOpeningVoteButton(interaction) {
  const meetingId = interaction.customId.replace('start_open_vote_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  if (meeting.status !== 'planned' && meeting.status !== 'not_opened') { await replyEphemeral(interaction, '❌ Голосование уже было запущено.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`opening_vote_modal_${meetingId}`).setTitle('Запуск голосования за открытие');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_duration').setLabel('Время голосования').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('10m / 30m / 0 = вручную').setMaxLength(20)));
  await interaction.showModal(modal);
}

async function handleOpeningVoteModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const meetingId  = interaction.customId.replace('opening_vote_modal_', '');
  const rawDur     = interaction.fields.getTextInputValue('vote_duration').trim();
  const durationMs = rawDur === '0' ? 0 : parseCustomDuration(rawDur);
  const meeting    = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  const now = Date.now();
  db.saveMeetingOpenVotes(meetingId, [], [], []);
  db.updateMeeting(meetingId, { status: 'opening_vote', open: true, expiresAt: durationMs > 0 ? now + durationMs : 0, durationMs });
  const ch = meeting.channelId ? await client.channels.fetch(meeting.channelId).catch(() => null) : null;
  const announceMsg = ch && meeting.messageId ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
  if (!announceMsg) { await replyEphemeral(interaction, '❌ Сообщение заседания не найдено.', TTL_S); return; }
  const agendaText = await formatAgendaText(meetingId);
  await announceMsg.edit({
    embeds: [buildMeetingMainEmbed({ ...meeting, status: 'opening_vote' }, agendaText, 'opening_vote', { left: durationMs, expiresAt: durationMs > 0 ? now + durationMs : null, forCount: 0, againstCount: 0, abstainCount: 0 })],
    components: buildMeetingControls(meeting, 'opening_vote')
  }).catch(() => {});
  await startMeetingTicker(meetingId);
  await replyEphemeral(interaction, '✅ Голосование за открытие заседания запущено.', TTL_M);
}

async function handleMeetingOpenVote(interaction) {
  const cid       = interaction.customId;
  const voteType  = cid.startsWith('meeting_open_vote_for_') ? 'for' : cid.startsWith('meeting_open_vote_against_') ? 'against' : 'abstain';
  const meetingId = cid.replace(/^meeting_open_vote_(for|against|abstain)_/, '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (meeting.status !== 'opening_vote' && meeting.status !== 'closing_vote') { await replyEphemeral(interaction, '❌ Голосование уже завершено.', TTL_S); return; }
  const member = await client.guilds.cache.get(GUILD_ID).members.fetch(interaction.user.id).catch(() => null);
  if (!member || (!isSenator(member) && !isChairman(member, 'senate') && !isAdmin(member))) { await replyEphemeral(interaction, '❌ Только сенаторы могут голосовать.', TTL_S); return; }
  const uid = interaction.user.id;
  const forArr = [...meeting.openVotesFor], agaArr = [...meeting.openVotesAgainst], absArr = [...meeting.openVotesAbstain];
  if (forArr.includes(uid) || agaArr.includes(uid) || absArr.includes(uid)) { await replyEphemeral(interaction, 'ℹ️ Вы уже проголосовали в этом голосовании.', TTL_S); return; }
  if (voteType === 'for') forArr.push(uid);
  else if (voteType === 'against') agaArr.push(uid);
  else absArr.push(uid);
  db.saveMeetingOpenVotes(meetingId, forArr, agaArr, absArr);
  const leftText = meeting.expiresAt ? `Завершится ${discordTs(meeting.expiresAt, 'R')}` : 'Завершение по команде Спикера';
  await replyEphemeral(interaction, `✅ Голос принят. За: **${forArr.length}** | Против: **${agaArr.length}** | Воздержались: **${absArr.length}**\n${leftText}`, TTL_M);
}

async function closeMeetingOpenVoteManually(interaction) {
  const meetingId = interaction.customId.replace('close_meeting_vote_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, 'senate') && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  if (meetingTimers.has(meetingId)) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); }
  const { openVotesFor: f, openVotesAgainst: a, openVotesAbstain: b } = meeting;
  if (meeting.status === 'opening_vote') {
    if (f.length > a.length) await openMeetingSession(meetingId, db.getMeeting(meetingId), f, a, b);
    else await closeMeetingSessionVote(meetingId, db.getMeeting(meetingId), f, a, b);
  } else if (meeting.status === 'closing_vote') {
    await finalizeMeetingCloseVote(meetingId);
  }
  await replyEphemeral(interaction, '✅ Голосование завершено досрочно.', TTL_M);
}

async function openMeetingSession(meetingId, meeting, forArr, agaArr, absArr) {
  if (meetingTimers.has(meetingId)) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); }
  const openedAt = Date.now();
  db.updateMeeting(meetingId, { status: 'in_session', open: true, openedAt });
  try {
    const agendaText = await formatAgendaText(meetingId);
    const ch    = await client.channels.fetch(meeting.channelId).catch(() => null);
    const msg   = ch && meeting.messageId ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
    const thread = meeting.threadId
      ? await client.channels.fetch(meeting.threadId).catch(() => null)
      : (msg ? await msg.startThread({ name: `${meeting.title} — Ход заседания`, autoArchiveDuration: 1440 }).catch(() => null) : null);
    if (thread && !meeting.threadId) db.updateMeetingThread(meetingId, thread.id);
    if (thread) {
      await thread.send({ embeds: [buildEmbed({ color: COLORS.SUCCESS, title: `✅ Заседание открыто — ${meeting.title}`,
        description: `## 🗳️ Итоги голосования за открытие\n\nЗа: **${forArr.length}** · Против: **${agaArr.length}** · Воздержались: **${absArr.length}**`,
        fields: [
          { name: '📜 Повестка заседания', value: agendaText, inline: false }
        ]
      })] });
    }
    if (msg) await msg.edit({ embeds: [buildMeetingMainEmbed({ ...meeting, status: 'in_session', openedAt }, agendaText, 'in_session')], components: buildMeetingControls(meeting, 'in_session') }).catch(() => {});
  } catch (e) { console.error('❌ openMeetingSession:', e.message); }
}

async function closeMeetingSessionVote(meetingId, meeting, forArr, agaArr, absArr) {
  if (meetingTimers.has(meetingId)) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); }
  db.updateMeeting(meetingId, { status: 'planned', open: false, durationMs: 0, expiresAt: 0 });
  try {
    const ch  = await client.channels.fetch(meeting.channelId).catch(() => null);
    const msg = ch && meeting.messageId ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
    const agendaText = await formatAgendaText(meetingId, true);
    if (msg) await msg.edit({
      embeds: [buildEmbed({ color: COLORS.DANGER, title: `❌ Открытие заседания отклонено — ${meeting.title}`,
        description: `Заседание **не открыто**. За: **${forArr.length}** | Против: **${agaArr.length}** | Воздержались: **${absArr.length}**\n\n> Голосование можно повторить кнопкой ниже.`,
        fields: [{ name: '📜 Повестка', value: agendaText, inline: false }]
      })],
      components: buildMeetingControls({ ...meeting, id: meetingId }, 'planned')
    }).catch(() => {});
  } catch (e) { console.error('❌ closeMeetingSessionVote:', e.message); }
}

// ════════════════════ CLOSING VOTE ═════════════════════════════════
async function handleStartClosingVoteButton(interaction) {
  const meetingId = interaction.customId.replace('start_close_vote_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting || meeting.status !== 'in_session') { await replyEphemeral(interaction, '❌ Заседание не активно.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`closing_vote_modal_${meetingId}`).setTitle('Запуск голосования за закрытие');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('close_duration').setLabel('Время голосования (0 = вручную)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('10m / 0').setMaxLength(20)));
  await interaction.showModal(modal);
}

async function handleClosingVoteModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const meetingId  = interaction.customId.replace('closing_vote_modal_', '');
  const rawDur     = interaction.fields.getTextInputValue('close_duration').trim();
  const durationMs = rawDur === '0' ? 0 : parseCustomDuration(rawDur);
  const meeting    = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  const now = Date.now();
  db.saveMeetingOpenVotes(meetingId, [], [], []);
  db.updateMeeting(meetingId, { status: 'closing_vote', expiresAt: durationMs > 0 ? now + durationMs : 0, durationMs });
  const ch = meeting.channelId ? await client.channels.fetch(meeting.channelId).catch(() => null) : null;
  const announceMsg = ch && meeting.messageId ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
  if (!announceMsg) { await replyEphemeral(interaction, '❌ Сообщение заседания не найдено.', TTL_S); return; }
  const agendaText = await formatAgendaText(meetingId, true);
  await announceMsg.edit({
    embeds: [buildMeetingMainEmbed({ ...meeting, status: 'closing_vote' }, agendaText, 'closing_vote', { left: durationMs, expiresAt: durationMs > 0 ? now + durationMs : null, forCount: 0, againstCount: 0, abstainCount: 0 })],
    components: buildMeetingControls(meeting, 'closing_vote')
  }).catch(() => {});
  await startMeetingTicker(meetingId);
  await replyEphemeral(interaction, '✅ Голосование за закрытие заседания начато.', TTL_M);
}

async function finalizeMeetingCloseVote(meetingId) {
  if (meetingTimers.has(meetingId)) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); }
  const meeting = db.getMeeting(meetingId);
  if (!meeting) return;
  const forArr = meeting.openVotesFor || [], agaArr = meeting.openVotesAgainst || [], absArr = meeting.openVotesAbstain || [];
  const totalVotes = forArr.length + agaArr.length + absArr.length;
  const passed = totalVotes >= (meeting.quorum || 0) && forArr.length > agaArr.length;
  const agendaText = await formatAgendaText(meetingId, true);
  try {
    const ch     = await client.channels.fetch(meeting.channelId).catch(() => null);
    const msg    = ch && meeting.messageId ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
    const thread = meeting.threadId ? await client.channels.fetch(meeting.threadId).catch(() => null) : null;
    if (passed) {
      const closedAt = Date.now();
      db.closeMeeting(meetingId);
      db.updateMeeting(meetingId, { status: 'completed', open: false, durationMs: 0, expiresAt: 0 });
      if (msg) await msg.edit({ embeds: [buildMeetingMainEmbed({ ...meeting, status: 'completed', openedAt: meeting.openedAt }, agendaText, 'completed', { agendaText })], components: [] }).catch(() => {});

      // Итоговый протокол в ветке
      if (thread) {
        const forList = forArr.map(id => `<@${id}>`).join(', ') || '*нет*';
        const agaList = agaArr.map(id => `<@${id}>`).join(', ') || '*нет*';
        const absList = absArr.map(id => `<@${id}>`).join(', ') || '*нет*';
        await thread.send({ embeds: [buildEmbed({ color: COLORS.WARNING, title: `🔚 Заседание закрыто — ${meeting.title}`,
          description: `## 🗳️ Итоги голосования за закрытие\n\nЗа: **${forArr.length}** · Против: **${agaArr.length}** · Воздержались: **${absArr.length}**`,
          fields: [
            { name: `✅ За (${forArr.length})`,          value: truncate(forList, 1024), inline: false },
            { name: `❌ Против (${agaArr.length})`,      value: truncate(agaList, 1024), inline: false },
            { name: `⚪ Воздержались (${absArr.length})`, value: truncate(absList, 1024), inline: false }
          ]
        })] });
        for (const e of await buildMeetingProtocol(meetingId, meeting)) await thread.send({ embeds: [e] });
        setTimeout(() => thread.setArchived(true).catch(() => {}), 30000);
      } else if (ch) {
        for (const e of await buildMeetingProtocol(meetingId, meeting)) await ch.send({ embeds: [e] });
      }
    } else {
      db.updateMeeting(meetingId, { status: 'in_session', open: true, durationMs: 0, expiresAt: 0 });
      if (msg) await msg.edit({ embeds: [buildEmbed({ color: COLORS.WARNING, title: `⚠️ Голосование за закрытие отклонено — ${meeting.title}`,
        description: `Заседание **продолжается**. За: **${forArr.length}** | Против: **${agaArr.length}** | Воздержались: **${absArr.length}**`,
        fields: [{ name: '📜 Итоги повестки', value: agendaText, inline: false }]
      })], components: buildMeetingControls({ ...meeting, id: meetingId }, 'in_session') }).catch(() => {});
    }
  } catch (e) { console.error('❌ finalizeMeetingCloseVote:', e.message); }
}

async function buildMeetingProtocol(meetingId, meeting) {
  const agenda     = db.getAgenda(meetingId);
  const presentSet = new Set([...meeting.openVotesFor, ...meeting.openVotesAgainst, ...meeting.openVotesAbstain]);
  for (const p of agenda) for (const v of db.getVotes(p.id)) presentSet.add(v.userId);
  const senators  = await fetchSenators().catch(() => []);
  const cache     = getTagToIdCache();
  const absentIds = senators.filter(s => { const id = cache.get(s.tag.toLowerCase()); return id && !presentSet.has(id); }).map(s => cache.get(s.tag.toLowerCase()));

  const header = buildEmbed({ color: COLORS.PRIMARY, title: '📄 Протокол заседания Сената',
    description: [
      `**Заседание:** ${meeting.title}`,
      `**Дата проведения:** ${meeting.meetingDate}`,
      meeting.openedAt ? `**Открыто:** ${discordTs(meeting.openedAt, 'f')}` : '',
      `**Закрыто:** ${discordTs(Date.now(), 'f')}`,
      `**Присутствовало:** ${presentSet.size} сенаторов`,
      `**Кворум:** ${meeting.quorum}`
    ].filter(Boolean).join('\n'),
    fields: [
      { name: '👥 Присутствовали', value: ([...presentSet].map(id => `<@${id}>`).join('\n') || '*нет*').substring(0, 1024), inline: false },
      { name: '🔴 Отсутствовали',  value: (absentIds.map(id => `<@${id}>`).join('\n') || '*нет*').substring(0, 1024),  inline: false }
    ]
  });
  const resultLines = [];
  for (const p of agenda) {
    const voting = db.getVoting(p.id);
    if (p.status === 'Отозван') resultLines.push(`~~**${p.number}** — ${p.name}~~\n*Законопроект отозван*`);
    else if (voting?.endedAt) { const { forCount, againstCount, abstainCount } = computeVoteCounts(p.id); resultLines.push(`**${p.number}** — ${p.name}\n${getProposalStatusEmoji(p.status)} ${p.status} | За: ${forCount} | Против: ${againstCount} | Воздержались: ${abstainCount}`); }
    else resultLines.push(`**${p.number}** — ${p.name}\n*Не рассматривался*`);
  }
  return [
    header,
    buildEmbed({ color: COLORS.INFO, title: '📊 Итоги рассмотрения повестки', description: resultLines.join('\n\n').substring(0, 4096) || '*Нет данных*' })
  ];
}

async function handleCancelMeetingButton(interaction) {
  const meetingId = interaction.customId.split('cancel_meeting_')[1];
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`cancel_meeting_modal_${meetingId}`).setTitle('Отмена заседания');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cancel_reason').setLabel('Основание для отмены').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
  await interaction.showModal(modal);
}

async function handleCancelMeetingModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const meetingId = interaction.customId.split('cancel_meeting_modal_')[1];
  const reason    = interaction.fields.getTextInputValue('cancel_reason');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  db.updateMeeting(meetingId, { status: 'cancelled', open: false });
  if (meetingTimers.has(meetingId)) { clearInterval(meetingTimers.get(meetingId)); meetingTimers.delete(meetingId); }
  try {
    const ch  = await client.channels.fetch(meeting.channelId);
    const msg = await ch.messages.fetch(meeting.messageId);
    await msg.edit({ embeds: [buildEmbed({ color: COLORS.DANGER, title: '🗑️ Заседание отменено', description: `**${meeting.title}**`,
      fields: [
        { name: '🗓️ Дата', value: meeting.meetingDate, inline: true },
        { name: '👤 Отменил', value: `<@${interaction.user.id}>`, inline: true },
        { name: '📋 Основание', value: reason, inline: false }
      ]
    })], components: [] });
    await replyEphemeral(interaction, '✅ Заседание отменено.', TTL_M);
  } catch (e) { await replyEphemeral(interaction, '❌ Ошибка при отмене заседания.', TTL_S); }
}

async function handleClearRolesButton(interaction) {
  const meetingId = interaction.customId.split('clear_roles_')[1];
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  await finalizeMeetingCloseVote(meetingId);
  await replyEphemeral(interaction, '✅ Заседание принудительно завершено.', TTL_M);
}

// ════════════════════ EDIT AGENDA ══════════════════════════════════
async function handleEditAgendaCommand(interaction) {
  if (!isChairman(interaction.member, 'senate') && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const openMeetings = db.getOpenMeetings().filter(m => m.status === 'in_session');
  if (openMeetings.length) { await showAgendaEditor(interaction, openMeetings[0]); return; }
  const last = db.getLastMeeting();
  if (!last || !['planned', 'opening_vote', 'not_opened'].includes(last.status)) { await replyEphemeral(interaction, '❌ Нет доступных заседаний для редактирования.', TTL_S); return; }
  await showAgendaEditor(interaction, last);
}

async function showAgendaEditor(interaction, meeting) {
  const existingIds = db.getAgenda(meeting.id).map(p => p.id);
  const pending     = db.getPendingProposals().filter(p => !existingIds.includes(p.id));
  const agendaText  = await formatAgendaText(meeting.id, true);

  const components = [];
  if (pending.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`edit_agenda_add_${meeting.id}`)
        .setPlaceholder('Добавить законопроект').setMinValues(1).setMaxValues(Math.min(pending.length, 10))
        .addOptions(pending.map(p => new StringSelectMenuOptionBuilder().setLabel(truncate(`${p.number} — ${p.name}`, 100)).setValue(p.id)))
    ));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`edit_agenda_exclude_${meeting.id}`).setLabel('🗑️ Исключить пункты').setStyle(ButtonStyle.Danger)
  ));

  await replyEphemeral(interaction, {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: `✏️ Редактирование повестки — ${meeting.title}`, description: agendaText || '*Повестка пуста*' })],
    components
  }, TTL_L);
}

async function handleMeetingEditAgendaButton(interaction) {
  const meetingId = interaction.customId.replace('edit_agenda_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  if (!['in_session', 'planned', 'opening_vote', 'not_opened'].includes(meeting.status)) { await replyEphemeral(interaction, '❌ Редактирование повестки сейчас недоступно.', TTL_S); return; }
  await showAgendaEditor(interaction, meeting);
}

async function handleEditAgendaSelect(interaction) {
  const meetingId = interaction.customId.replace('edit_agenda_add_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await updateEphemeral(interaction, { content: formatErrorText('❌ Заседание не найдено.'), components: [] }, TTL_S); return; }
  const now = Date.now();
  for (const pid of interaction.values) if (db.proposalExists(pid)) { db.addToAgenda(meetingId, pid); await addProposalEvent(pid, { type: 'agenda_inclusion', timestamp: now, chamber: meeting.chamber, description: `Добавлен в повестку «${meeting.title}»` }); }
  await refreshMeetingMessage(meetingId);
  const newAgenda = await formatAgendaText(meetingId, true);
  await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.SUCCESS, title: '✅ Повестка обновлена', description: newAgenda })], components: [] }, TTL_M);
}

async function handleEditAgendaExcludeButton(interaction) {
  const meetingId = interaction.customId.replace('edit_agenda_exclude_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const agenda = db.getAgenda(meetingId);
  if (!agenda.length) { await replyEphemeral(interaction, 'ℹ️ Повестка пуста — нечего исключать.', TTL_S); return; }
  const opts = agenda.map(p => new StringSelectMenuOptionBuilder().setLabel(truncate(`${p.number} — ${p.name}`, 100)).setValue(p.id));
  await replyEphemeral(interaction, {
    embeds: [buildEmbed({ color: COLORS.WARNING, title: '🗑️ Исключение из повестки', description: 'Выберите пункты для исключения из повестки заседания.' })],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`meeting_agenda_exclude_select_${meetingId}`)
        .setPlaceholder('Выберите пункты').setMinValues(1).setMaxValues(Math.min(opts.length, 10)).addOptions(opts)
    )]
  }, TTL_L);
}

async function handleEditAgendaExcludeSelect(interaction) {
  const meetingId = interaction.customId.replace('meeting_agenda_exclude_select_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  const removed = [], now = Date.now();
  for (const pid of interaction.values) {
    if (!pid || !db.proposalExists(pid)) continue;
    db.removeFromAgenda(meetingId, pid);
    removed.push(pid);
    await addProposalEvent(pid, { type: 'agenda_inclusion', timestamp: now, chamber: meeting.chamber, description: `Исключён из повестки «${meeting.title}»` });
  }
  await refreshMeetingMessage(meetingId);
  if (!removed.length) { await updateEphemeral(interaction, { content: 'ℹ️ Ничего не исключено.', components: [] }, TTL_S); return; }
  const list = removed.map(id => { const p = db.getProposal(id); return p ? `• ${p.number} — ${truncate(p.name, 150)}` : id; }).join('\n');

  // Предлагаем выбрать: по решению спикера или голосование
  await updateEphemeral(interaction, {
    embeds: [buildEmbed({ color: COLORS.WARNING, title: '📋 Пункты исключены из повестки', description: list + '\n\nВыберите, как оформить исключение:' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`exclude_by_speaker_${meetingId}|${removed.join('|')}`).setLabel('🎙️ Решение Спикера').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`exclude_confirm_vote_${meetingId}|${removed.join('|')}`).setLabel('🗳️ Провести голосование').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`exclude_confirm_none_${meetingId}|${removed.join('|')}`).setLabel('Без оформления').setStyle(ButtonStyle.Secondary)
    )]
  }, TTL_L);
}

async function handleExcludeConfirmButtons(interaction) {
  const cid = interaction.customId;
  if (cid.startsWith('exclude_by_speaker_')) {
    const payload = cid.replace('exclude_by_speaker_', '');
    const [meetingId, ...rest] = payload.split('|');
    const pids = rest.filter(Boolean);
    if (!meetingId || !pids.length) { await updateEphemeral(interaction, { content: formatErrorText('❌ Данные устарели. Запустите редактирование повестки заново.'), embeds: [], components: [] }, TTL_S); return; }
    const modal = new ModalBuilder().setCustomId(`exclude_by_speaker_modal_${meetingId}|${pids.join('|')}`).setTitle('Исключение по решению Спикера');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('exclude_reason').setLabel('Причина исключения').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
    await interaction.showModal(modal);
    return;
  }
  if (cid.startsWith('exclude_confirm_none_')) {
    await updateEphemeral(interaction, { content: '✅ Исключено без дополнительного оформления.', embeds: [], components: [] }, TTL_M); return;
  }
  if (cid.startsWith('exclude_confirm_vote_')) {
    const payload = cid.replace('exclude_confirm_vote_', '');
    const [meetingId, ...rest] = payload.split('|');
    const pids = rest.filter(Boolean);
    const modal = new ModalBuilder().setCustomId(`exclude_vote_modal_${meetingId}|${pids.join('|')}`).setTitle('Голосование об исключении');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('exclude_vote_reason').setLabel('Основание для голосования').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('exclude_vote_duration').setLabel('Время голосования (0 = вручную)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('30m / 0').setMaxLength(20))
    );
    await interaction.showModal(modal);
  }
}

function buildAgendaExcludeList(pids) {
  const lines = [];
  for (const pid of pids) {
    const p = db.getProposal(pid);
    lines.push(p ? `• ${p.number} — ${p.name}` : `• ${pid}`);
  }
  return lines.join('\n') || '*нет*';
}

async function getMeetingThreadOrChannel(meeting) {
  if (!meeting) return null;
  let thread = meeting.threadId ? await client.channels.fetch(meeting.threadId).catch(() => null) : null;
  if (!thread && meeting.channelId && meeting.messageId) {
    const ch = await client.channels.fetch(meeting.channelId).catch(() => null);
    const msg = ch?.messages ? await ch.messages.fetch(meeting.messageId).catch(() => null) : null;
    if (msg?.startThread) {
      thread = await msg.startThread({ name: `${meeting.title} — Ход заседания`, autoArchiveDuration: 1440 }).catch(() => null);
      if (thread) db.updateMeetingThread(meeting.id, thread.id);
    }
  }
  if (thread) return thread;
  return meeting.channelId ? await client.channels.fetch(meeting.channelId).catch(() => null) : null;
}

async function handleExcludeBySpeakerModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const payload = interaction.customId.replace('exclude_by_speaker_modal_', '');
  const parts = payload.split('|');
  const meetingId = parts[0], pids = parts.slice(1).filter(Boolean);
  const reason = interaction.fields.getTextInputValue('exclude_reason').trim();
  const meeting = db.getMeeting(meetingId);
  if (!meeting || !pids.length) { await replyEphemeral(interaction, '❌ Данные не найдены.', TTL_S); return; }
  const postCh = await getMeetingThreadOrChannel(meeting);
  if (!postCh) { await replyEphemeral(interaction, '❌ Канал заседания не найден.', TTL_S); return; }
  const list = buildAgendaExcludeList(pids);
  await postCh.send({ embeds: [buildEmbed({ color: COLORS.WARNING, title: '🎙️ Исключение из повестки (решение Спикера)',
    description: `**${meeting.title}**`,
    fields: [
      { name: '📌 Исключаемые пункты', value: truncate(list, 1024), inline: false },
      { name: '📋 Причина', value: truncate(reason, 1024), inline: false },
      { name: '👤 Инициатор', value: `<@${interaction.user.id}>`, inline: true },
      { name: '🕐 Время', value: discordTs(Date.now(), 'f'), inline: true }
    ]
  })] }).catch(() => {});
  await replyEphemeral(interaction, '✅ Исключение оформлено и зафиксировано в ветке заседания.', TTL_M);
}

async function handleExcludeVoteModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const payload = interaction.customId.replace('exclude_vote_modal_', '');
  const parts = payload.split('|');
  const meetingId = parts[0], pids = parts.slice(1).filter(Boolean);
  const reason = interaction.fields.getTextInputValue('exclude_vote_reason').trim();
  const rawDur = interaction.fields.getTextInputValue('exclude_vote_duration').trim();
  const ms = rawDur === '0' ? 0 : parseCustomDuration(rawDur);
  if (!meetingId || !pids.length) { await replyEphemeral(interaction, '❌ Нечего голосовать.', TTL_S); return; }
  await startAgendaExcludeVote(interaction, meetingId, pids, reason, ms);
}

async function startAgendaExcludeVote(interaction, meetingId, pids, reason, durationMs) {
  const meeting = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  const postCh = await getMeetingThreadOrChannel(meeting);
  if (!postCh) { await replyEphemeral(interaction, '❌ Канал заседания не найден.', TTL_S); return; }
  const id = nanoid(8);
  const now = Date.now();
  const list = buildAgendaExcludeList(pids);
  const endText = durationMs > 0 ? discordTs(now + durationMs, 'R') : 'По команде Спикера';
  const embed = buildEmbed({
    color: COLORS.INFO,
    title: '🗳️ Голосование об исключении из повестки',
    description: `**${meeting.title}**`,
    fields: [
      { name: '📌 Исключаемые пункты', value: truncate(list, 1024), inline: false },
      { name: '📋 Основание', value: truncate(reason, 1024), inline: false },
      { name: '👤 Инициатор', value: `<@${interaction.user.id}>`, inline: true },
      { name: '🕐 Завершение', value: endText, inline: true },
      { name: '✅ За', value: '0', inline: true },
      { name: '❌ Против', value: '0', inline: true },
      { name: '⚪ Воздержались', value: '0', inline: true }
    ]
  });
  const voteRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`agenda_excl_vote_for_${id}`).setLabel('✅ За').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`agenda_excl_vote_against_${id}`).setLabel('❌ Против').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`agenda_excl_vote_abstain_${id}`).setLabel('⚪ Воздержаться').setStyle(ButtonStyle.Secondary)
  );
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`agenda_excl_vote_end_${id}`).setLabel('⏹️ Завершить').setStyle(ButtonStyle.Danger)
  );
  const msg = await postCh.send({ embeds: [embed], components: [voteRow, controlRow] });
  agendaExcludeVotes.set(id, {
    meetingId,
    proposalIds: pids,
    reason,
    for: [],
    against: [],
    abstain: [],
    startedAt: now,
    expiresAt: durationMs > 0 ? now + durationMs : null,
    timeoutId: null,
    messageId: msg.id,
    channelId: postCh.id,
    initiatorId: interaction.user.id
  });
  if (durationMs > 0) {
    const to = setTimeout(() => finalizeAgendaExcludeVote(id).catch(() => {}), durationMs);
    const row = agendaExcludeVotes.get(id); if (row) row.timeoutId = to;
    startAgendaExcludeVoteTicker(id).catch(() => {});
  }
  await replyEphemeral(interaction, '✅ Голосование запущено в ветке заседания.', TTL_M);
}

async function updateAgendaExcludeVoteEmbed(id) {
  const row = agendaExcludeVotes.get(id); if (!row) return;
  const ch = row.channelId ? await client.channels.fetch(row.channelId).catch(() => null) : null;
  const msg = ch && row.messageId ? await ch.messages.fetch(row.messageId).catch(() => null) : null;
  if (!msg) return;
  const meeting = db.getMeeting(row.meetingId);
  const left = row.expiresAt ? row.expiresAt - Date.now() : null;
  const endText = row.expiresAt ? discordTs(row.expiresAt, 'R') : 'По команде Спикера';
  const list = buildAgendaExcludeList(row.proposalIds);
  const newEmbed = buildEmbed({
    color: COLORS.INFO,
    title: '🗳️ Голосование об исключении из повестки',
    description: meeting ? `**${meeting.title}**` : '',
    fields: [
      { name: '📌 Исключаемые пункты', value: truncate(list, 1024), inline: false },
      { name: '📋 Основание', value: truncate(row.reason, 1024), inline: false },
      { name: '⏳ Осталось', value: left !== null ? formatTimeLeft(Math.max(0, left)) : '—', inline: true },
      { name: '🕐 Завершение', value: endText, inline: true },
      { name: '✅ За', value: String(row.for.length), inline: true },
      { name: '❌ Против', value: String(row.against.length), inline: true },
      { name: '⚪ Воздержались', value: String(row.abstain.length), inline: true }
    ]
  });
  await msg.edit({ embeds: [newEmbed] }).catch(() => {});
}

async function startAgendaExcludeVoteTicker(id) {
  if (agendaExcludeTimers.has(id)) { clearInterval(agendaExcludeTimers.get(id)); agendaExcludeTimers.delete(id); }
  const tick = async () => {
    try {
      const row = agendaExcludeVotes.get(id);
      if (!row || !row.expiresAt) { clearInterval(agendaExcludeTimers.get(id)); agendaExcludeTimers.delete(id); return; }
      const left = row.expiresAt - Date.now();
      if (left <= 0) { clearInterval(agendaExcludeTimers.get(id)); agendaExcludeTimers.delete(id); await finalizeAgendaExcludeVote(id); return; }
      await updateAgendaExcludeVoteEmbed(id);
    } catch (e) { console.error('❌ agendaExcludeTicker:', e.message); }
  };
  await tick();
  if (agendaExcludeVotes.get(id)?.expiresAt) agendaExcludeTimers.set(id, setInterval(tick, 2000));
}

async function finalizeAgendaExcludeVote(id) {
  const row = agendaExcludeVotes.get(id); if (!row) return;
  const meeting = db.getMeeting(row.meetingId);
  const passed = row.for.length > row.against.length;
  const ch = row.channelId ? await client.channels.fetch(row.channelId).catch(() => null) : null;
  const msg = ch && row.messageId ? await ch.messages.fetch(row.messageId).catch(() => null) : null;
  if (!passed && meeting) {
    for (const pid of row.proposalIds) if (db.proposalExists(pid)) db.addToAgenda(meeting.id, pid);
    await refreshMeetingMessage(meeting.id).catch(() => {});
  }
  const list = buildAgendaExcludeList(row.proposalIds);
  const finalEmbed = buildEmbed({
    color: passed ? COLORS.SUCCESS : COLORS.DANGER,
    title: 'Итоги голосования об исключении',
    description: [
      meeting ? `**${meeting.title}**` : null,
      `${passed ? '✅' : '❌'} Итог: **${passed ? 'Исключение подтверждено' : 'Исключение отклонено'}**`
    ].filter(Boolean).join('\n'),
    fields: [
      { name: '📌 Пункты', value: truncate(list, 1024), inline: false },
      { name: '📋 Основание', value: truncate(row.reason, 1024), inline: false },
      { name: '✅ За', value: String(row.for.length), inline: true },
      { name: '❌ Против', value: String(row.against.length), inline: true },
      { name: '⚪ Воздержались', value: String(row.abstain.length), inline: true },
      { name: '📊 Проголосовало', value: String(row.for.length + row.against.length + row.abstain.length), inline: true },
      { name: '👤 Инициатор', value: `<@${row.initiatorId}>`, inline: true },
      { name: '🕐 Начало', value: row.startedAt ? discordTs(row.startedAt, 'f') : '—', inline: true },
      { name: '🕐 Завершено', value: discordTs(Date.now(), 'f'), inline: true }
    ]
  });
  if (msg) await msg.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
  if (row.timeoutId) clearTimeout(row.timeoutId);
  if (agendaExcludeTimers.has(id)) { clearInterval(agendaExcludeTimers.get(id)); agendaExcludeTimers.delete(id); }
  agendaExcludeVotes.delete(id);
}

// ════════════════════ REVIEW AGENDA ════════════════════════════════
async function handleReviewAgendaButton(interaction) {
  const meetingId = interaction.customId.replace('review_agenda_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const agenda = db.getAgenda(meetingId);
  if (!agenda.length) { await replyEphemeral(interaction, 'ℹ️ Повестка пуста.', TTL_S); return; }
  const opts = agenda.map(p => new StringSelectMenuOptionBuilder().setLabel(truncate(`${p.number} — ${p.name}`, 100)).setValue(p.id));
  await replyEphemeral(interaction, {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '📌 Рассмотрение пункта', description: 'Выберите пункт повестки для рассмотрения.' })],
    components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`review_agenda_select_${meetingId}`).setMinValues(1).setMaxValues(1).addOptions(opts))]
  }, TTL_L);
}

async function handleReviewAgendaSelect(interaction) {
  const meetingId = interaction.customId.replace('review_agenda_select_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await updateEphemeral(interaction, { content: formatErrorText('❌ Заседание не найдено.'), components: [] }, TTL_S); return; }
  const pid = interaction.values[0], p = db.getProposal(pid);
  if (!p) { await updateEphemeral(interaction, { content: formatErrorText('❌ Пункт не найден.'), components: [] }, TTL_S); return; }
  await updateEphemeral(interaction, {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: `📌 Пункт повестки — ${p.number}`, description: `**${p.name}**\n\nВыберите способ рассмотрения:` })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`review_action_speaker_${meetingId}|${pid}`).setLabel('🎙️ Слово Спикеру').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`review_action_vote_${meetingId}|${pid}`).setLabel('🗳️ На голосование').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`review_action_cancel_${meetingId}|${pid}`).setLabel('❌ Отмена').setStyle(ButtonStyle.Secondary)
    )]
  }, TTL_L);
}

async function handleReviewActionButton(interaction) {
  const cid = interaction.customId;
  if (cid.startsWith('review_action_cancel_')) { await updateEphemeral(interaction, { content: formatErrorText('❌ Действие отменено.'), embeds: [], components: [] }, TTL_S); return; }
  const payload = cid.replace(/review_action_(speaker|vote)_/, '');
  const [meetingId, pid] = payload.split('|');
  if (cid.startsWith('review_action_speaker_')) {
    const modal = new ModalBuilder().setCustomId(`review_speaker_modal_${meetingId}|${pid}`).setTitle('Слово Спикеру');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('speaker_reason').setLabel('Тема / Комментарий Спикера').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)));
    await interaction.showModal(modal); return;
  }
  if (cid.startsWith('review_action_vote_')) {
    const modal = new ModalBuilder().setCustomId(`review_vote_modal_${meetingId}|${pid}`).setTitle('Запуск голосования по пункту');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_reason').setLabel('Пояснение / основание').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_duration').setLabel('Время (1h / 30m / 0 = вручную)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('30m').setMaxLength(20)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_secret').setLabel('Тайное? 0/1').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_formula').setLabel('Формула: 0/1/2/3').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1))
    );
    await interaction.showModal(modal);
  }
}

async function handleReviewSpeakerModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const [meetingId, pid] = interaction.customId.replace('review_speaker_modal_', '').split('|');
  const reason  = interaction.fields.getTextInputValue('speaker_reason') || '';
  const meeting = db.getMeeting(meetingId), p = db.getProposal(pid);
  if (!meeting || !p) { await replyEphemeral(interaction, '❌ Данные не найдены.', TTL_S); return; }
  const thread = meeting.threadId ? await client.channels.fetch(meeting.threadId).catch(() => null) : null;
  if (thread) {
    await thread.send({ embeds: [buildEmbed({ color: COLORS.INFO, title: `🎙️ Слово Спикеру — ${p.number}`,
      description: `**${p.name}**`,
      fields: [
        { name: '📋 Тема', value: reason || '*без описания*', inline: false },
        { name: '👤 Инициатор', value: `<@${interaction.user.id}>`, inline: true },
        { name: '🕐 Время', value: discordTs(Date.now(), 'f'), inline: true }
      ]
    })] });
  }
  await replyEphemeral(interaction, '✅ Слово Спикера отмечено в ветке заседания.', TTL_M);
}

async function handleReviewVoteModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const [meetingId, pid] = interaction.customId.replace('review_vote_modal_', '').split('|');
  const rawDur   = interaction.fields.getTextInputValue('vote_duration').trim();
  const ms       = rawDur === '0' ? 0 : parseCustomDuration(rawDur);
  const isSecret = interaction.fields.getTextInputValue('vote_secret').trim() === '1';
  const fInput   = interaction.fields.getTextInputValue('vote_formula').trim();
  const formula  = ['0','1','2','3'].includes(fInput) ? fInput : '0';
  const reason   = interaction.fields.getTextInputValue('vote_reason') || null;
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  await launchVoting(interaction, p, ms, isSecret, formula, false, reason);
}

// ════════════════════ PROCEDURAL QUESTION ══════════════════════════
async function handleProceduralQuestionButton(interaction) {
  const meetingId = interaction.customId.replace('procedural_question_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, meeting.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`procedural_modal_${meetingId}`).setTitle('Процедурный вопрос');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proc_question').setLabel('Формулировка вопроса').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(800)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proc_duration').setLabel('Время голосования (0 = вручную)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('10m / 0')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proc_secret').setLabel('Тайное? (0/1)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proc_formula').setLabel('Формула: 0/1/2/3').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1))
  );
  await interaction.showModal(modal);
}

async function handleProceduralModalSubmit(interaction) {
  await interaction.deferReply({ flags: 64 });
  const meetingId = interaction.customId.replace('procedural_modal_', '');
  const meeting   = db.getMeeting(meetingId);
  if (!meeting) { await replyEphemeral(interaction, '❌ Заседание не найдено.', TTL_S); return; }
  const question = interaction.fields.getTextInputValue('proc_question').trim();
  const rawDur   = interaction.fields.getTextInputValue('proc_duration').trim();
  const ms       = rawDur === '0' ? 0 : parseCustomDuration(rawDur);
  const isSecret = interaction.fields.getTextInputValue('proc_secret').trim() === '1';
  const fInput   = interaction.fields.getTextInputValue('proc_formula').trim();
  const formula  = ['0','1','2','3'].includes(fInput) ? fInput : '0';
  const id       = nanoid(8);
  const now      = Date.now();

  const postCh = await getMeetingThreadOrChannel(meeting);
  if (!postCh) { await replyEphemeral(interaction, '❌ Канал заседания не найден.', TTL_S); return; }

  const embed = buildEmbed({
    color: COLORS.INFO, title: '⚙️ Процедурный вопрос',
    description: `${meeting?.title ? `**${meeting.title}**\n` : ''}**${question}**`,
    fields: [
      { name: '👤 Инициатор', value: `<@${interaction.user.id}>`, inline: true },
      { name: '🕐 Начало',    value: discordTs(now, 'f'),          inline: true },
      { name: '🔒 Тип',       value: isSecret ? '🔐 Тайное' : '👁️ Открытое', inline: true },
      { name: '📊 Формула',   value: getFormulaDesc(formula),      inline: true },
      { name: '✅ За',        value: '0', inline: true },
      { name: '❌ Против',    value: '0', inline: true },
      { name: '⚪ Воздержались', value: '0', inline: true }
    ]
  });
  const voteRow    = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`proc_vote_for_${id}`).setLabel('✅ За').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`proc_vote_against_${id}`).setLabel('❌ Против').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`proc_vote_abstain_${id}`).setLabel('⚪ Воздержаться').setStyle(ButtonStyle.Secondary)
  );
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`proc_end_${id}`).setLabel('⏹️ Завершить').setStyle(ButtonStyle.Danger)
  );
  const msg = await postCh.send({ embeds: [embed], components: [voteRow, controlRow] });
  proceduralVotes.set(id, { meetingId, question, for: [], against: [], abstain: [], startedAt: now, expiresAt: ms > 0 ? now + ms : null, timeoutId: null, messageId: msg.id, channelId: postCh.id, isSecret, formula });
  if (ms > 0) {
    const to = setTimeout(() => finalizeProceduralVote(id).catch(() => {}), ms);
    const row = proceduralVotes.get(id); if (row) row.timeoutId = to;
    startProceduralVoteTicker(id).catch(() => {});
  }
  await replyEphemeral(interaction, '✅ Процедурный вопрос вынесен на голосование в ветке заседания.', TTL_M);
}

async function handleProceduralVoteButton(interaction) {
  const parts = interaction.customId.split('_');
  const voteType = parts[2], id = parts.slice(3).join('_');
  const pv = proceduralVotes.get(id);
  if (!pv) { await replyEphemeral(interaction, '❌ Голосование не найдено.', TTL_S); return; }
  const uid = interaction.user.id;
  const member = await client.guilds.cache.get(GUILD_ID).members.fetch(uid).catch(() => null);
  if (!member || (!isSenator(member) && !isChairman(member, 'senate') && !isAdmin(member))) { await replyEphemeral(interaction, '❌ Только сенаторы.', TTL_S); return; }
  if ([...pv.for, ...pv.against, ...pv.abstain].includes(uid)) { await replyEphemeral(interaction, 'ℹ️ Вы уже проголосовали.', TTL_S); return; }
  if (voteType === 'for') pv.for.push(uid);
  else if (voteType === 'against') pv.against.push(uid);
  else if (voteType === 'abstain') pv.abstain.push(uid);
  else { await replyEphemeral(interaction, '❌ Неизвестный вариант.', TTL_S); return; }
  // Обновляем embed с текущими данными
  await updateProceduralVoteEmbed(id);
  await replyEphemeral(interaction, '✅ Голос принят.', TTL_S);
}

async function handleAgendaExcludeVoteButton(interaction) {
  const cid = interaction.customId;
  const voteType = cid.startsWith('agenda_excl_vote_for_') ? 'for'
    : cid.startsWith('agenda_excl_vote_against_') ? 'against'
    : 'abstain';
  const id = cid.replace(/^agenda_excl_vote_(for|against|abstain)_/, '');
  const row = agendaExcludeVotes.get(id);
  if (!row) { await replyEphemeral(interaction, '❌ Голосование не найдено.', TTL_S); return; }
  const uid = interaction.user.id;
  const member = await client.guilds.cache.get(GUILD_ID).members.fetch(uid).catch(() => null);
  if (!member || (!isSenator(member) && !isChairman(member, 'senate') && !isAdmin(member))) { await replyEphemeral(interaction, '❌ Только сенаторы.', TTL_S); return; }
  if ([...row.for, ...row.against, ...row.abstain].includes(uid)) { await replyEphemeral(interaction, 'ℹ️ Вы уже проголосовали.', TTL_S); return; }
  if (voteType === 'for') row.for.push(uid);
  else if (voteType === 'against') row.against.push(uid);
  else row.abstain.push(uid);
  await updateAgendaExcludeVoteEmbed(id);
  await replyEphemeral(interaction, '✅ Голос принят.', TTL_S);
}

async function handleAgendaExcludeVoteEndButton(interaction) {
  const id = interaction.customId.replace('agenda_excl_vote_end_', '');
  const row = agendaExcludeVotes.get(id);
  if (!row) { await replyEphemeral(interaction, '❌ Голосование не найдено.', TTL_S); return; }
  if (!isChairman(interaction.member, 'senate') && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  await finalizeAgendaExcludeVote(id);
  await replyEphemeral(interaction, '✅ Голосование завершено.', TTL_M);
}

async function updateProceduralVoteEmbed(id) {
  const pv = proceduralVotes.get(id); if (!pv) return;
  const ch = pv.channelId ? await client.channels.fetch(pv.channelId).catch(() => null) : null;
  const msg = ch && pv.messageId ? await ch.messages.fetch(pv.messageId).catch(() => null) : null;
  if (!msg) return;
  const left = pv.expiresAt ? pv.expiresAt - Date.now() : null;
  const leftText = left !== null ? formatTimeLeft(Math.max(0, left)) : '—';
  const endText  = pv.expiresAt ? discordTs(pv.expiresAt, 'R') : 'По команде Спикера';
  const newEmbed = buildEmbed({
    color: COLORS.INFO, title: '⚙️ Процедурный вопрос',
    description: `**${pv.question}**`,
    fields: [
      { name: '⏳ Осталось',     value: leftText, inline: true },
      { name: '🕐 Завершение',   value: endText,  inline: true },
      { name: '🔒 Тип',          value: pv.isSecret ? '🔐 Тайное' : '👁️ Открытое', inline: true },
      { name: '📊 Формула',      value: getFormulaDesc(pv.formula), inline: true },
      { name: '✅ За',           value: String(pv.for.length),     inline: true },
      { name: '❌ Против',       value: String(pv.against.length), inline: true },
      { name: '⚪ Воздержались', value: String(pv.abstain.length), inline: true }
    ]
  });
  await msg.edit({ embeds: [newEmbed] }).catch(() => {});
}

async function startProceduralVoteTicker(id) {
  if (proceduralTimers.has(id)) { clearInterval(proceduralTimers.get(id)); proceduralTimers.delete(id); }
  const tick = async () => {
    try {
      const pv = proceduralVotes.get(id);
      if (!pv || !pv.expiresAt) { clearInterval(proceduralTimers.get(id)); proceduralTimers.delete(id); return; }
      const left = pv.expiresAt - Date.now();
      if (left <= 0) { clearInterval(proceduralTimers.get(id)); proceduralTimers.delete(id); await finalizeProceduralVote(id); return; }
      await updateProceduralVoteEmbed(id);
    } catch (e) { console.error('❌ proceduralVoteTicker:', e.message); }
  };
  await tick();
  if (proceduralVotes.get(id)?.expiresAt) proceduralTimers.set(id, setInterval(tick, 2000));
}

async function finalizeProceduralVote(id) {
  const pv = proceduralVotes.get(id); if (!pv) return;
  try {
    const forC = pv.for.length, agaC = pv.against.length, absC = pv.abstain.length;
    const totalVoted = forC + agaC + absC;
    const passed = forC > agaC;
    const ch = pv.channelId ? await client.channels.fetch(pv.channelId).catch(() => null) : null;
    const msg = ch && pv.messageId ? await ch.messages.fetch(pv.messageId).catch(() => null) : null;
    const meeting = pv.meetingId ? db.getMeeting(pv.meetingId) : null;
    const fields = [
      { name: '✅ За',            value: String(forC), inline: true },
      { name: '❌ Против',        value: String(agaC), inline: true },
      { name: '⚪ Воздержались',  value: String(absC), inline: true },
      { name: '📊 Проголосовало', value: String(totalVoted), inline: true },
      { name: '🔒 Тип',           value: pv.isSecret ? '🔐 Тайное' : '👁️ Открытое', inline: true },
      { name: '📋 Формула',       value: getFormulaDesc(pv.formula), inline: true },
      { name: '🕐 Начало',        value: pv.startedAt ? discordTs(pv.startedAt, 'f') : '—', inline: true },
      { name: '🕐 Завершено',     value: discordTs(Date.now(), 'f'), inline: true }
    ];
    const finalEmbed = buildEmbed({
      color: passed ? COLORS.SUCCESS : COLORS.DANGER,
      title: 'Итоги процедурного вопроса',
      description: [
        meeting?.title ? `**${meeting.title}**` : null,
        `**${pv.question}**`,
        '',
        `${passed ? '✅' : '❌'} Вопрос **${passed ? 'принят' : 'отклонён'}**.`
      ].filter(Boolean).join('\n'),
      fields
    });
    const components = [];
    if (!pv.isSecret) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`view_proc_list_${id}`).setLabel('📄 Поимённый список').setStyle(ButtonStyle.Secondary)
      ));
      proceduralHistory.set(id, {
        question: pv.question,
        for: [...pv.for],
        against: [...pv.against],
        abstain: [...pv.abstain],
        isSecret: pv.isSecret,
        meetingId: pv.meetingId,
        startedAt: pv.startedAt,
        endedAt: Date.now()
      });
      if (proceduralHistory.size > 200) {
        const firstKey = proceduralHistory.keys().next().value;
        if (firstKey) proceduralHistory.delete(firstKey);
      }
    }
    if (msg) await msg.edit({ embeds: [finalEmbed], components }).catch(() => {});
    else if (ch) await ch.send({ embeds: [finalEmbed], components });
  } catch (e) { console.error('❌ finalizeProceduralVote:', e.message); }
  if (pv.timeoutId) clearTimeout(pv.timeoutId);
  if (proceduralTimers.has(id)) { clearInterval(proceduralTimers.get(id)); proceduralTimers.delete(id); }
  proceduralVotes.delete(id);
}

// ════════════════════ VOTING START ═════════════════════════════════
async function handleStartVotingButton(interaction) {
  const pid = interaction.customId.split('start_voting_')[1];
  const p   = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (!isChairman(interaction.member, p.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  if (db.getVoting(pid)?.open) { await replyEphemeral(interaction, '❌ Голосование уже запущено.', TTL_S); return; }
  const openMeetings = db.getOpenMeetings().filter(m => m.status === 'in_session');
  const inAgenda     = openMeetings.some(m => db.getAgenda(m.id).some(a => a.id === pid));
  if (!inAgenda) { await replyEphemeral(interaction, `❌ **${p.number}** не включён в повестку активного заседания.\nИспользуйте \`/vote ${p.number}\` для принудительного запуска.`, TTL_M); return; }
  const modal = new ModalBuilder().setCustomId(`start_vote_modal_${pid}`).setTitle('Параметры голосования');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_duration').setLabel('Время голосования (0 = вручную)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('1h / 30m / 0').setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_secret').setLabel('Тайное голосование? (0 — нет, 1 — да)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vote_formula').setLabel('Формула: 0=больш, 1=⅔, 2=¾, 3=состав').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('0').setMaxLength(1))
  );
  await interaction.showModal(modal);
}

async function handleStartVoteModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid      = interaction.customId.split('start_vote_modal_')[1];
  const ms       = interaction.fields.getTextInputValue('vote_duration').trim() === '0' ? 0 : parseCustomDuration(interaction.fields.getTextInputValue('vote_duration').trim());
  const isSecret = interaction.fields.getTextInputValue('vote_secret').trim() === '1';
  const fInput   = interaction.fields.getTextInputValue('vote_formula').trim();
  const formula  = ['0','1','2','3'].includes(fInput) ? fInput : '0';
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (db.getVoting(pid)?.open) { await replyEphemeral(interaction, '❌ Голосование уже запущено.', TTL_S); return; }
  await launchVoting(interaction, p, ms, isSecret, formula, false, null);
}

function buildQuantitativeVoteComponents(proposalId, page = 0) {
  const items = db.getQuantitativeItems(proposalId);
  const pageCount = Math.max(1, Math.ceil(items.length / QUANT_ITEMS_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = items.slice(safePage * QUANT_ITEMS_PAGE_SIZE, safePage * QUANT_ITEMS_PAGE_SIZE + QUANT_ITEMS_PAGE_SIZE);

  const options = slice.map(it => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(truncate(`Пункт ${it.itemIndex}`, 100))
      .setValue(String(it.itemIndex));
    const desc = truncate(it.text || '', 80);
    if (desc) opt.setDescription(desc);
    return opt;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`vote_item_select_${proposalId}_${safePage}`)
    .setPlaceholder('Выберите пункт')
    .setMinValues(1)
    .setMaxValues(1);

  if (options.length) select.addOptions(options);
  else {
    select.addOptions(new StringSelectMenuOptionBuilder().setLabel('Пункты не заданы').setValue('0'));
    select.setDisabled(true);
  }

  const components = [new ActionRowBuilder().addComponents(select)];
  if (pageCount > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vote_item_page_${proposalId}_${safePage - 1}`).setLabel('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
      new ButtonBuilder().setCustomId(`vote_item_page_${proposalId}_${safePage + 1}`).setLabel('➡️').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pageCount - 1)
    ));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vote_abstain_${proposalId}`).setLabel('⚪ Воздержаться').setStyle(ButtonStyle.Secondary)
  ));
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`end_vote_${proposalId}`).setLabel('⏹️ Завершить голосование').setStyle(ButtonStyle.Danger)
  ));
  return components;
}

async function launchVoting(interaction, proposal, ms, isSecret, formula, isForced, forceReason) {
  const now = Date.now(), pid = proposal.id;
  try {
    const thread = proposal.threadId ? await client.channels.fetch(proposal.threadId).catch(() => null) : null;
    if (!thread || !thread.isThread?.()) throw new Error('Ветка законопроекта не найдена.');
    const voting = { proposalId: pid, open: true, startedAt: now, durationMs: ms, expiresAt: ms > 0 ? now + ms : null, messageId: null, isSecret, formula, isForced: !!isForced, forceReason: isForced ? (forceReason || '') : null, stage: 1 };
    const timeText = ms > 0 ? `🕐 Завершение: ${discordTs(now + ms, 'R')} (${discordTs(now + ms, 'f')})` : '🕐 Завершение: по команде Спикера';

    let voteRows = [];
    if (proposal.isQuantitative) {
      voteRows = buildQuantitativeVoteComponents(pid, 0);
    } else {
      voteRows = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`vote_for_${pid}`).setLabel('✅ За').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`vote_against_${pid}`).setLabel('❌ Против').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`vote_abstain_${pid}`).setLabel('⚪ Воздержаться').setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`end_vote_${pid}`).setLabel('⏹️ Завершить голосование').setStyle(ButtonStyle.Danger))
      ];
    }

    const descParts = [
      `**${proposal.name}**`, '',
      `🔒 Тип: **${isSecret ? 'Тайное' : 'Открытое'}**`,
      `📊 Формула: **${getFormulaDesc(formula)}**`,
      `🕐 Начало: ${discordTs(now, 'f')}`,
      timeText
    ];
    if (forceReason) descParts.push(``, `⚡ **Основание для принудительного запуска:** ${forceReason}`);

    const voteMsg = await thread.send({ embeds: [buildEmbed({
      color: isForced ? COLORS.WARNING : COLORS.INFO,
      title: `🗳️ Голосование — ${proposal.number}${proposal.isQuantitative ? ' · Рейтинговое' : ''}${isForced ? ' · Принудительное' : ''}`,
      description: descParts.join('\n'),
      fields: [
        { name: '✅ За',            value: '0', inline: true },
        { name: '❌ Против',        value: '0', inline: true },
        { name: '⚪ Воздержались',  value: '0', inline: true },
        { name: '📊 Проголосовало', value: '0', inline: true }
      ]
    })], components: voteRows });

    voting.messageId = voteMsg.id;
    db.startVoting(voting);
    if (ms > 0) await startVoteTicker(pid);
    await updateVoteButtonStatus(pid);
    for (const m of db.getOpenMeetings().filter(m => m.status === 'in_session')) if (db.getAgenda(m.id).some(a => a.id === pid)) await refreshMeetingMessage(m.id);
    await replyEphemeral(interaction, `✅ Голосование по **${proposal.number}** успешно запущено.${isForced ? ' (принудительное)' : ''}`, TTL_M);
  } catch (e) { console.error('❌ launchVoting:', e); await replyEphemeral(interaction, '❌ Ошибка запуска голосования: ' + e.message, TTL_S); }
}

// ════════════════════════ CAST VOTE ════════════════════════════════
async function castVote(interaction, proposalId, voteType) {
  await interaction.deferReply({ flags: 64 });
  const p      = db.getProposal(proposalId);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', 0); return; }
  const voting = db.getVoting(proposalId);
  if (!voting?.open) { await replyEphemeral(interaction, '❌ Голосование не активно.', 0); return; }
  const { canVote, reason } = await canUserVote(interaction.user.id);
  if (!canVote) { await replyEphemeral(interaction, reason, TTL_M); return; }
  if (db.hasUserVoted(proposalId, interaction.user.id, voting.stage || 1)) { await replyEphemeral(interaction, '❌ Вы уже проголосовали по данному законопроекту.', 0); return; }
  const added = db.addVote({ proposalId, userId: interaction.user.id, voteType, createdAt: Date.now(), stage: voting.stage || 1 });
  if (!added) { await replyEphemeral(interaction, '❌ Вы уже проголосовали.', 0); return; }
  const label = voteType.startsWith('item_')
    ? (() => { const idx = parseInt(voteType.split('_')[1]); const it = db.getQuantitativeItems(proposalId).find(x => x.itemIndex === idx); return `Пункт ${idx}${it ? ': ' + truncate(it.text, 50) : ''}`; })()
    : getVoteTypeText(voteType);
  await replyEphemeral(interaction, `✅ Ваш голос **«${label}»** принят.`, TTL_M);
}

async function handleRegularVoteButtons(interaction)     { const p = interaction.customId.split('_'); await castVote(interaction, p.slice(2).join('_'), p[1]); }
async function handleQuantitativeVoteButtons(interaction){ const p = interaction.customId.split('_'); await castVote(interaction, p.slice(3).join('_'), `item_${p[2]}`); }
async function handleVoteAbstain(interaction)            { await castVote(interaction, interaction.customId.split('vote_abstain_')[1], 'abstain'); }

async function handleQuantitativeVoteSelect(interaction) {
  const parts = interaction.customId.split('_');
  const proposalId = parts[3];
  const itemIndex = interaction.values[0];
  if (!proposalId || !itemIndex || itemIndex === '0') {
    await replyEphemeral(interaction, '❌ Пункты голосования не заданы.', TTL_S);
    return;
  }
  await castVote(interaction, proposalId, `item_${itemIndex}`);
}

async function handleQuantitativeVotePageButton(interaction) {
  const parts = interaction.customId.split('_');
  const proposalId = parts[3];
  const rawPage = parseInt(parts[4]);
  const page = Number.isFinite(rawPage) ? rawPage : 0;
  const voting = proposalId ? db.getVoting(proposalId) : null;
  if (!voting?.open) { await replyEphemeral(interaction, '❌ Голосование не активно.', TTL_S); return; }
  await interaction.update({ components: buildQuantitativeVoteComponents(proposalId, page) });
}

async function handleViewVoteListButton(interaction) {
  const parts = interaction.customId.split('_');
  const proposalId = parts[3];
  const stage = parseInt(parts[4]) || 1;
  const embeds = buildVoteListEmbeds(proposalId, stage, { includeSecretWarning: true });
  if (!embeds) { await replyEphemeral(interaction, 'ℹ️ Поимённый список не найден.', TTL_S); return; }
  await sendEphemeralEmbeds(interaction, embeds, TTL_L);
}

async function handleViewProceduralListButton(interaction) {
  const id = interaction.customId.replace('view_proc_list_', '');
  const data = proceduralHistory.get(id);
  if (!data) { await replyEphemeral(interaction, 'ℹ️ Поимённый список не найден.', TTL_S); return; }
  const lines = [
    '## 🗳️ Поимённый список',
    data.question ? `**${data.question}**` : '**Процедурный вопрос**',
    '---'
  ];
  const addSection = (title, arr) => {
    lines.push(`**${title} (${arr.length})**`);
    if (arr.length) for (const uid of arr) lines.push(`• <@${uid}>`);
    else lines.push('*нет*');
    lines.push('');
  };
  addSection('✅ За', data.for);
  addSection('❌ Против', data.against);
  addSection('⚪ Воздержались', data.abstain);
  await sendEphemeralChunks(interaction, lines.join('\n'), TTL_L);
}

// ════════════════════ ANNUL VOTE ════════════════════════════════════
async function handleAnnulVotingButton(interaction) {
  const pid = interaction.customId.split('annul_voting_')[1];
  const p   = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (!isChairman(interaction.member, p.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`annul_vote_modal_${pid}`).setTitle('Аннулирование голосования');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('annul_reason').setLabel('Основание для аннулирования').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
  await interaction.showModal(modal);
}

async function handleAnnulVoteModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid    = interaction.customId.split('annul_vote_modal_')[1];
  const reason = interaction.fields.getTextInputValue('annul_reason');
  const p      = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  const voting = db.getVoting(pid);
  if (voting?.open) { db.annulVoting(pid, reason); if (voteTimers.has(pid)) { clearInterval(voteTimers.get(pid)); voteTimers.delete(pid); } }
  for (const s of [...new Set(db.getVotesAllStages(pid).map(v => v.stage))]) db.deleteVotesForStage(pid, s);
  if (voting?.messageId) {
    const thread = await client.channels.fetch(p.threadId).catch(() => null);
    if (thread) { const vm = await thread.messages.fetch(voting.messageId).catch(() => null); if (vm) await vm.edit({ embeds: [buildEmbed({ color: COLORS.WARNING, title: `🔄 Голосование аннулировано — ${p.number}`, description: `> Голосование отменено Спикером.`, fields: [{ name: '📋 Основание', value: reason, inline: false }, { name: '👤 Инициатор', value: `<@${interaction.user.id}>`, inline: true }] })], components: [] }).catch(() => {}); }
  }
  db.updateProposalStatus(pid, 'На рассмотрении');
  await addProposalEvent(pid, { type: 'vote_annulled', timestamp: Date.now(), chamber: p.chamber, description: `Аннулировано <@${interaction.user.id}>. Основание: ${reason}` });
  await updateVoteButtonStatus(pid);
  await replyEphemeral(interaction, '✅ Голосование аннулировано. Законопроект возвращён в статус «На рассмотрении».', TTL_M);
}

// ════════════════════ FINALIZE VOTE ════════════════════════════════
async function finalizeVote(proposalId) {
  const p = db.getProposal(proposalId); if (!p) return;
  const v = db.getVoting(proposalId);
  if (p.isQuantitative && v?.stage === 2) await finalizeQuantitativeRunoff(proposalId);
  else if (p.isQuantitative)              await finalizeQuantitativeVote(proposalId);
  else                                    await finalizeRegularVote(proposalId);
}

async function finalizeRegularVote(proposalId) {
  const p = db.getProposal(proposalId), voting = db.getVoting(proposalId);
  const formula = voting?.formula || '0', isSecret = voting?.isSecret || false;
  const totalMembers = await getActiveMemberCount(), quorumVal = calcQuorum(totalMembers);
  const { forCount, againstCount, abstainCount, totalVoted } = computeVoteCounts(proposalId);
  const { req, isPassed } = calcVoteResult(forCount, againstCount, abstainCount, formula, totalMembers);
  const isQuorumMet = totalVoted >= quorumVal;
  const isTie       = forCount === againstCount && forCount > 0 && formula === '0';

  let resultText = 'Не принято', resultColor = COLORS.SECONDARY, tagId = FORUM_TAGS.NOT_APPROVED;
  if (!isQuorumMet)  resultText = 'Не принято (кворум не собран)';
  else if (isTie)    { resultText = 'Ничья — решающий голос'; resultColor = COLORS.WARNING; }
  else if (isPassed) { resultText = 'Принято'; resultColor = COLORS.SUCCESS; tagId = FORUM_TAGS.APPROVED; }
  else               { resultText = 'Отклонено'; resultColor = COLORS.DANGER; tagId = FORUM_TAGS.REJECTED; }

  const reqDisplay = formula === '0' ? 'За > Против' : String(req);
  const embed = buildEmbed({ color: resultColor,
    title: `📊 Итоги голосования — ${p.number}`,
    description: [
      `## ${resultText === 'Принято' ? '✅' : resultText === 'Отклонено' ? '❌' : resultText.includes('Ничья') ? '⚖️' : '❌'} Результат: **${resultText}**`,
      '',
      `**Законопроект:** ${p.number} — ${p.name}`
    ].join('\n'),
    fields: [
      { name: '✅ За',            value: String(forCount),     inline: true },
      { name: '❌ Против',        value: String(againstCount), inline: true },
      { name: '⚪ Воздержалось',  value: String(abstainCount), inline: true },
      { name: '📊 Проголосовало', value: String(totalVoted),   inline: true },
      { name: '📋 Требовалось',   value: reqDisplay,           inline: true },
      { name: '👥 Состав',        value: String(totalMembers), inline: true },
      { name: '📊 Кворум',        value: `${quorumVal} (⌊N/2⌋)`, inline: true },
      { name: '📈 Кворум',        value: isQuorumMet ? '✅ Собран' : '❌ Не собран', inline: true },
      { name: '🔒 Тип',           value: isSecret ? '🔐 Тайное' : '👁️ Открытое', inline: true },
      { name: '📋 Формула',       value: getFormulaDesc(formula), inline: true },
      { name: '🕐 Начало',        value: voting?.startedAt ? discordTs(voting.startedAt, 'f') : '—', inline: true },
      { name: '🕐 Завершено',     value: discordTs(Date.now(), 'f'), inline: true }
    ]
  });

  try {
    const thread = await client.channels.fetch(p.threadId);
    let components = [];
    if (resultText === 'Принято') {
      const btns = [
        new ButtonBuilder().setCustomId(`governor_approve_${p.id}`).setLabel('✅ Одобрить (Губернатор)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`governor_veto_${p.id}`).setLabel('🚫 Вето').setStyle(ButtonStyle.Danger)
      ];
      components = [new ActionRowBuilder().addComponents(...btns)];
    }
    if (!isSecret) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`view_vote_list_${proposalId}_${voting?.stage || 1}`).setLabel('📄 Поимённый список').setStyle(ButtonStyle.Secondary)
      ));
    }
    const voteMsg = voting?.messageId ? await thread.messages.fetch(voting.messageId).catch(() => null) : null;
    if (voteMsg) await voteMsg.edit({ content: null, embeds: [embed], components }).catch(() => {});
    else await thread.send({ embeds: [embed], components });
    if (!isTie && resultText !== 'Принято') setTimeout(() => closeThreadWithTag(p.threadId, tagId), 30000);
    if (isTie) await sendTieBreakerMessage(proposalId, forCount, againstCount, abstainCount);
  } catch (e) { console.error('❌ finalizeRegularVote:', e.message); }

  if (!isTie) {
    db.endVoting(proposalId, Date.now()); db.updateProposalStatus(proposalId, resultText);
    let desc = `Результат: **${resultText}** | За: ${forCount} | Против: ${againstCount} | Воздержались: ${abstainCount}`;
    if (voting?.isForced && voting?.forceReason) desc += `\n⚡ Принудительный запуск: ${voting.forceReason}`;
    await addProposalEvent(proposalId, { type: 'vote_result', result: resultText, timestamp: Date.now(), chamber: p.chamber, description: desc });
    if (voteTimers.has(proposalId)) { clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId); }
  }
  await updateVoteButtonStatus(proposalId);
  for (const m of db.getOpenMeetings().filter(m => m.status === 'in_session')) if (db.getAgenda(m.id).some(a => a.id === proposalId)) await refreshMeetingMessage(m.id);
}

async function sendTieBreakerMessage(proposalId, forCount, againstCount, abstainCount) {
  const p = db.getProposal(proposalId); if (!p) return;
  try {
    const thread = await client.channels.fetch(p.threadId);
    await thread.send({ content: ROLES.CHAIRMAN ? `<@&${ROLES.CHAIRMAN}>` : null,
      embeds: [buildEmbed({ color: COLORS.WARNING, title: `⚖️ Голоса разделились — ${p.number}`,
        description: `За: **${forCount}** | Против: **${againstCount}** | Воздержались: **${abstainCount}**\n\n> Требуется решающий голос Спикера.`
      })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`chairman_vote_for_${proposalId}`).setLabel('✅ Решающий голос — За').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`chairman_vote_against_${proposalId}`).setLabel('❌ Решающий голос — Против').setStyle(ButtonStyle.Danger)
      )]
    });
  } catch (e) { console.error('❌ sendTieBreakerMessage:', e.message); }
}

async function handleChairmanVoteButton(interaction) {
  await interaction.deferReply({ flags: 64 });
  const parts = interaction.customId.split('_'), voteType = parts[2], proposalId = parts.slice(3).join('_');
  const p = db.getProposal(proposalId);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (!isChairman(interaction.member, p.chamber)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  await interaction.message.edit({ components: [] }).catch(() => {});
  const voting = db.getVoting(proposalId);
  const added  = db.addVote({ proposalId, userId: interaction.user.id, voteType, createdAt: Date.now(), stage: voting?.stage || 1 });
  if (!added) { await replyEphemeral(interaction, 'ℹ️ Решающий голос Спикера уже учтён.', TTL_S); return; }
  const { forCount, againstCount, abstainCount } = computeVoteCounts(proposalId, voting?.stage || 1);
  const resultText = forCount > againstCount ? 'Принято' : 'Отклонено';
  try {
    const thread = await client.channels.fetch(p.threadId);
    let components = [];
    if (resultText === 'Принято') {
      const btns = [
        new ButtonBuilder().setCustomId(`governor_approve_${p.id}`).setLabel('✅ Одобрить (Губернатор)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`governor_veto_${p.id}`).setLabel('🚫 Вето').setStyle(ButtonStyle.Danger)
      ];
      components = [new ActionRowBuilder().addComponents(...btns)];
    }
    await thread.send({ embeds: [buildEmbed({ color: resultText === 'Принято' ? COLORS.SUCCESS : COLORS.DANGER,
      title: `🎯 Решающий голос Спикера — ${p.number}`,
      description: `## ${resultText === 'Принято' ? '✅' : '❌'} ${resultText}\n\n<@${interaction.user.id}> — **${getVoteTypeText(voteType)}**`,
      fields: [
        { name: '✅ За',           value: String(forCount),     inline: true },
        { name: '❌ Против',       value: String(againstCount), inline: true },
        { name: '⚪ Воздержалось', value: String(abstainCount), inline: true }
      ]
    })], components });
    if (resultText !== 'Принято') setTimeout(() => closeThreadWithTag(p.threadId, resultText === 'Отклонено' ? FORUM_TAGS.REJECTED : FORUM_TAGS.NOT_APPROVED), 30000);
  } catch (e) { console.error('❌ chairmanVote:', e.message); }
  db.endVoting(proposalId, Date.now()); db.updateProposalStatus(proposalId, resultText);
  let desc = `Решающий голос Спикера. Результат: **${resultText}**`;
  if (voting?.isForced && voting?.forceReason) desc += `\n⚡ Принудительный запуск: ${voting.forceReason}`;
  await addProposalEvent(proposalId, { type: 'vote_result', result: resultText, timestamp: Date.now(), chamber: p.chamber, description: desc });
  if (voteTimers.has(proposalId)) { clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId); }
  await replyEphemeral(interaction, '✅ Решающий голос Спикера принят.', TTL_M);
  await updateVoteButtonStatus(proposalId);
  for (const m of db.getOpenMeetings().filter(m => m.status === 'in_session')) if (db.getAgenda(m.id).some(a => a.id === proposalId)) await refreshMeetingMessage(m.id);
}

async function handleEndVoteButton(interaction) {
  const pid = interaction.customId.split('end_vote_')[1];
  const p   = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (!isChairman(interaction.member, p.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  await finalizeVote(pid);
  await replyEphemeral(interaction, '✅ Голосование завершено.', TTL_M);
}

async function updateQuantitativeStructureMessage(proposalId) {
  const p = db.getProposal(proposalId); if (!p?.threadId) return;
  const items = db.getQuantitativeItems(proposalId);
  const thread = await client.channels.fetch(p.threadId).catch(() => null);
  if (!thread) return;
  const title = `📊 Структура рейтингового голосования — ${p.number}`;
  const embed = buildEmbed({ color: COLORS.INFO, title });
  items.forEach(it => embed.addFields({ name: `📌 Пункт ${it.itemIndex}`, value: it.text, inline: false }));

  try {
    const messages = await thread.messages.fetch({ limit: 50 }).catch(() => null);
    const found = messages ? messages.find(m => m.author?.id === client.user?.id && m.embeds?.some(e => e.title === title)) : null;
    if (found) await found.edit({ embeds: [embed] }).catch(() => {});
    else await thread.send({ embeds: [embed] });
  } catch (e) { console.error('❌ updateQuantitativeStructureMessage:', e.message); }
}

async function handleEditQuantitativeItemsButton(interaction) {
  const pid = interaction.customId.replace('edit_quant_items_', '');
  const p = db.getProposal(pid);
  if (!p || !p.isQuantitative) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (interaction.user.id !== p.authorId && !isChairman(interaction.member, p.chamber) && !isAdmin(interaction.member)) {
    await replyEphemeral(interaction, '❌ Недостаточно прав для редактирования.', TTL_S); return;
  }
  if (db.getVoting(pid)?.open) { await replyEphemeral(interaction, '❌ Нельзя редактировать пункты во время голосования.', TTL_S); return; }

  const items = db.getQuantitativeItems(pid).map(it => it.text).join('; ');
  const modal = new ModalBuilder().setCustomId(`edit_quant_items_modal_${pid}`).setTitle('Редактирование пунктов');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('items').setLabel('Пункты голосования (через ;)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(items.slice(0, 2000)))
  );
  await interaction.showModal(modal);
}

async function handleEditQuantitativeItemsModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid = interaction.customId.replace('edit_quant_items_modal_', '');
  const p = db.getProposal(pid);
  if (!p || !p.isQuantitative) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (interaction.user.id !== p.authorId && !isChairman(interaction.member, p.chamber) && !isAdmin(interaction.member)) {
    await replyEphemeral(interaction, '❌ Недостаточно прав для редактирования.', TTL_S); return;
  }
  if (db.getVoting(pid)?.open) { await replyEphemeral(interaction, '❌ Нельзя редактировать пункты во время голосования.', TTL_S); return; }

  const rawItems = interaction.fields.getTextInputValue('items') || '';
  const list = rawItems.split(';').map(s => s.trim()).filter(Boolean);
  if (!list.length) { await replyEphemeral(interaction, '❌ Укажите хотя бы один пункт.', TTL_S); return; }

  db.replaceQuantitativeItems(pid, list.map((text, i) => ({ proposalId: pid, itemIndex: i + 1, text })));
  await updateQuantitativeStructureMessage(pid);
  await replyEphemeral(interaction, '✅ Пункты рейтингового голосования обновлены.', TTL_M);
}

// ════════════════════ QUANTITATIVE ═════════════════════════════════
async function finalizeQuantitativeVote(proposalId) {
  const p = db.getProposal(proposalId), voting = db.getVoting(proposalId);
  const items = db.getQuantitativeItems(proposalId), votes = db.getVotes(proposalId);
  const totalMembers = await getActiveMemberCount(), quorumVal = calcQuorum(totalMembers);
  const iv = {}; let abstainCount = 0; const voters = new Set();
  items.forEach(it => { iv[it.itemIndex] = 0; });
  for (const v of votes) { voters.add(v.userId); if (v.voteType.startsWith('item_')) { const idx = parseInt(v.voteType.split('_')[1]); if (iv[idx] !== undefined) iv[idx]++; } else if (v.voteType === 'abstain') abstainCount++; }
  const totalVoted = voters.size, isQuorumMet = totalVoted >= quorumVal;
  const ranked = Object.entries(iv).map(([idx, cnt]) => ({ index: parseInt(idx), votes: cnt, text: items.find(it => it.itemIndex === parseInt(idx))?.text || '' })).sort((a, b) => b.votes - a.votes);
  const maxVotes = ranked[0]?.votes || 0, winners = ranked.filter(it => it.votes === maxVotes && maxVotes > 0);
  let resultText = 'Не принято', resultColor = COLORS.SECONDARY, tagId = FORUM_TAGS.NOT_APPROVED, needRunoff = false;
  if (!isQuorumMet) resultText = 'Не принято (кворум не собран)';
  else if (!winners.length) resultText = 'Голосов нет';
  else if (winners.length === 1) { resultText = `Принят пункт ${winners[0].index}`; resultColor = COLORS.SUCCESS; tagId = FORUM_TAGS.APPROVED; }
  else { resultText = 'Требуется второй тур'; resultColor = COLORS.WARNING; needRunoff = true; }
  const placeEmojis = ['🥇','🥈','🥉','4️⃣','5️⃣']; let rankDesc = ''; let prev = -1, place = 1;
  for (let i = 0; i < ranked.length; i++) {
    const it = ranked[i]; if (it.votes !== prev) place = i + 1; prev = it.votes;
    const pct = totalVoted > 0 ? Math.round(it.votes / totalVoted * 100) : 0;
    rankDesc += `${placeEmojis[place-1] || place+'.'}  **Пункт ${it.index}**${!needRunoff && winners.some(w => w.index === it.index) ? ' ✅' : ''}\n${it.text}\nГолосов: **${it.votes}** (${pct}%)\n\n`;
  }
  const embed = buildEmbed({ color: resultColor, title: `📊 Итоги рейтингового голосования — ${p.number}`,
    description: [`## ${resultText.includes('Принят') ? '✅' : resultText.includes('тур') ? '⚠️' : '❌'} Результат: **${resultText}**`, '', `**Законопроект:** ${p.number} — ${p.name}`].join('\n'),
    fields: [
      { name: '📊 Проголосовало', value: String(totalVoted), inline: true },
      { name: '📋 Кворум',       value: `${quorumVal}`, inline: true },
      { name: '📈 Кворум',       value: isQuorumMet ? '✅ Собран' : '❌ Не собран', inline: true },
      { name: '⚪ Воздержалось',  value: String(abstainCount), inline: true },
      { name: '🏅 Рейтинг',      value: rankDesc.substring(0, 1024) || '*нет данных*', inline: false }
    ]
  });
  try {
    const thread = await client.channels.fetch(p.threadId);
    const comps  = needRunoff ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`start_quantitative_runoff_${proposalId}`).setLabel('⚡ Запустить второй тур').setStyle(ButtonStyle.Primary))] : [];
    if (!(voting?.isSecret)) {
      comps.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`view_vote_list_${proposalId}_${voting?.stage || 1}`).setLabel('📄 Поимённый список').setStyle(ButtonStyle.Secondary)
      ));
    }
    const vm = voting?.messageId ? await thread.messages.fetch(voting.messageId).catch(() => null) : null;
    if (vm) await vm.edit({ content: null, embeds: [embed], components: comps });
    else await thread.send({ embeds: [embed], components: comps });
    if (!needRunoff) setTimeout(() => closeThreadWithTag(p.threadId, tagId), 30000);
  } catch (e) { console.error('❌ finalizeQuantitativeVote:', e.message); }
  if (!needRunoff) { db.endVoting(proposalId, Date.now()); db.updateProposalStatus(proposalId, resultText); let desc = `Рейтинговое. Результат: **${resultText}**`; if (voting?.isForced && voting?.forceReason) desc += `\n⚡ Принудительный запуск: ${voting.forceReason}`; await addProposalEvent(proposalId, { type: 'vote_result', result: resultText, timestamp: Date.now(), chamber: p.chamber, description: desc }); if (voteTimers.has(proposalId)) { clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId); } }
  await updateVoteButtonStatus(proposalId);
  for (const m of db.getOpenMeetings().filter(m => m.status === 'in_session')) if (db.getAgenda(m.id).some(a => a.id === proposalId)) await refreshMeetingMessage(m.id);
}

async function finalizeQuantitativeRunoff(proposalId) {
  const p = db.getProposal(proposalId), voting = db.getVoting(proposalId);
  const items = db.getQuantitativeItems(proposalId), votes = db.getVotes(proposalId, 2);
  const totalMembers = await getActiveMemberCount(), quorumVal = calcQuorum(totalMembers);
  const iv = {}; let abstainCount = 0; const voters = new Set();
  for (const v of votes) { voters.add(v.userId); if (v.voteType.startsWith('item_')) { const idx = parseInt(v.voteType.split('_')[1]); iv[idx] = (iv[idx] || 0) + 1; } else if (v.voteType === 'abstain') abstainCount++; }
  const totalVoted = voters.size, isQuorumMet = totalVoted >= quorumVal;
  const ranked = Object.entries(iv).map(([idx, cnt]) => ({ index: parseInt(idx), votes: cnt, text: items.find(it => it.itemIndex === parseInt(idx))?.text || '' })).sort((a, b) => b.votes - a.votes);
  const maxVotes = ranked[0]?.votes || 0, winners = ranked.filter(it => it.votes === maxVotes && maxVotes > 0);
  let resultText = 'Не принято', resultColor = COLORS.SECONDARY, tagId = FORUM_TAGS.NOT_APPROVED;
  if (!isQuorumMet) resultText = 'Не принято (кворум не собран)';
  else if (!winners.length) resultText = 'Нет победителя';
  else if (winners.length > 1) { resultText = 'Голоса разделились'; resultColor = COLORS.WARNING; }
  else { resultText = `Принят пункт ${winners[0].index}`; resultColor = COLORS.SUCCESS; tagId = FORUM_TAGS.APPROVED; }
  let rankDesc = '';
  for (const it of ranked) { const pct = totalVoted > 0 ? Math.round(it.votes / totalVoted * 100) : 0; rankDesc += `${winners.some(w => w.index === it.index) ? '🏆' : '•'} **Пункт ${it.index}:** **${it.votes}** (${pct}%) — ${it.text}\n`; }
  const embed = buildEmbed({ color: resultColor, title: `📊 Итоги второго тура — ${p.number}`,
    description: [`## ${winners.length === 1 ? '✅' : '⚠️'} Результат: **${resultText}**`, '', `**Законопроект:** ${p.number} — ${p.name}`].join('\n'),
    fields: [
      { name: '👥 Проголосовало', value: String(totalVoted), inline: true },
      { name: '📋 Кворум',       value: `${quorumVal}`, inline: true },
      { name: '📈 Кворум',       value: isQuorumMet ? '✅' : '❌', inline: true },
      { name: '📊 Результаты',   value: rankDesc.substring(0, 1024) || '*нет данных*', inline: false }
    ]
  });
  if (winners.length === 1) embed.addFields({ name: '🏆 Победитель', value: `**Пункт ${winners[0].index}:** ${winners[0].text}`, inline: false });
  try {
    const thread = await client.channels.fetch(p.threadId);
    const comps = [];
    if (!(voting?.isSecret)) {
      comps.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`view_vote_list_${proposalId}_${voting?.stage || 2}`).setLabel('📄 Поимённый список').setStyle(ButtonStyle.Secondary)
      ));
    }
    if (voting?.runoffMessageId) { const rm = await thread.messages.fetch(voting.runoffMessageId).catch(() => null); if (rm) await rm.edit({ embeds: [embed], components: comps }).catch(() => {}); }
    else await thread.send({ embeds: [embed], components: comps });
    if (winners.length !== 1) await sendTieBreakerMessage(proposalId, maxVotes, 0, abstainCount);
    else setTimeout(() => closeThreadWithTag(p.threadId, tagId), 30000);
  } catch (e) { console.error('❌ finalizeQuantitativeRunoff:', e.message); }
  if (winners.length === 1) { db.endVoting(proposalId, Date.now()); db.updateProposalStatus(proposalId, resultText); let desc = `Второй тур. Результат: **${resultText}**`; if (voting?.isForced && voting?.forceReason) desc += `\n⚡ Принудительный запуск: ${voting.forceReason}`; await addProposalEvent(proposalId, { type: 'vote_result', result: resultText, timestamp: Date.now(), chamber: p.chamber, description: desc }); if (voteTimers.has(proposalId)) { clearInterval(voteTimers.get(proposalId)); voteTimers.delete(proposalId); } }
  await updateVoteButtonStatus(proposalId);
}

async function handleStartQuantitativeRunoffButton(interaction) {
  const proposalId = interaction.customId.split('start_quantitative_runoff_')[1];
  const p = db.getProposal(proposalId);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (!isChairman(interaction.member, p.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`quantitative_runoff_modal_${proposalId}`).setTitle('Параметры второго тура');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('runoff_duration').setLabel('Время голосования (0 = вручную)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('1h / 30m / 0').setMaxLength(20)));
  await interaction.showModal(modal);
}

async function handleQuantitativeRunoffModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const proposalId = interaction.customId.split('quantitative_runoff_modal_')[1];
  const rawDur     = interaction.fields.getTextInputValue('runoff_duration').trim();
  const ms         = rawDur === '0' ? 0 : parseCustomDuration(rawDur);
  const p          = db.getProposal(proposalId);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  const items = db.getQuantitativeItems(proposalId), votes = db.getVotes(proposalId);
  const iv = {}; items.forEach(it => { iv[it.itemIndex] = 0; });
  for (const v of votes) if (v.voteType.startsWith('item_')) { const idx = parseInt(v.voteType.split('_')[1]); if (iv[idx] !== undefined) iv[idx]++; }
  const top2 = Object.entries(iv).map(([idx, cnt]) => ({ index: parseInt(idx), votes: cnt })).sort((a, b) => b.votes - a.votes).slice(0, 2);
  const now = Date.now();
  const voting = { proposalId, open: true, startedAt: now, durationMs: ms, expiresAt: ms > 0 ? now + ms : null, messageId: null, isSecret: false, formula: '0', stage: 2 };
  try {
    const thread = await client.channels.fetch(p.threadId);
    const embed  = buildEmbed({ color: COLORS.WARNING, title: `⚡ Второй тур — ${p.number}`,
      description: `**${p.name}**\n\n> Выберите один из двух пунктов, набравших наибольшее количество голосов.\n\n${ms > 0 ? `🕐 Завершение: ${discordTs(now + ms, 'R')}` : '🕐 Завершение: по команде Спикера'}` });
    const itemRow = new ActionRowBuilder();
    for (const it of top2) itemRow.addComponents(new ButtonBuilder().setCustomId(`vote_item_${it.index}_${proposalId}`).setLabel(`📌 Пункт ${it.index}`).setStyle(ButtonStyle.Primary));
    itemRow.addComponents(new ButtonBuilder().setCustomId(`vote_abstain_${proposalId}`).setLabel('⚪ Воздержаться').setStyle(ButtonStyle.Secondary));
    const rm = await thread.send({ embeds: [embed], components: [itemRow, new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`end_vote_${proposalId}`).setLabel('⏹️ Завершить голосование').setStyle(ButtonStyle.Danger))] });
    voting.runoffMessageId = rm.id; db.startVoting(voting);
    if (ms > 0) await startVoteTicker(proposalId);
    await replyEphemeral(interaction, '✅ Второй тур запущен.', TTL_M);
  } catch (e) { await replyEphemeral(interaction, '❌ Ошибка при запуске второго тура.', TTL_S); }
}

// ════════════════════ GOVERNOR / FEDERAL ═══════════════════════════
async function handleGovernorApprove(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid = interaction.customId.split('governor_approve_')[1];
  if (!isAdmin(interaction.member) && !isFedGov(interaction.user.id)) { await replyEphemeral(interaction, '❌ Недостаточно прав.', TTL_S); return; }
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  await interaction.message.edit({ components: [] }).catch(() => {});
  db.updateProposalStatus(pid, 'Одобрен Губернатором');
  await addProposalEvent(pid, { type: 'governor_review', timestamp: Date.now(), description: `Одобрен Губернатором (<@${interaction.user.id}>). Направлен на подпись.` });
  try {
    const thread = await client.channels.fetch(p.threadId);
    await thread.send({ embeds: [buildEmbed({ color: COLORS.SUCCESS, title: `✅ Одобрено Губернатором — ${p.number}`,
      description: 'Законопроект одобрен и направлен на подпись в Федеральное правительство.',
      fields: [{ name: '👤 Одобрил', value: `<@${interaction.user.id}>`, inline: true }, { name: '🕐 Дата', value: discordTs(Date.now(), 'f'), inline: true }]
    })] });
    const fedMsg = await thread.send({ content: ROLES.FED_GOV ? `<@&${ROLES.FED_GOV}>` : null,
      embeds: [buildEmbed({ color: COLORS.GOLD, title: `🏛️ Законопроект на подписании — ${p.number}`,
        description: `**${p.name}**\n\n> Ожидается решение Федерального правительства.`,
        fields: [{ name: '👤 Автор', value: `<@${p.authorId}>`, inline: true }, { name: '📅 Дата', value: discordTs(Date.now(), 'f'), inline: true }]
      })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fed_gov_approve_${pid}`).setLabel('🖊️ Подписать').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fed_gov_return_${pid}`).setLabel('↩️ Вернуть на доработку').setStyle(ButtonStyle.Secondary)
      )]
    });
    db.updateProposalFedGovMsg(pid, fedMsg.id);
  } catch (e) { console.error('❌ handleGovernorApprove:', e.message); }
  await replyEphemeral(interaction, '✅ Законопроект одобрен Губернатором.', TTL_M);
}

async function handleGovernorVeto(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid = interaction.customId.split('governor_veto_')[1];
  if (!isAdmin(interaction.member) && !isFedGov(interaction.user.id)) { await replyEphemeral(interaction, '❌ Недостаточно прав.', TTL_S); return; }
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  await interaction.message.edit({ components: [] }).catch(() => {});
  const modal = new ModalBuilder().setCustomId(`governor_veto_modal_${pid}`).setTitle('Вето Губернатора');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('veto_reason').setLabel('Обоснование вето').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
  // Нужно сначала закрыть defer, потом showModal — используем showModal до defer
  // Переделаем: не defer, сразу modal
  await replyEphemeral(interaction, '⚙️ Обработка...', TTL_S);
}

// Упрощённый вариант вето (без доп. модала, причина вето — опциональная, отдельной командой или стандартно)
async function handleGovernorVetoButton(interaction) {
  const pid = interaction.customId.split('governor_veto_')[1];
  if (!isAdmin(interaction.member) && !isFedGov(interaction.user.id)) { await replyEphemeral(interaction, '❌ Недостаточно прав.', TTL_S); return; }
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`governor_veto_reason_${pid}`).setTitle('Вето Губернатора');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('veto_reason').setLabel('Обоснование вето').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
  await interaction.showModal(modal);
}

async function handleGovernorVetoModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid    = interaction.customId.split('governor_veto_reason_')[1];
  const reason = interaction.fields.getTextInputValue('veto_reason').trim();
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  db.updateProposalStatus(pid, 'Вето Губернатора');
  await addProposalEvent(pid, { type: 'governor_vetoed', timestamp: Date.now(), description: `Вето Губернатора (<@${interaction.user.id}>). Причина: ${reason}` });
  try {
    const thread = await client.channels.fetch(p.threadId);
    await thread.send({ embeds: [buildEmbed({ color: COLORS.DANGER, title: `🚫 Вето Губернатора — ${p.number}`,
      description: `Законопроект возвращён в Сенат. (ст. 30)`,
      fields: [
        { name: '👤 Губернатор', value: `<@${interaction.user.id}>`, inline: true },
        { name: '📋 Обоснование', value: reason, inline: false }
      ]
    })] });
    const voting = db.getVoting(pid);
    if (voting?.messageId) {
      const voteMsg = await thread.messages.fetch(voting.messageId).catch(() => null);
      const comps = !voting.isSecret
        ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`view_vote_list_${pid}_${voting?.stage || 1}`).setLabel('📄 Поимённый список').setStyle(ButtonStyle.Secondary)
          )]
        : [];
      if (voteMsg) await voteMsg.edit({ components: comps }).catch(() => {});
    }
    setTimeout(() => closeThreadWithTag(p.threadId, FORUM_TAGS.VETOED), 30000);
  } catch (e) { console.error('❌ handleGovernorVetoModal:', e.message); }
  await replyEphemeral(interaction, '✅ Вето Губернатора применено.', TTL_M);
}

async function handleFedGovButtons(interaction) {
  const isSign = interaction.customId.startsWith('fed_gov_approve_');
  const pid    = isSign ? interaction.customId.split('fed_gov_approve_')[1] : interaction.customId.split('fed_gov_return_')[1];
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (!isAdmin(interaction.member) && !isFedGov(interaction.user.id)) { await replyEphemeral(interaction, '❌ Недостаточно прав.', TTL_S); return; }

  if (!isSign) {
    // Возврат на доработку — требует причины
    const modal = new ModalBuilder().setCustomId(`fed_return_modal_${pid}`).setTitle('Возврат на доработку');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('return_reason').setLabel('Причина возврата на доработку').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
    await interaction.showModal(modal);
    return;
  }

  // Подписание
  await interaction.deferReply({ flags: 64 });
  await interaction.message.edit({ components: [] }).catch(() => {});
  db.updateProposalStatus(pid, 'Подписан');
  await addProposalEvent(pid, { type: 'federal_gov_approval', timestamp: Date.now(), description: `Подписан (<@${interaction.user.id}>). Закон вступает в силу.` });
  try {
    const signedEmbed = buildEmbed({ color: COLORS.GOLD, title: `🖊️ Закон подписан — ${p.number}`,
      description: `**${p.name}**\n\n> Закон вступает в силу. (ст. 5.5)`,
      fields: [{ name: '✍️ Подписал', value: `<@${interaction.user.id}>`, inline: true }, { name: '📅 Дата', value: discordTs(Date.now(), 'f'), inline: true }]
    });
    if (p.fedGovMessageId) {
      const thread = await client.channels.fetch(p.threadId);
      const fedMsg = await thread.messages.fetch(p.fedGovMessageId).catch(() => null);
      if (fedMsg) await fedMsg.edit({ embeds: [signedEmbed], components: [] }).catch(() => {});
    }
    await closeThreadWithTag(p.threadId, FORUM_TAGS.SIGNED);
  } catch (e) { console.error('❌ fedGovApprove:', e.message); }
  await replyEphemeral(interaction, '✅ Закон подписан. Вступает в силу.', TTL_M);
}

async function handleFedReturnModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid    = interaction.customId.split('fed_return_modal_')[1];
  const reason = interaction.fields.getTextInputValue('return_reason').trim();
  const p = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  await interaction.message?.edit({ components: [] }).catch(() => {});
  db.updateProposalStatus(pid, 'Возвращён на доработку');
  await addProposalEvent(pid, { type: 'federal_gov_return', timestamp: Date.now(), description: `Возвращён на доработку (<@${interaction.user.id}>). Причина: ${reason}` });
  try {
    const returnEmbed = buildEmbed({ color: COLORS.WARNING, title: `↩️ Возвращён на доработку — ${p.number}`,
      description: `**${p.name}**`,
      fields: [{ name: '👤 Вернул', value: `<@${interaction.user.id}>`, inline: true }, { name: '📋 Причина', value: reason, inline: false }]
    });
    if (p.fedGovMessageId) {
      const thread = await client.channels.fetch(p.threadId);
      const fedMsg = await thread.messages.fetch(p.fedGovMessageId).catch(() => null);
      if (fedMsg) await fedMsg.edit({ embeds: [returnEmbed], components: [] }).catch(() => {});
    }
  } catch (e) { console.error('❌ handleFedReturnModal:', e.message); }
  await replyEphemeral(interaction, '✅ Законопроект возвращён на доработку.', TTL_M);
}

// ════════════════════ DELETE PROPOSAL ══════════════════════════════
async function handleDeleteProposalButton(interaction) {
  const pid = interaction.customId.split('delete_proposal_')[1];
  const p   = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  if (interaction.user.id !== p.authorId && !isChairman(interaction.member, p.chamber) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Недостаточно прав для отзыва.', TTL_S); return; }
  if (db.getVoting(pid)?.open) { await replyEphemeral(interaction, '❌ Нельзя отозвать законопроект во время голосования.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`delete_proposal_modal_${pid}`).setTitle('Отзыв законопроекта');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('delete_reason').setLabel('Причина отзыва').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
  await interaction.showModal(modal);
}

async function handleDeleteProposalModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const pid    = interaction.customId.split('delete_proposal_modal_')[1];
  const reason = interaction.fields.getTextInputValue('delete_reason');
  const p      = db.getProposal(pid);
  if (!p) { await replyEphemeral(interaction, '❌ Законопроект не найден.', TTL_S); return; }
  db.updateProposalStatus(pid, 'Отозван');
  try {
    const thread = await client.channels.fetch(p.threadId).catch(() => null);
    if (thread) {
      await thread.send({ embeds: [buildEmbed({ color: COLORS.DANGER, title: `🗑️ Законопроект отозван — ${p.number}`,
        fields: [{ name: '👤 Отозвал', value: `<@${interaction.user.id}>`, inline: true }, { name: '📋 Причина', value: reason, inline: false }]
      })] });
      await thread.setArchived(true).catch(() => {});
    }
    for (const m of db.getOpenMeetings().filter(m => m.status === 'in_session')) if (db.getAgenda(m.id).some(a => a.id === pid)) await refreshMeetingMessage(m.id);
    await replyEphemeral(interaction, '✅ Законопроект успешно отозван.', TTL_M);
  } catch (e) { await replyEphemeral(interaction, '❌ Ошибка при отзыве.', TTL_S); }
}

// ════════════════════ SENATOR REPLACEMENT ══════════════════════════
const OUTGOING_PAGE_SIZE = 24;

async function refreshReplacementCaches() {
  ensureDefaultPartyOrg();
  db.cleanupDuplicateSenators();
  replacementTagCache.clear();
  if (ROLES.SENATOR) await syncSenatorsFromDiscordRole(ROLES.SENATOR).catch(() => {});
  await fetchSenators(true).catch(() => {});
  await refreshPartyKeys();
}

async function resolvePartyOrgByKey(key) {
  let partyOrg = lookupPartyOrg(key);
  if (!partyOrg) { await refreshPartyKeys(); partyOrg = lookupPartyOrg(key); }
  if (partyOrg) return partyOrg;
  const partyOrgs = await getPartyOrgs().catch(() => []);
  for (const org of partyOrgs) if (`p${hashStr(org)}` === key) { registerPartyOrg(org); return org; }
  return null;
}

function parseReplacementCustomId(raw) {
  if (raw.length < PARTY_KEY_LEN) return { partyKey: '', oldSafe: '__none__' };
  const partyKey = raw.substring(0, PARTY_KEY_LEN);
  const rest     = raw.substring(PARTY_KEY_LEN + 1);
  return { partyKey, oldSafe: rest || '__none__' };
}

function buildReplacementModal() {
  const modal = new ModalBuilder().setCustomId('replacement_new_party_modal').setTitle('Новая организация');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_party').setLabel('Партия / организация').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Например: Republican Party').setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_tag').setLabel('Тег нового сенатора (без @)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('treak_').setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_name').setLabel('Имя и Фамилия').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Иван Иванов').setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('replacement_reason').setLabel('Основание / причина').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Добавление первого сенатора организации').setMaxLength(300))
  );
  return modal;
}

async function showReplacementPartyStep(interaction, mode = 'reply') {
  await refreshReplacementCaches();
  const partyOrgs = await getPartyOrgs();

  // Сортируем: "Спикер сената" всегда первой
  const sorted = [...partyOrgs].sort((a, b) => {
    const aS = a.toLowerCase().includes('спикер'); const bS = b.toLowerCase().includes('спикер');
    if (aS && !bS) return -1; if (!aS && bS) return 1; return a.localeCompare(b);
  });

  const options = [], usedKeys = new Set();
  sorted.slice(0, 24).forEach(po => {
    const key = registerPartyOrg(po);
    if (usedKeys.has(key)) return; usedKeys.add(key);
    const opt = new StringSelectMenuOptionBuilder().setLabel(truncate(po, 100)).setValue(key);
    if (po.toLowerCase().includes('спикер')) opt.setDescription('🏛️ Должность Спикера Сената');
    options.push(opt);
  });

  const components = [];
  if (options.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('replacement_partyorg_select').setPlaceholder('Выберите организацию').addOptions(options)));
  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('replacement_new_party_button').setLabel('➕ Создать организацию').setStyle(ButtonStyle.Primary)));

  const embed = buildEmbed({ color: COLORS.NAVY, title: '🔄 Замена сенатора — Шаг 1 из 4',
    description: options.length ? 'Выберите партию/организацию из списка или создайте новую.' : 'Список организаций пуст. Создайте первую.'
  });
  const payload = { embeds: [embed], components };
  if (interaction.isChatInputCommand() || mode === 'reply') {
    await replyEphemeral(interaction, payload, TTL_L);
    return;
  }
  await updateEphemeral(interaction, payload, TTL_L);
}

async function renderReplacementActionSelect(interaction, partyOrg, key) {
  const senators = await getSenatorsByPartyOrg(partyOrg);
  const hasSenators = senators.some(s => s.tag);

  const options = [
    new StringSelectMenuOptionBuilder().setLabel('🔄 Заменить сенатора').setValue('replace').setDescription('Выбывает сенатор и назначается новый'),
    new StringSelectMenuOptionBuilder().setLabel('➕ Назначить в вакансию').setValue('add').setDescription('Никто не выбывает'),
    new StringSelectMenuOptionBuilder().setLabel('🚫 Отозвать мандат').setValue('recall').setDescription('Вывести сенатора из состава')
  ];

  const embed = buildEmbed({
    color: COLORS.NAVY,
    title: '🔄 Замена сенатора — Шаг 2 из 4',
    description: hasSenators ? 'Выберите действие для организации.' : 'В организации пока нет сенаторов. Доступно назначение в вакансию.',
    fields: [{ name: '🏛️ Организация', value: partyOrg, inline: true }]
  });

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`replacement_action_select_${key}`).setPlaceholder('Выберите действие').addOptions(options)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('replacement_restart').setLabel('🔁 Начать заново').setStyle(ButtonStyle.Secondary)
    )
  ];

  await updateEphemeral(interaction, { embeds: [embed], components }, TTL_L);
}

async function renderReplacementOutgoingStep(interaction, partyOrg, key, page = 0, mode = 'replace') {
  const senators  = await getSenatorsByPartyOrg(partyOrg);
  if (!senators.length) {
    await updateEphemeral(interaction, {
      embeds: [buildEmbed({ color: COLORS.WARNING, title: 'ℹ️ Нет сенаторов', description: `В организации **${partyOrg}** пока нет активных сенаторов.` })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`replacement_action_back_${key}`).setLabel('⬅️ Назад').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('replacement_restart').setLabel('🔁 Начать заново').setStyle(ButtonStyle.Secondary)
      )]
    }, TTL_M);
    return;
  }
  const pageCount = Math.max(1, Math.ceil(senators.length / OUTGOING_PAGE_SIZE));
  const safePage  = Math.min(Math.max(0, page), pageCount - 1);
  const slice     = senators.slice(safePage * OUTGOING_PAGE_SIZE, safePage * OUTGOING_PAGE_SIZE + OUTGOING_PAGE_SIZE).filter(s => s.tag);

  const opts = [];
  const usedValues = new Set();
  for (const s of slice) {
    const value = tagToSafe(s.tag); if (!value || usedValues.has(value)) continue;
    usedValues.add(value);
    if (s.tag) replacementTagCache.set(`${key}:${value}`, s.tag);
    opts.push(new StringSelectMenuOptionBuilder().setLabel(truncate(s.name || s.tag, 100)).setValue(value));
  }

  const fields = [{ name: '🏛️ Организация', value: partyOrg, inline: true }];
  if (pageCount > 1) fields.push({ name: '📄 Страница', value: `${safePage + 1} / ${pageCount}`, inline: true });

  const title = mode === 'recall'
    ? '🚫 Отзыв мандата — Шаг 3 из 3'
    : '🔄 Замена сенатора — Шаг 3 из 4';
  const description = mode === 'recall'
    ? `Кого отозвать из **${partyOrg}**?`
    : `Кто **выбывает** из **${partyOrg}**?`;
  const embed = buildEmbed({ color: COLORS.NAVY, title, description, fields });

  const selectId = mode === 'recall'
    ? `replacement_recall_select_${key}`
    : `replacement_outgoing_select_${key}`;
  const components = [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(selectId).setPlaceholder('Выберите сенатора').setMinValues(1).setMaxValues(1).addOptions(opts)
  )];
  if (pageCount > 1) components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`replacement_outgoing_page_${mode}_${key}_${safePage - 1}`).setLabel('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
    new ButtonBuilder().setCustomId(`replacement_outgoing_page_${mode}_${key}_${safePage + 1}`).setLabel('➡️').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pageCount - 1)
  ));
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`replacement_action_back_${key}`).setLabel('⬅️ Назад').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('replacement_restart').setLabel('🔁 Начать заново').setStyle(ButtonStyle.Secondary)
  ));
  await updateEphemeral(interaction, { embeds: [embed], components }, TTL_L);
}

async function renderReplacementNewStep(interaction, partyOrg, key, oldSafe, mode = 'replace') {
  const allSenators = await fetchSenators();
  const oldTag = safeToTag(oldSafe, allSenators);

  const opts = []; const usedValues = new Set([oldSafe]);
  for (const s of allSenators.filter(s => s.tag && tagToSafe(s.tag) !== oldSafe).slice(0, 23)) {
    const value = tagToSafe(s.tag); if (!value || usedValues.has(value)) continue;
    usedValues.add(value);
    const opt = new StringSelectMenuOptionBuilder().setLabel(truncate(s.name || s.tag, 100)).setValue(value);
    if (s.partyOrg) opt.setDescription(truncate(`Текущая орг.: ${s.partyOrg}`, 100));
    opts.push(opt);
  }

  const suffix = `${key}_${oldSafe}`;
  const components = [];
  if (opts.length > 0 && `replacement_new_select_${suffix}`.length <= 100) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`replacement_new_select_${suffix}`).setPlaceholder('Выбрать нового сенатора').setMinValues(1).setMaxValues(1).addOptions(opts)
    ));
  }
  const actionRow = new ActionRowBuilder();
  if (`replacement_manual_${suffix}`.length <= 100) actionRow.addComponents(new ButtonBuilder().setCustomId(`replacement_manual_${suffix}`).setLabel('✍️ Ввести вручную').setStyle(ButtonStyle.Secondary));
  if (actionRow.components.length > 0) components.push(actionRow);
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(mode === 'replace' ? `replacement_outgoing_back_${key}` : `replacement_action_back_${key}`).setLabel('⬅️ Назад').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('replacement_restart').setLabel('🔁 Начать заново').setStyle(ButtonStyle.Secondary)
  ));

  const seatField = oldSafe === '__none__'
    ? { name: '🟢 Место', value: 'Вакантно', inline: true }
    : { name: '👤 Выбывает', value: oldTag ? toMention(oldTag) : '@?', inline: true };

  const embed = buildEmbed({ color: COLORS.NAVY, title: mode === 'replace' ? '🔄 Замена сенатора — Шаг 4 из 4' : '➕ Назначение в вакансию — Шаг 3 из 3',
    description: opts.length ? 'Выберите нового сенатора или введите тег вручную.' : 'Список кандидатов пуст. Используйте ручной ввод.',
    fields: [{ name: '🏛️ Организация', value: partyOrg, inline: true }, seatField]
  });
  await updateEphemeral(interaction, { embeds: [embed], components }, TTL_L);
}

async function handleReplaceSenatorCommand(interaction) {
  if (SENATOR_REPLACEMENT_CHANNEL_ID && interaction.channelId !== SENATOR_REPLACEMENT_CHANNEL_ID) {
    await replyEphemeral(interaction, `❌ Данная команда доступна только в канале <#${SENATOR_REPLACEMENT_CHANNEL_ID}>.`, TTL_S); return;
  }
  if (!isSenator(interaction.member) && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только сенаторы.', TTL_S); return; }
  await showReplacementPartyStep(interaction, 'reply');
}

async function handleReplacementPartyOrgSelect(interaction) {
  const key = interaction.values[0];
  if (key === '__new_party__') { await interaction.showModal(buildReplacementModal()); return; }
  let partyOrg = lookupPartyOrg(key);
  if (!partyOrg) { await refreshPartyKeys(); partyOrg = lookupPartyOrg(key); }
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }
  await renderReplacementActionSelect(interaction, partyOrg, key);
}

async function handleReplacementActionSelect(interaction) {
  const key = interaction.customId.replace('replacement_action_select_', '');
  let partyOrg = await resolvePartyOrgByKey(key);
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }

  const action = interaction.values[0];
  if (action === 'add') {
    await renderReplacementNewStep(interaction, partyOrg, key, '__none__', 'add');
    return;
  }

  if (action === 'recall') {
    await renderReplacementOutgoingStep(interaction, partyOrg, key, 0, 'recall');
    return;
  }

  await renderReplacementOutgoingStep(interaction, partyOrg, key, 0, 'replace');
}

async function handleReplacementOutgoingSelect(interaction) {
  const key = interaction.customId.replace('replacement_outgoing_select_', '');
  let partyOrg = lookupPartyOrg(key);
  if (!partyOrg) { await refreshPartyKeys(); partyOrg = lookupPartyOrg(key); }
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }
  await renderReplacementNewStep(interaction, partyOrg, key, interaction.values[0], 'replace');
}

async function handleReplacementRecallSelect(interaction) {
  const key = interaction.customId.replace('replacement_recall_select_', '');
  let partyOrg = await resolvePartyOrgByKey(key);
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }
  await renderReplacementRecallConfirm(interaction, partyOrg, key, interaction.values[0]);
}

async function handleReplacementActionBackButton(interaction) {
  const key = interaction.customId.replace('replacement_action_back_', '');
  let partyOrg = await resolvePartyOrgByKey(key);
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }
  await renderReplacementActionSelect(interaction, partyOrg, key);
}

async function handleReplacementOutgoingBackButton(interaction) {
  const key = interaction.customId.replace('replacement_outgoing_back_', '');
  let partyOrg = await resolvePartyOrgByKey(key);
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }
  await renderReplacementOutgoingStep(interaction, partyOrg, key, 0, 'replace');
}

async function handleReplacementRecallBackButton(interaction) {
  const key = interaction.customId.replace('replacement_recall_back_', '');
  let partyOrg = await resolvePartyOrgByKey(key);
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }
  await renderReplacementOutgoingStep(interaction, partyOrg, key, 0, 'recall');
}

async function renderReplacementRecallConfirm(interaction, partyOrg, key, oldSafe) {
  const allSenators = await fetchSenators();
  const oldTag = safeToTag(oldSafe, allSenators);
  const seatField = oldTag ? toMention(oldTag) : '@?';
  const embed = buildEmbed({
    color: COLORS.WARNING,
    title: '🚫 Отзыв мандата — Шаг 3 из 3',
    description: 'Подтвердите отзыв мандата. Сенатор будет выведен из состава и роль снята.',
    fields: [
      { name: '🏛️ Организация', value: partyOrg, inline: true },
      { name: '👤 Сенатор', value: seatField, inline: true }
    ]
  });
  const suffix = `${key}_${oldSafe}`;
  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`replacement_recall_confirm_${suffix}`).setLabel('✅ Подтвердить отзыв').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`replacement_recall_back_${key}`).setLabel('⬅️ Назад').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('replacement_restart').setLabel('🔁 Начать заново').setStyle(ButtonStyle.Secondary)
    )
  ];
  await updateEphemeral(interaction, { embeds: [embed], components }, TTL_L);
}

async function handleReplacementRestartButton(interaction) { await showReplacementPartyStep(interaction, 'update'); }

async function handleReplacementNewSelect(interaction) {
  const suffix = interaction.customId.replace('replacement_new_select_', '');
  const { partyKey, oldSafe } = parseReplacementCustomId(suffix);
  let partyOrg = await resolvePartyOrgByKey(partyKey);
  if (!partyOrg) { await replyEphemeral(interaction, '❌ Ошибка данных. Запустите `/replace_senator` заново.', TTL_S); return; }
  const allSenators = await fetchSenators();
  const oldTag = safeToTag(oldSafe, allSenators), newSafe = interaction.values[0];
  const newTag = safeToTag(newSafe, allSenators);
  if (!newTag) { await replyEphemeral(interaction, '❌ Новый сенатор не найден в списке.', TTL_S); return; }
  await submitReplacementRequest(interaction, partyOrg, oldTag, newTag, null);
}

async function handleReplacementManualButton(interaction) {
  const suffix = interaction.customId.replace('replacement_manual_', '');
  const { partyKey } = parseReplacementCustomId(suffix);
  const partyOrg = await resolvePartyOrgByKey(partyKey);
  if (!partyOrg) { await replyEphemeral(interaction, '❌ Ошибка данных. Запустите `/replace_senator` заново.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`replacement_manual_modal_${suffix}`).setTitle('Новый сенатор');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_tag').setLabel('Тег нового сенатора (без @)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('treak_').setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_name').setLabel('Имя и Фамилия').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Иван Иванов').setMaxLength(80)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('replacement_reason').setLabel('Причина замены (необязательно)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Основание для замены').setMaxLength(300))
  );
  await interaction.showModal(modal);
}

async function handleReplacementManualModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const suffix = interaction.customId.replace('replacement_manual_modal_', '');
  const { partyKey, oldSafe } = parseReplacementCustomId(suffix);
  const partyOrg = await resolvePartyOrgByKey(partyKey);
  if (!partyOrg) { await replyEphemeral(interaction, '❌ Ошибка данных.', TTL_S); return; }
  const rawTag  = interaction.fields.getTextInputValue('new_tag').trim().replace(/^@/, '');
  const newName = interaction.fields.getTextInputValue('new_name').trim() || null;
  const reason  = interaction.fields.getTextInputValue('replacement_reason').trim() || null;
  const allSenators = await fetchSenators();
  const oldTag = safeToTag(oldSafe, allSenators);
  await submitReplacementRequest(interaction, partyOrg, oldTag, rawTag, newName, reason);
}

async function handleReplacementNewPartyButton(interaction) { await interaction.showModal(buildReplacementModal()); }
async function handleReplacementNewPartyModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const partyOrg = interaction.fields.getTextInputValue('new_party').trim();
  const rawTag   = interaction.fields.getTextInputValue('new_tag').trim().replace(/^@/, '');
  const newName  = interaction.fields.getTextInputValue('new_name').trim() || null;
  const reason   = interaction.fields.getTextInputValue('replacement_reason').trim() || null;
  if (!partyOrg || !rawTag) { await replyEphemeral(interaction, '❌ Укажите организацию и тег.', TTL_S); return; }
  await submitReplacementRequest(interaction, partyOrg, null, rawTag, newName, reason);
}

async function handleReplacementRecallConfirm(interaction) {
  const suffix = interaction.customId.replace('replacement_recall_confirm_', '');
  const { partyKey, oldSafe } = parseReplacementCustomId(suffix);
  let partyOrg = await resolvePartyOrgByKey(partyKey);
  const allSenators = db.getSenators(true);
  let oldTag = resolveTagFromSafe(partyKey, oldSafe, allSenators) || safeToTag(oldSafe, allSenators);
  if (!oldTag) oldTag = resolveTagFromSafe(partyKey, oldSafe, await fetchSenators(true)) || safeToTag(oldSafe, await fetchSenators(true));
  if (!oldTag) { await replyEphemeral(interaction, '❌ Сенатор не найден.', TTL_S); return; }
  if (!partyOrg) {
    const fallback = db.getSenatorByTag(oldTag) || db.getSenatorByDiscordId(oldTag);
    partyOrg = fallback?.partyOrg || null;
  }
  if (!partyOrg) { await replyEphemeral(interaction, '❌ Ошибка данных.', TTL_S); return; }

  try {
    await deactivateSenator(oldTag, 'Отозван мандат');
    const cache  = getTagToIdCache();
    const oldId  = cache.get(oldTag.toLowerCase()) || null;
    const guild  = client.guilds.cache.get(GUILD_ID);
    if (ROLES.SENATOR && oldId) {
      try { const om = await guild.members.fetch(oldId); await om.roles.remove(ROLES.SENATOR); } catch {}
    }
    const mention = oldId ? `<@${oldId}>` : `@${oldTag}`;
    await updateEphemeral(interaction, { content: `✅ Мандат отозван. Сенатор ${mention} выведен из состава.`, embeds: [], components: [] }, TTL_M);
    await updateSenateMainMessage();
  } catch (e) {
    await replyEphemeral(interaction, '❌ Ошибка при отзыве: ' + e.message, TTL_S);
  }
}

async function submitReplacementRequest(interaction, partyOrg, oldTag, newTag, newName, reason = null) {
  const cache      = getTagToIdCache();
  const oldId      = oldTag ? (cache.get(oldTag.toLowerCase()) || null) : null;
  const newId      = await resolveUserByTag(newTag);
  const oldMention = oldId ? `<@${oldId}>` : oldTag ? `@${oldTag}` : '*вакантно*';
  const newMention = newId ? `<@${newId}>` : `@${newTag}`;
  const repId = db.createReplacement({ channelId: interaction.channelId, partyOrg, oldDiscordId: oldTag, newDiscordId: newTag, newName, requesterId: interaction.user.id, reason });
  const fields = [
    { name: '🏛️ Партия / Организация', value: partyOrg, inline: true },
    { name: '👤 Выбывающий', value: oldMention, inline: true },
    { name: '🆕 Новый', value: newMention, inline: true },
    { name: '📋 Инициатор', value: `<@${interaction.user.id}>`, inline: true },
    { name: '🕐 Время подачи', value: discordTs(Date.now(), 'f'), inline: true }
  ];
  if (reason) fields.push({ name: '📝 Основание', value: reason, inline: false });
  const embed = buildEmbed({ color: COLORS.WARNING, title: '🔄 Заявка на замену сенатора', description: '> Ожидает решения Спикера.', fields });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`replacement_approve_${repId}`).setLabel('✅ Одобрить').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`replacement_reject_${repId}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger)
  );
  try {
    const msg = await sendReplacementMessage({ content: ROLES.CHAIRMAN ? `<@&${ROLES.CHAIRMAN}>` : null, embeds: [embed], components: [row] });
    if (msg) db.updateReplacementMessage(repId, msg.id);
  } catch (e) { console.error('❌ submitReplacementRequest:', e.message); }
  await replyEphemeral(interaction, '✅ Заявка на замену направлена Спикеру. Ожидайте решения.', TTL_M);
}

async function handleReplacementApprove(interaction) {
  const repId = parseInt(interaction.customId.split('replacement_approve_')[1]);
  const rep   = db.getReplacement(repId);
  if (!rep) { await replyEphemeral(interaction, '❌ Заявка не найдена.', TTL_S); return; }
  if (!isChairman(interaction.member, 'senate') && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  if (rep.status !== 'pending') { await replyEphemeral(interaction, '❌ Заявка уже была обработана.', TTL_S); return; }
  await interaction.deferReply({ flags: 64 });
  try {
    const oldTag = rep.oldDiscordId, newTag = rep.newDiscordId;
    await replaceSenator(oldTag, newTag, rep.newName, rep.partyOrg, rep.reason || 'Замена');
    db.approveReplacement(repId, interaction.user.id);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (ROLES.SENATOR) {
      const newId = await resolveUserByTag(newTag);
      if (newId) { try { const nm = await guild.members.fetch(newId); await nm.roles.add(ROLES.SENATOR); } catch {} }
      const cache = getTagToIdCache();
      const oldId = oldTag ? (cache.get(oldTag.toLowerCase()) || null) : null;
      if (oldId) { try { const om = await guild.members.fetch(oldId); await om.roles.remove(ROLES.SENATOR); } catch {} }
    }
    const cache2 = getTagToIdCache();
    const newId2 = await resolveUserByTag(newTag);
    const oldId2 = rep.oldDiscordId ? (cache2.get(rep.oldDiscordId.toLowerCase()) || null) : null;
    const oldMention = oldId2 ? `<@${oldId2}>` : rep.oldDiscordId ? `@${rep.oldDiscordId}` : '*вакантно*';
    const newMention = newId2 ? `<@${newId2}>` : `@${newTag}`;
    const fields = [
      { name: '🏛️ Организация', value: rep.partyOrg, inline: true },
      { name: '👤 Выбывший', value: oldMention, inline: true },
      { name: '🆕 Новый', value: newMention, inline: true },
      { name: '✅ Одобрил', value: `<@${interaction.user.id}>`, inline: true }
    ];
    if (rep.reason) fields.push({ name: '📝 Основание', value: rep.reason, inline: false });
    await interaction.message.edit({ embeds: [buildEmbed({ color: COLORS.SUCCESS, title: '✅ Замена одобрена', fields })], components: [] }).catch(() => {});
    await updateSenateMainMessage();
    await replyEphemeral(interaction, '✅ Замена одобрена. Роли обновлены.', TTL_M);
  } catch (e) { await replyEphemeral(interaction, '❌ Ошибка при одобрении: ' + e.message, TTL_S); }
}

async function handleReplacementReject(interaction) {
  const repId = parseInt(interaction.customId.split('replacement_reject_')[1]);
  const rep   = db.getReplacement(repId);
  if (!rep) { await replyEphemeral(interaction, '❌ Заявка не найдена.', TTL_S); return; }
  if (!isChairman(interaction.member, 'senate') && !isAdmin(interaction.member)) { await replyEphemeral(interaction, '❌ Только Спикер.', TTL_S); return; }
  if (rep.status !== 'pending') { await replyEphemeral(interaction, '❌ Заявка уже была обработана.', TTL_S); return; }
  const modal = new ModalBuilder().setCustomId(`replacement_reject_modal_${repId}`).setTitle('Отклонение заявки');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reject_reason').setLabel('Причина отклонения').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)));
  await interaction.showModal(modal);
}

async function handleReplacementRejectModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const repId  = parseInt(interaction.customId.split('replacement_reject_modal_')[1]);
  const reason = interaction.fields.getTextInputValue('reject_reason');
  const rep    = db.getReplacement(repId);
  if (!rep) { await replyEphemeral(interaction, '❌ Заявка не найдена.', TTL_S); return; }
  db.rejectReplacement(repId, reason);
  if (rep.messageId) {
    const thread = await getSenateMainThread();
    const msg = thread ? await thread.messages.fetch(rep.messageId).catch(() => null) : null;
    if (msg) {
      const fields = [
        { name: '🏛️ Организация', value: rep.partyOrg, inline: true },
        { name: '❌ Отклонил', value: `<@${interaction.user.id}>`, inline: true }
      ];
      if (rep.reason) fields.push({ name: '📝 Основание', value: rep.reason, inline: false });
      fields.push({ name: '📋 Причина отклонения', value: reason, inline: false });
      await msg.edit({ embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Заявка отклонена', fields })], components: [] }).catch(() => {});
    }
  }
  await replyEphemeral(interaction, '✅ Заявка отклонена.', TTL_M);
}

async function handleReplacementDeactivateButton(interaction) {
  const suffix = interaction.customId.replace('replacement_deactivate_', '');
  const { partyKey, oldSafe } = parseReplacementCustomId(suffix);
  const partyOrg = await resolvePartyOrgByKey(partyKey);
  if (!partyOrg) { await replyEphemeral(interaction, '❌ Ошибка данных. Запустите `/replace_senator` заново.', TTL_S); return; }
  await renderReplacementRecallConfirm(interaction, partyOrg, partyKey, oldSafe);
}

async function handleDeactivateModal(interaction) {
  await interaction.deferReply({ flags: 64 });
  const suffix = interaction.customId.replace('deactivate_modal_', '');
  const { partyKey, oldSafe } = parseReplacementCustomId(suffix);
  const reason = interaction.fields.getTextInputValue('deactivate_reason');
  let partyOrg = await resolvePartyOrgByKey(partyKey);
  const allSenators = db.getSenators(true);
  let oldTag = safeToTag(oldSafe, allSenators);
  if (!oldTag) oldTag = safeToTag(oldSafe, await fetchSenators(true));
  if (!oldTag) {
    const active = await fetchSenators(true);
    const match = active.find(s => s.tag && tagToSafe(s.tag) === oldSafe);
    if (match) oldTag = match.tag;
  }
  if (!oldTag) { await replyEphemeral(interaction, '❌ Сенатор не найден.', TTL_S); return; }
  if (!partyOrg) {
    const fallback = db.getSenatorByTag(oldTag) || db.getSenatorByDiscordId(oldTag);
    partyOrg = fallback?.partyOrg || null;
  }
  if (!partyOrg) { await replyEphemeral(interaction, '❌ Ошибка данных.', TTL_S); return; }
  try {
    await deactivateSenator(oldTag, reason);
    const cache  = getTagToIdCache();
    const oldId  = cache.get(oldTag.toLowerCase()) || null;
    const guild  = client.guilds.cache.get(GUILD_ID);
    if (ROLES.SENATOR && oldId) {
      try { const om = await guild.members.fetch(oldId); await om.roles.remove(ROLES.SENATOR); } catch {}
    }
    const mention = oldId ? `<@${oldId}>` : `@${oldTag}`;
    await replyEphemeral(interaction, `✅ Деактивация выполнена. Сенатор ${mention} выведен из состава.`, TTL_M);
    await updateSenateMainMessage();
  } catch (e) { await replyEphemeral(interaction, '❌ Ошибка при деактивации: ' + e.message, TTL_S); }
}

async function handleReplacementOutgoingPageButton(interaction) {
  const raw   = interaction.customId.replace('replacement_outgoing_page_', '');
  const parts = raw.split('_');
  const page  = parseInt(parts[parts.length - 1]);
  const mode  = parts[0];
  const key   = parts.slice(1, -1).join('_');
  const partyOrg = await resolvePartyOrgByKey(key);
  if (!partyOrg) { await updateEphemeral(interaction, { embeds: [buildEmbed({ color: COLORS.DANGER, title: '❌ Ошибка', description: 'Данные устарели. Запустите `/replace_senator` заново.' })], components: [] }, TTL_S); return; }
  await renderReplacementOutgoingStep(interaction, partyOrg, key, page, mode);
}

// ════════════════════════ HELP INFO BUTTON ═════════════════════════
async function handleHelpInfoButton(interaction) {
  await replyEphemeral(interaction, {
    embeds: [buildEmbed({ color: COLORS.PRIMARY, title: '🧭 Как работает Законодательный портал',
      description: [
        '## 📜 Стадии рассмотрения аконопроекта',
        '',
        '**1.** 📥 **Регистрация** — подаётся через кнопку «Подать законопроект»',
        '**2.** 📋 **Повестка** — Спикер включает в повестку заседания',
        '**3.** 🗳️ **Голосование** — сенаторы голосуют в ветке законопроекта',
        '**4.** 📩 **Губернатор** — при принятии направляется на утверждение',
        '**5.** 🏛️ **Фед. правительство** — финальное подписание',
        '**6.** 🖊️ **Вступает в силу** — закон опубликован',
        '',
        '## 🗳️ Формулы голосования',
        '`0` — Простое большинство (за > против)',
        '`1` — Не менее ⅔ проголосовавших',
        '`2` — Не менее ¾ проголосовавших',
        '`3` — Большинство от состава Сената',
        '',
        '## ℹ️ Важно',
        '— Право вето Губернатора доступно при принятии законопроекта',
        '— При равенстве голосов — решающий голос Спикера'
      ].join('\n')
    })]
  }, TTL_L);
}

// ════════════════════════ INTERACTION ROUTER ═══════════════════════
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) { await handleSlashCommand(interaction); return; }

    if (interaction.isModalSubmit()) {
      const cid = interaction.customId;
      if (cid.startsWith('send_modal'))                   { await handleProposalModal(interaction); return; }
      if (cid === 'civic_initiative_modal')               { await handleCivicInitiativeModal(interaction); return; }
      if (cid.startsWith('start_vote_modal_'))            { await handleStartVoteModal(interaction); return; }
      if (cid.startsWith('force_vote_modal_'))            { await handleForceVoteModal(interaction); return; }
      if (cid.startsWith('annul_vote_modal_'))            { await handleAnnulVoteModal(interaction); return; }
      if (cid.startsWith('opening_vote_modal_'))          { await handleOpeningVoteModal(interaction); return; }
      if (cid.startsWith('closing_vote_modal_'))          { await handleClosingVoteModal(interaction); return; }
      if (cid.startsWith('cancel_meeting_modal_'))        { await handleCancelMeetingModal(interaction); return; }
      if (cid.startsWith('meeting_details_'))             { await handleMeetingDetailsModal(interaction); return; }
      if (cid.startsWith('replacement_manual_modal_'))    { await handleReplacementManualModal(interaction); return; }
      if (cid === 'replacement_new_party_modal')          { await handleReplacementNewPartyModal(interaction); return; }
      if (cid.startsWith('replacement_reject_modal_'))    { await handleReplacementRejectModal(interaction); return; }
      if (cid.startsWith('deactivate_modal_'))            { await handleDeactivateModal(interaction); return; }
      if (cid.startsWith('governor_veto_reason_'))        { await handleGovernorVetoModal(interaction); return; }
      if (cid.startsWith('fed_return_modal_'))            { await handleFedReturnModal(interaction); return; }
      if (cid.startsWith('delete_proposal_modal_'))       { await handleDeleteProposalModal(interaction); return; }
      if (cid.startsWith('procedural_modal_'))            { await handleProceduralModalSubmit(interaction); return; }
      if (cid.startsWith('review_speaker_modal_'))        { await handleReviewSpeakerModal(interaction); return; }
      if (cid.startsWith('review_vote_modal_'))           { await handleReviewVoteModal(interaction); return; }
      if (cid.startsWith('exclude_by_speaker_modal_'))     { await handleExcludeBySpeakerModal(interaction); return; }
      if (cid.startsWith('exclude_vote_modal_'))           { await handleExcludeVoteModal(interaction); return; }
      if (cid.startsWith('edit_quant_items_modal_'))       { await handleEditQuantitativeItemsModal(interaction); return; }
      if (cid.startsWith('quantitative_runoff_modal_'))   { await handleQuantitativeRunoffModal(interaction); return; }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const cid = interaction.customId;
      if (cid === 'coauthor_select')                             { const coauthors = interaction.values; await showVoteTypeSelect(interaction, coauthors); return; }
      if (cid.startsWith('vote_type_select_'))                   { const coStr = cid.replace('vote_type_select_', ''); const voteType = interaction.values[0]; if (voteType === 'regular') { await showBillFormSelect(interaction, coStr); } else { await interaction.showModal(buildProposalModal(coStr, voteType, 'none')); } return; }
      if (cid.startsWith('bill_form_select_'))                   { const coStr = cid.replace('bill_form_select_', ''); const billForm = interaction.values[0]; await interaction.showModal(buildProposalModal(coStr, 'regular', billForm)); return; }
      if (cid.startsWith('meeting_agenda_select_'))              { const chamber = cid.replace('meeting_agenda_select_', ''); await createMeetingFromSelection(interaction, chamber, interaction.values); return; }
      if (cid === 'replacement_partyorg_select')                 { await handleReplacementPartyOrgSelect(interaction); return; }
      if (cid.startsWith('replacement_action_select_'))          { await handleReplacementActionSelect(interaction); return; }
      if (cid.startsWith('replacement_outgoing_select_'))        { await handleReplacementOutgoingSelect(interaction); return; }
      if (cid.startsWith('replacement_recall_select_'))          { await handleReplacementRecallSelect(interaction); return; }
      if (cid.startsWith('replacement_new_select_'))             { await handleReplacementNewSelect(interaction); return; }
      if (cid.startsWith('edit_agenda_add_'))                    { await handleEditAgendaSelect(interaction); return; }
      if (cid.startsWith('meeting_agenda_exclude_select_'))      { await handleEditAgendaExcludeSelect(interaction); return; }
      if (cid.startsWith('review_agenda_select_'))               { await handleReviewAgendaSelect(interaction); return; }
      if (cid.startsWith('vote_item_select_'))                   { await handleQuantitativeVoteSelect(interaction); return; }
      return;
    }

    if (interaction.isButton()) {
      const cid = interaction.customId;

      // ── Главное меню Сената ─────────────────────────────────────
      if (cid === 'senate_submit_bill')       { await showSendForm(interaction); return; }
      if (cid === 'senate_civic_initiative')  { await handleCivicInitiativeButton(interaction); return; }
      if (cid === 'senate_replace_senator')   { await handleReplaceSenatorCommand(interaction); return; }
      if (cid === 'senate_help_info')         { await handleHelpInfoButton(interaction); return; }

      // ── Подача / выбор ──────────────────────────────────────────
      if (cid === 'coauthor_skip') { await showVoteTypeSelect(interaction, []); return; }

      // ── Законопроекты ───────────────────────────────────────────
      if (cid.startsWith('start_voting_'))   { await handleStartVotingButton(interaction); return; }
      if (cid.startsWith('delete_proposal_') && !cid.includes('modal')) { await handleDeleteProposalButton(interaction); return; }
      if (cid.startsWith('annul_voting_'))   { await handleAnnulVotingButton(interaction); return; }
      if (cid.startsWith('end_vote_'))       { await handleEndVoteButton(interaction); return; }

      // ── Голосование ──────────────────────────────────────────────
      if (cid.startsWith('vote_for_'))     { await handleRegularVoteButtons(interaction); return; }
      if (cid.startsWith('vote_against_')) { await handleRegularVoteButtons(interaction); return; }
      if (cid.startsWith('vote_item_page_')) { await handleQuantitativeVotePageButton(interaction); return; }
      if (cid.startsWith('vote_abstain_')) { await handleVoteAbstain(interaction); return; }
      if (cid.startsWith('vote_item_'))    { await handleQuantitativeVoteButtons(interaction); return; }

      // ── Спикер / ничья ───────────────────────────────────────────
      if (cid.startsWith('chairman_vote_')) { await handleChairmanVoteButton(interaction); return; }

      // ── Рейтинговое / второй тур ─────────────────────────────────
      if (cid.startsWith('start_quantitative_runoff_')) { await handleStartQuantitativeRunoffButton(interaction); return; }

      // ── Губернатор / Фед. правительство ─────────────────────────
      if (cid.startsWith('governor_approve_')) { await handleGovernorApprove(interaction); return; }
      if (cid.startsWith('governor_veto_') && !cid.includes('modal')) { await handleGovernorVetoButton(interaction); return; }
      if (cid.startsWith('fed_gov_approve_') || cid.startsWith('fed_gov_return_')) { await handleFedGovButtons(interaction); return; }

      // ── Заседания ────────────────────────────────────────────────
      if (cid.startsWith('start_open_vote_'))   { await handleStartOpeningVoteButton(interaction); return; }
      if (cid.startsWith('start_close_vote_'))  { await handleStartClosingVoteButton(interaction); return; }
      if (cid.startsWith('cancel_meeting_') && !cid.includes('modal')) { await handleCancelMeetingButton(interaction); return; }
      if (cid.startsWith('clear_roles_'))       { await handleClearRolesButton(interaction); return; }
      if (cid.startsWith('edit_agenda_') && !cid.includes('add') && !cid.includes('exclude')) { await handleMeetingEditAgendaButton(interaction); return; }
      if (cid.startsWith('edit_agenda_exclude_') && !cid.includes('select')) { await handleEditAgendaExcludeButton(interaction); return; }
      if (cid.startsWith('review_agenda_') && !cid.includes('select')) { await handleReviewAgendaButton(interaction); return; }
      if (cid.startsWith('procedural_question_')) { await handleProceduralQuestionButton(interaction); return; }

      // ── Голосование за открытие/закрытие заседания ───────────────
      if (cid.startsWith('meeting_open_vote_for_') || cid.startsWith('meeting_open_vote_against_') || cid.startsWith('meeting_open_vote_abstain_')) { await handleMeetingOpenVote(interaction); return; }
      if (cid.startsWith('close_meeting_vote_'))    { await closeMeetingOpenVoteManually(interaction); return; }

      // ── Голосование за исключение из повестки ───────────────────
      if (cid.startsWith('agenda_excl_vote_for_') || cid.startsWith('agenda_excl_vote_against_') || cid.startsWith('agenda_excl_vote_abstain_')) { await handleAgendaExcludeVoteButton(interaction); return; }
      if (cid.startsWith('agenda_excl_vote_end_')) { await handleAgendaExcludeVoteEndButton(interaction); return; }

      // ── Процедурные вопросы ──────────────────────────────────────
      if (cid.startsWith('proc_vote_for_') || cid.startsWith('proc_vote_against_') || cid.startsWith('proc_vote_abstain_')) { await handleProceduralVoteButton(interaction); return; }
      if (cid.startsWith('proc_end_')) { const id = cid.replace('proc_end_', ''); await finalizeProceduralVote(id); await replyEphemeral(interaction, '✅ Процедурный вопрос завершён.', TTL_M); return; }
      if (cid.startsWith('view_proc_list_')) { await handleViewProceduralListButton(interaction); return; }

      // ── Рассмотрение повестки ────────────────────────────────────
      if (cid.startsWith('review_action_')) { await handleReviewActionButton(interaction); return; }

      // ── Исключение из повестки ───────────────────────────────────
      if (cid.startsWith('exclude_by_speaker_') || cid.startsWith('exclude_confirm_none_') || cid.startsWith('exclude_confirm_vote_')) { await handleExcludeConfirmButtons(interaction); return; }

      // ── Замена сенаторов ─────────────────────────────────────────
      if (cid === 'replacement_new_party_button')         { await handleReplacementNewPartyButton(interaction); return; }
      if (cid === 'replacement_restart')                  { await handleReplacementRestartButton(interaction); return; }
      if (cid.startsWith('replacement_action_back_'))     { await handleReplacementActionBackButton(interaction); return; }
      if (cid.startsWith('replacement_outgoing_back_'))   { await handleReplacementOutgoingBackButton(interaction); return; }
      if (cid.startsWith('replacement_recall_back_'))     { await handleReplacementRecallBackButton(interaction); return; }
      if (cid.startsWith('replacement_manual_') && !cid.includes('modal')) { await handleReplacementManualButton(interaction); return; }
      if (cid.startsWith('replacement_approve_'))         { await handleReplacementApprove(interaction); return; }
      if (cid.startsWith('replacement_reject_') && !cid.includes('modal')) { await handleReplacementReject(interaction); return; }
      if (cid.startsWith('replacement_deactivate_') && !cid.includes('modal')) { await handleReplacementDeactivateButton(interaction); return; }
      if (cid.startsWith('replacement_recall_confirm_'))  { await handleReplacementRecallConfirm(interaction); return; }
      if (cid.startsWith('replacement_outgoing_page_'))   { await handleReplacementOutgoingPageButton(interaction); return; }

      if (cid.startsWith('view_vote_list_')) { await handleViewVoteListButton(interaction); return; }
    }
  } catch (e) {
    console.error('❌ InteractionCreate error:', e);
    try {

      // ── Рейтинговые пункты ───────────────────────────────────────
      if (cid.startsWith('edit_quant_items_'))             { await handleEditQuantitativeItemsButton(interaction); return; }
      await replyEphemeral(interaction, '❌ Произошла непредвиденная ошибка. Попробуйте повторить действие.', TTL_M);
    } catch {}
  }
});

// ════════════════════════ READY ════════════════════════════════════
client.once(Events.ClientReady, async () => {
  console.log(`✅ Бот запущен: ${client.user.tag}`);
  setDiscordClient(client);
  ensureBotDbSheet().catch(e => console.error('❌ ensureBotDbSheet:', e.message));
  try {
    ensureDefaultPartyOrg();
    db.cleanupDuplicateSenators();
  } catch (e) {
    console.error('❌ ensureDefaultPartyOrg:', e.message);
  }
  await refreshPartyKeys().catch(() => {});
  await restoreAllTimers();
  loadUserMsgQueue();
  await cleanupUserMessages(true).catch(() => {});
  setInterval(() => cleanupUserMessages(false).catch(() => {}), 60000);
  await updateSenateMainMessage().catch(() => {});
  setInterval(() => updateSenateMainMessage().catch(() => {}), 300000);
  setInterval(() => refreshPartyKeys().catch(() => {}), 600000);
});

client.login(TOKEN);

// ══════════════════════════════════════════════════════════════════
//  СОЗДАНО И РАЗРАБОТАНО by treak_ (discord)
//  Отдельная благодарность сообществу SA-GOP за вдохновение и поддержку в развитии этого бота.
//  LICENSE: MIT
// ══════════════════════════════════════════════════════════════════
