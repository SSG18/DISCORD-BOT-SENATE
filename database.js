import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = process.env.DB_PATH || path.join(__dirname, 'senate.db');

class SenateDatabase {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.createTables();
    console.log('✅ SQLite3 database initialized:', DB_PATH);
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS senate_counter (
        id    INTEGER PRIMARY KEY DEFAULT 1,
        value INTEGER NOT NULL    DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id                TEXT    PRIMARY KEY,
        number            TEXT    NOT NULL,
        name              TEXT    NOT NULL,
        partyOrg          TEXT    NOT NULL DEFAULT '',
        link              TEXT    NOT NULL,
        billForm          TEXT    NOT NULL DEFAULT '',
        status            TEXT    NOT NULL DEFAULT 'На рассмотрении',
        createdAt         INTEGER NOT NULL,
        authorId          TEXT    NOT NULL,
        threadId          TEXT,
        channelId         TEXT,
        historyMessageId  TEXT,
        initialMessageId  TEXT,
        isQuantitative    INTEGER DEFAULT 0,
        events            TEXT    DEFAULT '[]',
        chamber           TEXT    NOT NULL DEFAULT 'senate',
        coauthors         TEXT    DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS quantitative_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        proposalId  TEXT    NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        itemIndex   INTEGER NOT NULL,
        text        TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS votings (
        proposalId      TEXT    PRIMARY KEY REFERENCES proposals(id) ON DELETE CASCADE,
        open            INTEGER NOT NULL DEFAULT 0,
        startedAt       INTEGER,
        endedAt         INTEGER,
        durationMs      INTEGER,
        expiresAt       INTEGER,
        messageId       TEXT,
        isSecret        INTEGER DEFAULT 0,
        formula         TEXT    DEFAULT '0',
        isForced        INTEGER DEFAULT 0,
        forceReason     TEXT,
        stage           INTEGER DEFAULT 1,
        runoffMessageId TEXT,
        annulledAt      INTEGER,
        annulReason     TEXT
      );

      CREATE TABLE IF NOT EXISTS votes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        proposalId  TEXT    NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        userId      TEXT    NOT NULL,
        voteType    TEXT    NOT NULL,
        createdAt   INTEGER NOT NULL,
        stage       INTEGER DEFAULT 1,
        UNIQUE(proposalId, userId, stage)
      );

      CREATE TABLE IF NOT EXISTS meetings (
        id               TEXT    PRIMARY KEY,
        title            TEXT    NOT NULL,
        meetingDate      TEXT    NOT NULL,
        channelId        TEXT    NOT NULL,
        messageId        TEXT,
        threadId         TEXT,
        createdAt        INTEGER NOT NULL,
        openedAt         INTEGER,
        durationMs       INTEGER NOT NULL DEFAULT 0,
        expiresAt        INTEGER NOT NULL DEFAULT 0,
        open             INTEGER NOT NULL DEFAULT 0,
        quorum           INTEGER DEFAULT 0,
        totalMembers     INTEGER DEFAULT 0,
        status           TEXT    DEFAULT 'planned',
        chamber          TEXT    NOT NULL DEFAULT 'senate',
        openVotesFor     TEXT    DEFAULT '[]',
        openVotesAgainst TEXT    DEFAULT '[]',
        openVotesAbstain TEXT    DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS meeting_agendas (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id  TEXT    NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        proposal_id TEXT    NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        UNIQUE(meeting_id, proposal_id)
      );

      CREATE TABLE IF NOT EXISTS senator_replacements (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId    TEXT,
        channelId    TEXT    NOT NULL,
        partyOrg     TEXT    NOT NULL,
        oldDiscordId TEXT,
        newDiscordId TEXT    NOT NULL,
        newName      TEXT,
        requesterId  TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'pending',
        approvedBy   TEXT,
        rejectReason TEXT,
        createdAt    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS senators (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        discordId   TEXT UNIQUE,
        tag         TEXT    NOT NULL DEFAULT '',
        name        TEXT    NOT NULL DEFAULT '',
        partyOrg    TEXT    NOT NULL DEFAULT '',
        active      INTEGER NOT NULL DEFAULT 1,
        reason      TEXT    NOT NULL DEFAULT '',
        source      TEXT    NOT NULL DEFAULT 'manual',
        createdAt   INTEGER NOT NULL,
        updatedAt   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bot_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_proposals_status     ON proposals(status);
      CREATE INDEX IF NOT EXISTS idx_proposals_created    ON proposals(createdAt);
      CREATE INDEX IF NOT EXISTS idx_votes_proposal_stage ON votes(proposalId, stage);
      CREATE INDEX IF NOT EXISTS idx_meetings_open        ON meetings(open);
      CREATE INDEX IF NOT EXISTS idx_meeting_agendas      ON meeting_agendas(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_quant_items          ON quantitative_items(proposalId);
      CREATE INDEX IF NOT EXISTS idx_senators_active      ON senators(active);
      CREATE INDEX IF NOT EXISTS idx_senators_party       ON senators(partyOrg, active);

      INSERT OR IGNORE INTO senate_counter (id, value) VALUES (1, 0);
    `);
    this._migrate();
    console.log('✅ Tables ready');
  }

  _migrate() {
    // Добавляем столбцы если их нет (совместимость со старой БД)
    const propCols = this.db.prepare('PRAGMA table_info(proposals)').all().map(c => c.name);
    if (!propCols.includes('partyOrg') && propCols.includes('party')) {
      this.db.exec('ALTER TABLE proposals RENAME COLUMN party TO partyOrg');
    } else if (!propCols.includes('partyOrg')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN partyOrg TEXT NOT NULL DEFAULT ''");
    }
    if (!propCols.includes('billForm')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN billForm TEXT NOT NULL DEFAULT ''");
    }
    if (!propCols.includes('coauthors')) {
      this.db.exec("ALTER TABLE proposals ADD COLUMN coauthors TEXT DEFAULT '[]'");
    }

    const meetCols = this.db.prepare('PRAGMA table_info(meetings)').all().map(c => c.name);
    if (!meetCols.includes('openVotesFor'))     this.db.exec("ALTER TABLE meetings ADD COLUMN openVotesFor TEXT DEFAULT '[]'");
    if (!meetCols.includes('openedAt'))         this.db.exec('ALTER TABLE meetings ADD COLUMN openedAt INTEGER');

    const senCols = this.db.prepare('PRAGMA table_info(senators)').all().map(c => c.name);
    if (!senCols.includes('discordId')) this.db.exec('ALTER TABLE senators ADD COLUMN discordId TEXT');
    if (!senCols.includes('tag'))       this.db.exec("ALTER TABLE senators ADD COLUMN tag TEXT NOT NULL DEFAULT ''");
    if (!senCols.includes('name'))      this.db.exec("ALTER TABLE senators ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    if (!senCols.includes('partyOrg'))  this.db.exec("ALTER TABLE senators ADD COLUMN partyOrg TEXT NOT NULL DEFAULT ''");
    if (!senCols.includes('active'))    this.db.exec('ALTER TABLE senators ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    if (!senCols.includes('reason'))    this.db.exec("ALTER TABLE senators ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
    if (!senCols.includes('source'))    this.db.exec("ALTER TABLE senators ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
    if (!senCols.includes('createdAt')) this.db.exec('ALTER TABLE senators ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0');
    if (!senCols.includes('updatedAt')) this.db.exec('ALTER TABLE senators ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0');
    if (!meetCols.includes('openVotesAgainst')) this.db.exec("ALTER TABLE meetings ADD COLUMN openVotesAgainst TEXT DEFAULT '[]'");
    if (!meetCols.includes('openVotesAbstain')) this.db.exec("ALTER TABLE meetings ADD COLUMN openVotesAbstain TEXT DEFAULT '[]'");

    const votCols = this.db.prepare('PRAGMA table_info(votings)').all().map(c => c.name);
    if (!votCols.includes('annulledAt'))   this.db.exec('ALTER TABLE votings ADD COLUMN annulledAt INTEGER');
    if (!votCols.includes('annulReason'))  this.db.exec('ALTER TABLE votings ADD COLUMN annulReason TEXT');
    if (!votCols.includes('isForced'))     this.db.exec('ALTER TABLE votings ADD COLUMN isForced INTEGER DEFAULT 0');
    if (!votCols.includes('forceReason'))  this.db.exec('ALTER TABLE votings ADD COLUMN forceReason TEXT');

    const repCols = this.db.prepare('PRAGMA table_info(senator_replacements)').all().map(c => c.name);
    if (!repCols.includes('reason'))       this.db.exec('ALTER TABLE senator_replacements ADD COLUMN reason TEXT DEFAULT ""');

    const meetCols2 = this.db.prepare('PRAGMA table_info(meetings)').all().map(c => c.name);
    if (!meetCols2.includes('speakerId'))  this.db.exec('ALTER TABLE meetings ADD COLUMN speakerId TEXT');

    const propCols2 = this.db.prepare('PRAGMA table_info(proposals)').all().map(c => c.name);
    if (!propCols2.includes('fedGovMessageId')) this.db.exec('ALTER TABLE proposals ADD COLUMN fedGovMessageId TEXT');
  }

  // ─── Счётчик ────────────────────────────────────────────────────────────────
  getNextProposalNumber() {
    const row = this.db.prepare('UPDATE senate_counter SET value = value + 1 WHERE id = 1 RETURNING value').get();
    return `SA-${String(row.value).padStart(3, '0')}`;
  }

  // ─── Законопроекты ──────────────────────────────────────────────────────────
  _parseProposal(row) {
    if (!row) return null;
    return {
      ...row,
      isQuantitative: Boolean(row.isQuantitative),
      events:    typeof row.events    === 'string' ? JSON.parse(row.events)    : (row.events    || []),
      coauthors: typeof row.coauthors === 'string' ? JSON.parse(row.coauthors) : (row.coauthors || [])
    };
  }

  createProposal(p) {
    this.db.prepare(`
      INSERT INTO proposals
        (id, number, name, partyOrg, link, billForm, status, createdAt, authorId,
         threadId, channelId, historyMessageId, initialMessageId,
         isQuantitative, events, chamber, coauthors)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      p.id, p.number, p.name, p.partyOrg || '', p.link, p.billForm || '',
      p.status, p.createdAt, p.authorId,
      p.threadId || null, p.channelId || null,
      p.historyMessageId || null, p.initialMessageId || null,
      p.isQuantitative ? 1 : 0,
      JSON.stringify(p.events || []),
      p.chamber || 'senate',
      JSON.stringify(p.coauthors || [])
    );
  }

  getProposal(id)               { return this._parseProposal(this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)); }
  getProposalByThreadId(tid)    { return this._parseProposal(this.db.prepare('SELECT * FROM proposals WHERE threadId = ?').get(tid)); }
  proposalExists(id)            { return !!this.db.prepare('SELECT 1 FROM proposals WHERE id = ? LIMIT 1').get(id); }
  getPendingProposals()         { return this.db.prepare("SELECT * FROM proposals WHERE status = 'На рассмотрении' ORDER BY createdAt ASC").all().map(r => this._parseProposal(r)); }
  getAllProposals()              { return this.db.prepare('SELECT * FROM proposals ORDER BY createdAt DESC').all().map(r => this._parseProposal(r)); }

  updateProposalStatus(id, s)   { this.db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(s, id); }
  updateProposalThread(id, tid) { this.db.prepare('UPDATE proposals SET threadId = ? WHERE id = ?').run(tid, id); }
  updateProposalHistoryMsg(id, mid) { this.db.prepare('UPDATE proposals SET historyMessageId = ? WHERE id = ?').run(mid, id); }
  updateProposalInitialMsg(id, mid) { this.db.prepare('UPDATE proposals SET initialMessageId = ? WHERE id = ?').run(mid, id); }
  updateProposalFedGovMsg(id, mid) { this.db.prepare('UPDATE proposals SET fedGovMessageId = ? WHERE id = ?').run(mid, id); }
  updateProposalEvents(id, ev)  { this.db.prepare('UPDATE proposals SET events = ? WHERE id = ?').run(JSON.stringify(ev), id); }
  deleteProposal(id)            { this.db.prepare('DELETE FROM proposals WHERE id = ?').run(id); }

  // ─── Рейтинговые пункты ────────────────────────────────────────────────────
  addQuantitativeItem(it) {
    this.db.prepare('INSERT INTO quantitative_items (proposalId, itemIndex, text) VALUES (?,?,?)').run(it.proposalId, it.itemIndex, it.text);
  }
  getQuantitativeItems(pid) {
    return this.db.prepare('SELECT * FROM quantitative_items WHERE proposalId = ? ORDER BY itemIndex').all(pid);
  }
  replaceQuantitativeItems(pid, items) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM quantitative_items WHERE proposalId = ?').run(pid);
      for (const it of items) this.addQuantitativeItem(it);
    });
    tx();
  }

  // ─── Голосования ────────────────────────────────────────────────────────────
  startVoting(v) {
    this.db.prepare(`
      INSERT INTO votings (proposalId,open,startedAt,durationMs,expiresAt,messageId,isSecret,formula,isForced,forceReason,stage,runoffMessageId)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(proposalId) DO UPDATE SET
        open=excluded.open, startedAt=excluded.startedAt, durationMs=excluded.durationMs,
        expiresAt=excluded.expiresAt, messageId=excluded.messageId, isSecret=excluded.isSecret,
        formula=excluded.formula, isForced=excluded.isForced, forceReason=excluded.forceReason, stage=excluded.stage, runoffMessageId=excluded.runoffMessageId,
        annulledAt=NULL, annulReason=NULL
    `).run(
      v.proposalId, v.open ? 1 : 0, v.startedAt, v.durationMs, v.expiresAt,
      v.messageId || null, v.isSecret ? 1 : 0, v.formula, v.isForced ? 1 : 0, v.forceReason || null, v.stage || 1, v.runoffMessageId || null
    );
  }

  endVoting(pid, endedAt)   { this.db.prepare('UPDATE votings SET open=0, endedAt=? WHERE proposalId=?').run(endedAt, pid); }
  annulVoting(pid, reason)  { this.db.prepare('UPDATE votings SET open=0, annulledAt=?, annulReason=? WHERE proposalId=?').run(Date.now(), reason, pid); }

  getVoting(pid) {
    const row = this.db.prepare('SELECT * FROM votings WHERE proposalId=?').get(pid);
    if (!row) return null;
    return { ...row, open: Boolean(row.open), isSecret: Boolean(row.isSecret), isForced: Boolean(row.isForced), forceReason: row.forceReason };
  }

  getOpenVotings() {
    return this.db.prepare(`
      SELECT p.*, v.open,v.startedAt,v.endedAt,v.durationMs,v.expiresAt,
             v.messageId,v.isSecret,v.formula,v.stage,v.runoffMessageId
      FROM proposals p JOIN votings v ON p.id=v.proposalId WHERE v.open=1
    `).all().map(r => ({ ...this._parseProposal(r), open: Boolean(r.open), isSecret: Boolean(r.isSecret) }));
  }

  // ─── Голоса ─────────────────────────────────────────────────────────────────
  addVote(v) {
    if (this.hasUserVoted(v.proposalId, v.userId, v.stage || 1)) return false;
    this.db.prepare('INSERT OR IGNORE INTO votes (proposalId,userId,voteType,createdAt,stage) VALUES (?,?,?,?,?)').run(
      v.proposalId, v.userId, v.voteType, v.createdAt, v.stage || 1
    );
    return true;
  }

  hasUserVoted(pid, uid, stage = 1) {
    return !!this.db.prepare('SELECT 1 FROM votes WHERE proposalId=? AND userId=? AND stage=? LIMIT 1').get(pid, uid, stage);
  }

  getVotes(pid, stage = 1)    { return this.db.prepare('SELECT * FROM votes WHERE proposalId=? AND stage=? ORDER BY createdAt ASC').all(pid, stage); }
  getVotesAllStages(pid)      { return this.db.prepare('SELECT * FROM votes WHERE proposalId=? ORDER BY stage ASC, createdAt ASC').all(pid); }
  deleteVotesForStage(pid, s) { this.db.prepare('DELETE FROM votes WHERE proposalId=? AND stage=?').run(pid, s); }

  // ─── Заседания ──────────────────────────────────────────────────────────────
  createMeeting(m) {
    this.db.prepare(`
      INSERT INTO meetings (id,title,meetingDate,channelId,messageId,threadId,createdAt,openedAt,
        durationMs,expiresAt,open,quorum,totalMembers,status,chamber,openVotesFor,openVotesAgainst,openVotesAbstain)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]','[]','[]')
    `).run(
      m.id, m.title, m.meetingDate, m.channelId, m.messageId || null, m.threadId || null,
      m.createdAt, m.openedAt || null, m.durationMs, m.expiresAt, m.open ? 1 : 0,
      m.quorum, m.totalMembers, m.status, m.chamber || 'senate'
    );
  }

  _parseMeeting(row) {
    if (!row) return null;
    return {
      ...row,
      open:             Boolean(row.open),
      openVotesFor:     JSON.parse(row.openVotesFor     || '[]'),
      openVotesAgainst: JSON.parse(row.openVotesAgainst || '[]'),
      openVotesAbstain: JSON.parse(row.openVotesAbstain || '[]')
    };
  }

  getMeeting(id)     { return this._parseMeeting(this.db.prepare('SELECT * FROM meetings WHERE id=?').get(id)); }
  getOpenMeetings()  { return this.db.prepare('SELECT * FROM meetings WHERE open=1').all().map(r => this._parseMeeting(r)); }
  getLastMeeting()   { return this._parseMeeting(this.db.prepare('SELECT * FROM meetings ORDER BY createdAt DESC LIMIT 1').get()); }
  closeMeeting(id)   { this.db.prepare('UPDATE meetings SET open=0 WHERE id=?').run(id); }

  updateMeeting(id, updates) {
    const fields = [], values = [];
    for (const [k, v] of Object.entries(updates)) {
      fields.push(`${k}=?`);
      values.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    if (!fields.length) return;
    values.push(id);
    this.db.prepare(`UPDATE meetings SET ${fields.join(',')} WHERE id=?`).run(...values);
  }

  updateMeetingMessage(id, mid) { this.db.prepare('UPDATE meetings SET messageId=? WHERE id=?').run(mid, id); }
  updateMeetingThread(id, tid)  { this.db.prepare('UPDATE meetings SET threadId=? WHERE id=?').run(tid, id); }
  updateMeetingSpeaker(id, sid) { this.db.prepare('UPDATE meetings SET speakerId=? WHERE id=?').run(sid, id); }

  saveMeetingOpenVotes(id, forArr, againstArr, abstainArr) {
    this.db.prepare('UPDATE meetings SET openVotesFor=?,openVotesAgainst=?,openVotesAbstain=? WHERE id=?')
      .run(JSON.stringify(forArr), JSON.stringify(againstArr), JSON.stringify(abstainArr || []), id);
  }

  // ─── Повестка ────────────────────────────────────────────────────────────────
  addToAgenda(meetingId, proposalId) {
    this.db.prepare('INSERT OR IGNORE INTO meeting_agendas (meeting_id,proposal_id) VALUES (?,?)').run(meetingId, proposalId);
  }
  removeFromAgenda(meetingId, proposalId) {
    this.db.prepare('DELETE FROM meeting_agendas WHERE meeting_id=? AND proposal_id=?').run(meetingId, proposalId);
  }
  getAgenda(meetingId) {
    return this.db.prepare(`
      SELECT p.* FROM meeting_agendas ma JOIN proposals p ON ma.proposal_id=p.id
      WHERE ma.meeting_id=? ORDER BY p.createdAt ASC
    `).all(meetingId).map(r => this._parseProposal(r));
  }

  // ─── Замены сенаторов ────────────────────────────────────────────────────────
  createReplacement(d) {
    const res = this.db.prepare(`
      INSERT INTO senator_replacements (messageId,channelId,partyOrg,oldDiscordId,newDiscordId,newName,requesterId,reason,status,createdAt)
      VALUES (?,?,?,?,?,?,?,?,'pending',?)
    `).run(d.messageId || null, d.channelId, d.partyOrg, d.oldDiscordId || null, d.newDiscordId, d.newName || null, d.requesterId, d.reason || null, Date.now());
    return res.lastInsertRowid;
  }
  updateReplacementMessage(id, mid) { this.db.prepare('UPDATE senator_replacements SET messageId=? WHERE id=?').run(mid, id); }
  getReplacement(id)                { return this.db.prepare('SELECT * FROM senator_replacements WHERE id=?').get(id); }
  getReplacementByMsgId(mid)        { return this.db.prepare('SELECT * FROM senator_replacements WHERE messageId=?').get(mid); }
  approveReplacement(id, by)        { this.db.prepare("UPDATE senator_replacements SET status='approved',approvedBy=? WHERE id=?").run(by, id); }
  rejectReplacement(id, reason)     { this.db.prepare("UPDATE senator_replacements SET status='rejected',rejectReason=? WHERE id=?").run(reason, id); }

  // ─── Сенаторы ───────────────────────────────────────────────────────────────
  _parseSenator(row) {
    if (!row) return null;
    return { ...row, active: Boolean(row.active) };
  }

  getSenators(includeInactive = true) {
    const rows = this.db.prepare(`SELECT * FROM senators ${includeInactive ? '' : 'WHERE active=1'} ORDER BY partyOrg COLLATE NOCASE ASC, name COLLATE NOCASE ASC, id ASC`).all();
    return rows.map(r => this._parseSenator(r));
  }

  getActiveSenators() {
    return this.getSenators(false);
  }

  getSenatorByDiscordId(discordId) {
    if (!discordId) return null;
    return this._parseSenator(this.db.prepare('SELECT * FROM senators WHERE discordId = ? LIMIT 1').get(discordId));
  }

  getSenatorByTag(tag) {
    const clean = (tag || '').trim().replace(/^@/, '');
    if (!clean) return null;
    return this._parseSenator(this.db.prepare('SELECT * FROM senators WHERE lower(tag) = lower(?) LIMIT 1').get(clean));
  }

  upsertSenator(senator) {
    const now = Date.now();
    const discordId = (senator.discordId || '').trim() || null;
    const tag = (senator.tag || '').trim().replace(/^@/, '');
    const name = (senator.name || '').trim();
    const partyOrg = (senator.partyOrg || '').trim();
    const reason = (senator.reason || '').trim();
    const source = (senator.source || 'manual').trim() || 'manual';
    const active = senator.active === false ? 0 : 1;

    const existing = discordId
      ? this.db.prepare('SELECT id, createdAt FROM senators WHERE discordId = ? LIMIT 1').get(discordId)
      : this.db.prepare('SELECT id, createdAt FROM senators WHERE lower(tag) = lower(?) LIMIT 1').get(tag);

    if (existing) {
      this.db.prepare(`
        UPDATE senators
        SET discordId = ?, tag = ?, name = ?, partyOrg = ?, active = ?, reason = ?, source = ?, updatedAt = ?
        WHERE id = ?
      `).run(discordId, tag, name, partyOrg, active, reason, source, now, existing.id);
      return this.getSenatorByDiscordId(discordId) || this.getSenatorByTag(tag);
    }

    const insertResult = this.db.prepare(`
      INSERT INTO senators (discordId, tag, name, partyOrg, active, reason, source, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(discordId, tag, name, partyOrg, active, reason, source, now, now);

    return this._parseSenator(this.db.prepare('SELECT * FROM senators WHERE id = ? LIMIT 1').get(insertResult.lastInsertRowid));
  }

  setSenatorActive(identifier, active, reason = '') {
    if (!identifier) return false;
    const senator = this.getSenatorByDiscordId(identifier) || this.getSenatorByTag(identifier);
    if (!senator) return false;
    this.db.prepare('UPDATE senators SET active = ?, reason = ?, updatedAt = ? WHERE id = ?').run(active ? 1 : 0, reason || '', Date.now(), senator.id);
    return true;
  }

  replaceSenatorRecord(oldTag, newTag, newName, partyOrg, reason = '') {
    const now = Date.now();
    const cleanOld = (oldTag || '').trim().replace(/^@/, '');
    const cleanNew = (newTag || '').trim().replace(/^@/, '');
    const oldSenator = cleanOld ? this.getSenatorByTag(cleanOld) : null;
    const newSenator = cleanNew ? this.getSenatorByTag(cleanNew) : null;

    if (oldSenator && (!newSenator || oldSenator.id !== newSenator.id)) {
      this.db.prepare('UPDATE senators SET active = 0, reason = ?, updatedAt = ? WHERE id = ?').run(reason || 'Замена', now, oldSenator.id);
    }

    return this.upsertSenator({
      discordId: newSenator?.discordId || null,
      tag: cleanNew || cleanOld,
      name: newName || newSenator?.name || cleanNew || cleanOld,
      partyOrg: partyOrg || newSenator?.partyOrg || oldSenator?.partyOrg || '',
      active: true,
      reason: '',
      source: oldSenator ? 'replacement' : 'manual'
    });
  }

  getPartyOrgs() {
    return [...new Set(this.getActiveSenators().map(s => s.partyOrg).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  getSenatorsByPartyOrg(partyOrg) {
    return this.getActiveSenators().filter(s => s.partyOrg === partyOrg);
  }

  setDefaultPartyOrg(defaultOrg) {
    const clean = (defaultOrg || '').trim();
    if (!clean) return 0;
    const now = Date.now();
    const res = this.db.prepare(`
      UPDATE senators
      SET partyOrg = ?, updatedAt = ?
      WHERE (partyOrg IS NULL OR partyOrg = '') AND active = 1
    `).run(clean, now);
    return res.changes || 0;
  }

  deactivateSenatorByTag(tag, reason = '') {
    return this.setSenatorActive(tag, false, reason);
  }

  cleanupDuplicateSenators() {
    let removed = 0;

    const dupIds = this.db.prepare(`
      SELECT discordId, COUNT(*) AS c
      FROM senators
      WHERE discordId IS NOT NULL AND discordId != ''
      GROUP BY discordId
      HAVING c > 1
    `).all();

    for (const row of dupIds) {
      const rows = this.db.prepare(`
        SELECT id FROM senators
        WHERE discordId = ?
        ORDER BY updatedAt DESC, id DESC
      `).all(row.discordId);
      const keep = rows.shift();
      if (!keep) continue;
      const idsToDelete = rows.map(r => r.id);
      if (idsToDelete.length) {
        const stmt = this.db.prepare(`DELETE FROM senators WHERE id = ?`);
        for (const id of idsToDelete) { stmt.run(id); removed++; }
      }
    }

    const dupTags = this.db.prepare(`
      SELECT lower(tag) AS tagKey, COUNT(*) AS c
      FROM senators
      WHERE tag IS NOT NULL AND tag != ''
      GROUP BY lower(tag)
      HAVING c > 1
    `).all();

    for (const row of dupTags) {
      const rows = this.db.prepare(`
        SELECT id FROM senators
        WHERE lower(tag) = ?
        ORDER BY updatedAt DESC, id DESC
      `).all(row.tagKey);
      const keep = rows.shift();
      if (!keep) continue;
      const idsToDelete = rows.map(r => r.id);
      if (idsToDelete.length) {
        const stmt = this.db.prepare(`DELETE FROM senators WHERE id = ?`);
        for (const id of idsToDelete) { stmt.run(id); removed++; }
      }
    }

    return removed;
  }

  // ─── Настройки ───────────────────────────────────────────────────────────────
  getBotSetting(key)         { return this.db.prepare('SELECT value FROM bot_settings WHERE key=?').get(key)?.value || null; }
  setBotSetting(key, value)  {
    if (value === null || value === undefined) this.db.prepare('DELETE FROM bot_settings WHERE key=?').run(key);
    else this.db.prepare('INSERT OR REPLACE INTO bot_settings (key,value) VALUES (?,?)').run(key, String(value));
  }

  close() { this.db.close(); }
}

export default new SenateDatabase();