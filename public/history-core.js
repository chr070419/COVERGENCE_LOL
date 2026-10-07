(function (root) {
  'use strict';

  const C = root.LoLCore || (typeof require === 'function' ? require('./core.cjs') : null);
  if (!C) throw new Error('경기 기록을 불러오기 전에 경기 규칙을 불러와주세요.');
  const MAX_HISTORY = 5000;
  const STAT_LIMITS = Object.freeze({ kills: 1000, deaths: 1000, assists: 1000, damage: 10000000, cs: 100000, gold: 10000000, vision: 100000 });
  const STAT_KEYS = Object.freeze(Object.keys(STAT_LIMITS));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const fail = () => { throw new RangeError('경기 기록 데이터가 올바르지 않습니다. 백업 파일과 날짜를 확인해주세요.'); };

  function record(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.keys(value).every(key => !['__proto__', 'constructor', 'prototype'].includes(key) && own(Object.getOwnPropertyDescriptor(value, key), 'value'));
  }
  function text(value, length) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= length && !/[\u0000-\u001f\u007f]/.test(value);
  }
  function id(value) { return text(value, 100) && !['__proto__', 'constructor', 'prototype'].includes(value); }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const parsed = new Date(value + 'T00:00:00.000Z');
    return year >= 2000 && year <= 2100 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function timestamp(value) {
    if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
    const parsed = new Date(value);
    return parsed.toISOString() === value && date(value.slice(0, 10));
  }
  function today(now) {
    const value = now === undefined ? new Date() : new Date(now);
    if (!Number.isFinite(value.getTime())) fail();
    const valueDate = new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!date(valueDate)) fail();
    return valueDate;
  }
  function freshId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    if (!root.crypto || typeof root.crypto.getRandomValues !== 'function') throw new Error('안전한 기록 ID를 생성할 수 없는 브라우저입니다.');
    const bytes = root.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function safeCore(state) {
    if (!record(state) || !Array.isArray(state.roster) || state.roster.length !== 10 || !C.validateState(state)) return false;
    if (!state.roster.every(person => record(person) && id(person.id) && text(person.name, 50))) return false;
    if (own(state, 'shuffleOptions') && !record(state.shuffleOptions)) return false;
    if (state.draw !== null) {
      if (!record(state.draw) || !record(state.draw.metrics) || !timestamp(state.draw.createdAt)) return false;
      if (own(state.draw, 'adjusted') && typeof state.draw.adjusted !== 'boolean') return false;
      if (own(state.draw, 'constraints') && !record(state.draw.constraints)) return false;
      if (!state.draw.teams.every(team => team.every(slot => record(slot) && id(slot.id)))) return false;
    }
    return true;
  }
  function cloneRoster(roster) {
    return roster.map(person => ({ id: person.id, name: person.name, tier: person.tier, primary: person.primary, secondary: person.secondary.slice(), excluded: person.excluded.slice(), active: person.active, currentNickname: person.currentNickname ?? null, nicknameAliases: own(person, 'nicknameAliases') ? person.nicknameAliases.slice() : [] }));
  }
  function cloneDraw(draw, roster) {
    if (draw === null) return null;
    const teams = draw.teams.map(team => team.map(slot => ({ id: slot.id, role: slot.role })));
    const cloned = { teams, metrics: C.summarize(teams, roster, draw.constraints), createdAt: draw.createdAt, mode: draw.mode };
    if (own(draw, 'constraints')) cloned.constraints = C.normalizeShuffleOptions(draw.constraints, roster);
    if (own(draw, 'adjusted')) cloned.adjusted = draw.adjusted;
    return cloned;
  }
  function cloneCore(state) {
    const roster = cloneRoster(state.roster);
    const cloned = { version: 1, roster, mode: state.mode, bestOf: state.bestOf, draw: cloneDraw(state.draw, roster), results: state.results.slice(), drawNumber: state.drawNumber };
    if (own(state, 'shuffleOptions')) cloned.shuffleOptions = C.normalizeShuffleOptions(state.shuffleOptions, roster);
    return cloned;
  }
  function legacyId(state) {
    // Legacy backups have no stable session ID. Hash their canonical known
    // fields so importing the same scored backup cannot create another match.
    const legacy = cloneCore(state);
    // Identity metadata was added after these IDs shipped. It must never
    // change the legacy fingerprint, including canonical null/empty defaults.
    legacy.roster.forEach(person => { delete person.currentNickname; delete person.nicknameAliases; });
    const source = JSON.stringify(legacy);
    let a = 1779033703, b = 3144134277, c = 1013904242, d = 2773480762;
    for (let i = 0; i < source.length; i += 1) {
      const code = source.charCodeAt(i);
      a = b ^ Math.imul(a ^ code, 597399067);
      b = c ^ Math.imul(b ^ code, 2869860233);
      c = d ^ Math.imul(c ^ code, 951274213);
      d = a ^ Math.imul(d ^ code, 2716044179);
    }
    a = Math.imul(c ^ (a >>> 18), 597399067);
    b = Math.imul(d ^ (b >>> 22), 2869860233);
    c = Math.imul(a ^ (c >>> 17), 951274213);
    d = Math.imul(b ^ (d >>> 19), 2716044179);
    return 'legacy-' + [a ^ b ^ c ^ d, b ^ a, c ^ a, d ^ a].map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function nullableInteger(value, max, min = 0) {
    return value === null || (Number.isSafeInteger(value) && value >= min && value <= max);
  }
  function validDraw(draw, roster) {
    return record(draw) && safeCore({ version: 1, roster, mode: draw.mode, bestOf: 1, draw, results: [], drawNumber: 1 });
  }
  function blankPlayer(playerId) {
    const player = { id: playerId, champion: null, nicknameAtMatch: null };
    STAT_KEYS.forEach(key => { player[key] = null; });
    return player;
  }
  function validPlayer(player, participantIds) {
    if (!record(player) || !id(player.id) || !participantIds.has(player.id)) return false;
    if (own(player, 'champion') && player.champion !== null && !text(player.champion, 80)) return false;
    if (own(player, 'nicknameAtMatch') && player.nicknameAtMatch !== null && !C.normalizeNickname(player.nicknameAtMatch)) return false;
    return STAT_KEYS.every(key => nullableInteger(own(player, key) ? player[key] : null, STAT_LIMITS[key]));
  }
  function validGame(game, roster) {
    if (record(game) && (game.cancelled === true || game.canceled === true || game.invalid === true || game.valid === false || ['cancelled', 'canceled', 'invalid', 'void'].includes(game.status))) return false;
    if (!record(game) || ![0, 1].includes(game.winner) || !validDraw(game.draw, roster)) return false;
    if (!nullableInteger(own(game, 'durationSeconds') ? game.durationSeconds : null, 21600, 1)) return false;
    if (own(game, 'externalId') && game.externalId !== null && !text(game.externalId, 150)) return false;
    if (own(game, 'notes') && (typeof game.notes !== 'string' || game.notes.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(game.notes))) return false;
    if (!Array.isArray(game.players) || game.players.length !== 10) return false;
    const participantIds = new Set(game.draw.teams.flat().map(slot => slot.id));
    const seen = new Set();
    return Array.from(game.players).every(player => {
      if (!validPlayer(player, participantIds) || seen.has(player.id)) return false;
      seen.add(player.id);
      return true;
    });
  }
  function cloneGame(game, roster) {
    if (!validGame(game, roster)) fail();
    return {
      winner: game.winner, draw: cloneDraw(game.draw, roster), durationSeconds: game.durationSeconds ?? null,
      externalId: game.externalId ?? null, notes: game.notes ?? '',
      players: game.players.map(player => {
        const value = { id: player.id, champion: player.champion ?? null, nicknameAtMatch: player.nicknameAtMatch ?? null };
        STAT_KEYS.forEach(key => { value[key] = player[key] ?? null; });
        return value;
      })
    };
  }
  function plainGame(winner, draw, roster) {
    return { winner, draw: cloneDraw(draw, roster), durationSeconds: null, externalId: null, notes: '', players: draw.teams.flat().map(slot => blankPlayer(slot.id)) };
  }
  function validGames(container) {
    // The absence of games is the only legacy signal. Never repair an explicit
    // malformed game array: results and its immutable set snapshots must agree.
    if (!own(container, 'games')) return true;
    if (!Array.isArray(container.games) || container.games.length !== container.results.length) return false;
    const externalIds = new Set();
    return Array.from(container.games).every((game, index) => {
      if (!validGame(game, container.roster) || game.winner !== container.results[index]) return false;
      if (game.externalId != null) {
        if (externalIds.has(game.externalId)) return false;
        externalIds.add(game.externalId);
      }
      return true;
    });
  }
  function cloneGames(container) {
    if (!validGames(container)) fail();
    return own(container, 'games')
      ? container.games.map(game => cloneGame(game, container.roster))
      : container.results.map(winner => plainGame(winner, container.draw, container.roster));
  }
  function validSnapshot(item) {
    if (record(item) && (item.cancelled === true || item.canceled === true || item.invalid === true || item.valid === false)) return false;
    if (!record(item) || !id(item.id) || !date(item.date) || !timestamp(item.endedAt)) return false;
    if (!['completed', 'stopped'].includes(item.status) || !Array.isArray(item.results) || !item.results.length || !record(item.draw)) return false;
    if (!Array.isArray(item.teamNames) || item.teamNames.length !== 2 || !Array.from(item.teamNames).every(name => text(name, 50))) return false;
    const coreState = { version: 1, roster: item.roster, mode: item.draw.mode, bestOf: item.bestOf, draw: item.draw, results: item.results, drawNumber: item.drawNumber };
    if (!safeCore(coreState) || !validGames(item)) return false;
    return (item.status === 'completed') === C.seriesStatus(item.bestOf, item.results).complete;
  }
  function validateSnapshot(item) {
    try { return validSnapshot(item); } catch (_error) { return false; }
  }
  function validHistory(items) {
    if (!Array.isArray(items) || items.length > MAX_HISTORY) return false;
    const seen = new Set();
    return Array.from(items).every(item => {
      if (!validSnapshot(item) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }
  function cloneSnapshot(item) {
    if (!validateSnapshot(item)) fail();
    const roster = cloneRoster(item.roster);
    return { id: item.id, date: item.date, endedAt: item.endedAt, status: item.status, bestOf: item.bestOf, results: item.results.slice(), games: cloneGames(item), roster, draw: cloneDraw(item.draw, roster), drawNumber: item.drawNumber, teamNames: item.teamNames.slice() };
  }
  function sorted(items) {
    return items.sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id));
  }
  function validate(state) {
    try {
      return safeCore(state) && validGames(state) && state.archiveVersion === 1 && id(state.seriesId) && date(state.matchDate) && validHistory(state.history);
    } catch (_error) { return false; }
  }
  function upgrade(rawState) {
    try {
      if (!safeCore(rawState)) fail();
      if (!validGames(rawState)) fail();
      const state = cloneCore(rawState);
      state.games = cloneGames(rawState);
      state.archiveVersion = own(rawState, 'archiveVersion') ? rawState.archiveVersion : 1;
      state.seriesId = own(rawState, 'seriesId') ? rawState.seriesId : rawState.draw && rawState.results.length ? legacyId(rawState) : freshId();
      // Older backups did not store the match day. A scored draw is the only
      // known historical date; do not silently assign the day of restoration.
      state.matchDate = own(rawState, 'matchDate') ? rawState.matchDate : today(rawState.results.length && rawState.draw ? rawState.draw.createdAt : undefined);
      if (own(rawState, 'history') && !validHistory(rawState.history)) fail();
      state.history = own(rawState, 'history') ? sorted(rawState.history.map(cloneSnapshot)) : [];
      if (!validate(state)) fail();
      return state;
    } catch (_error) { fail(); }
  }
  function checkedClone(state) {
    if (!validate(state)) fail();
    return upgrade(state);
  }
  function checkedNickname(value) {
    if (!C.normalizeNickname(value)) throw new RangeError('닉네임은 제어 문자 없이 1~100자로 입력해주세요.');
    return value.trim().replace(/\s+/g, ' ');
  }
  function uniqueNicknames(values, current) {
    if (!Array.isArray(values) || values.length > 30) throw new RangeError('이전 닉네임은 최대 30개까지 저장할 수 있습니다.');
    const seen = new Set(current === null ? [] : [C.normalizeNickname(current)]);
    return Array.from(values).reduce((result, value) => {
      const display = checkedNickname(value), key = C.normalizeNickname(display);
      if (!seen.has(key)) { seen.add(key); result.push(display); }
      return result;
    }, []);
  }
  function updatePlayerNicknames(state, playerId, identity) {
    const next = checkedClone(state);
    if (!id(playerId) || !record(identity) || !own(identity, 'currentNickname') || !own(identity, 'nicknameAliases')) fail();
    const person = next.roster.find(player => player.id === playerId);
    if (!person) throw new RangeError('닉네임을 변경할 선수를 찾을 수 없습니다.');
    const current = identity.currentNickname === null ? null : checkedNickname(identity.currentNickname);
    const aliases = uniqueNicknames(identity.nicknameAliases, current);
    if (person.currentNickname !== null && C.normalizeNickname(person.currentNickname) !== C.normalizeNickname(current) && !aliases.some(alias => C.normalizeNickname(alias) === C.normalizeNickname(person.currentNickname))) aliases.push(person.currentNickname);
    if (aliases.length > 30) throw new RangeError('기존 닉네임 보존을 포함해 이전 닉네임은 최대 30개까지 저장할 수 있습니다.');
    person.currentNickname = current;
    person.nicknameAliases = aliases;
    // Metadata changes never archive, reshuffle or rewrite a historical roster.
    if (!validate(next)) fail();
    return next;
  }
  function rememberPlayerNicknames(state, associations) {
    const next = checkedClone(state);
    if (!Array.isArray(associations) || associations.length > 100) fail();
    Array.from(associations).forEach(association => {
      if (!record(association) || !id(association.playerId)) fail();
      const person = next.roster.find(player => player.id === association.playerId);
      if (!person) throw new RangeError('닉네임을 연결할 선수를 찾을 수 없습니다.');
      const display = checkedNickname(association.nickname), key = C.normalizeNickname(display);
      if ([person.name, person.currentNickname].concat(person.nicknameAliases).some(value => C.normalizeNickname(value) === key)) return;
      if (person.nicknameAliases.length >= 30) throw new RangeError('이전 닉네임은 최대 30개까지 저장할 수 있습니다.');
      person.nicknameAliases.push(display);
    });
    if (!validate(next)) fail();
    return next;
  }
  function upsert(state) {
    const previous = state.history.find(item => item.id === state.seriesId);
    if (!previous && state.history.length >= MAX_HISTORY) throw new RangeError('보관 한도에 도달했습니다. 전체 백업을 저장해주세요.');
    const status = C.seriesStatus(state.bestOf, state.results);
    const item = cloneSnapshot({ id: state.seriesId, date: state.matchDate, endedAt: previous ? previous.endedAt : new Date().toISOString(), status: status.complete ? 'completed' : 'stopped', bestOf: state.bestOf, results: state.results, games: state.games, roster: state.roster, draw: state.games[state.games.length - 1].draw, drawNumber: state.drawNumber, teamNames: C.TEAM_NAMES });
    // Re-saving a completed current series may update scores or match detail,
    // but its saved nickname registry describes the time it was archived.
    // Explicit snapshot edits are authoritative and become the next baseline.
    if (previous) {
      const savedIdentities = new Map(previous.roster.map(person => [person.id, person]));
      item.roster.forEach(person => {
        const saved = savedIdentities.get(person.id);
        if (!saved) return;
        person.currentNickname = saved.currentNickname;
        person.nicknameAliases = saved.nicknameAliases.slice();
      });
    }
    state.history = sorted(state.history.filter(record => record.id !== item.id).concat(item));
    return state;
  }
  function syncCurrent(state) {
    const next = checkedClone(state);
    if (C.seriesStatus(next.bestOf, next.results).complete) return upsert(next);
    next.history = next.history.filter(item => item.id !== next.seriesId);
    return next;
  }
  function archiveCurrent(state) {
    const next = checkedClone(state);
    return next.results.length ? upsert(next) : next;
  }
  function newSeries(state) {
    const next = checkedClone(state);
    next.seriesId = freshId();
    next.results = [];
    next.games = [];
    return next;
  }
  function mergeHistory(currentHistory, incomingHistory) {
    try {
      if (!validHistory(currentHistory) || !validHistory(incomingHistory)) fail();
      const merged = new Map();
      currentHistory.concat(incomingHistory).forEach(item => merged.set(item.id, cloneSnapshot(item)));
      if (merged.size > MAX_HISTORY) throw new RangeError('기록을 합치면 5,000개를 초과합니다.');
      return sorted(Array.from(merged.values()));
    } catch (_error) { fail(); }
  }
  function recordGame(state, winner, details = {}) {
    const next = checkedClone(state);
    if (![0, 1].includes(winner) || !record(details) || !next.draw || C.seriesStatus(next.bestOf, next.results).complete) fail();
    if (own(details, 'winner') && details.winner !== winner) fail();
    if (own(details, 'draw')) fail();
    const game = plainGame(winner, next.draw, next.roster);
    ['durationSeconds', 'externalId', 'notes'].forEach(key => { if (own(details, key)) game[key] = details[key]; });
    if (own(details, 'players')) {
      if (!Array.isArray(details.players)) fail();
      game.players = Array.from(details.players).map(player => {
        if (!record(player)) fail();
        const value = blankPlayer(player.id);
        ['champion', 'nicknameAtMatch'].concat(STAT_KEYS).forEach(key => { if (own(player, key)) value[key] = player[key]; });
        return value;
      });
    }
    if (!validGame(game, next.roster)) fail();
    next.games.push(game);
    next.results.push(winner);
    return syncCurrent(next);
  }
  function undoGame(state) {
    const next = checkedClone(state);
    if (!next.games.length) return next;
    const removed = next.games.pop();
    next.results.pop();
    next.draw = cloneDraw(removed.draw, next.roster);
    next.mode = next.draw.mode;
    return syncCurrent(next);
  }
  function setNextDraw(state, draw) {
    const next = checkedClone(state);
    if (C.seriesStatus(next.bestOf, next.results).complete || !validDraw(draw, next.roster)) fail();
    next.draw = cloneDraw(draw, next.roster);
    next.mode = draw.mode;
    next.drawNumber = Math.max(1, next.drawNumber + 1);
    return next;
  }
  function replaceGame(state, index, game) {
    const next = checkedClone(state);
    if (!Number.isSafeInteger(index) || index < 0 || index >= next.games.length || !record(game)) fail();
    const replacement = { ...next.games[index] };
    ['winner', 'draw', 'durationSeconds', 'externalId', 'notes', 'players'].forEach(key => { if (own(game, key)) replacement[key] = game[key]; });
    if (!validGame(replacement, next.roster)) fail();
    next.games[index] = cloneGame(replacement, next.roster);
    next.results = next.games.map(item => item.winner);
    C.seriesStatus(next.bestOf, next.results);
    if (C.seriesStatus(next.bestOf, next.results).complete) {
      next.draw = cloneDraw(next.games[next.games.length - 1].draw, next.roster);
      next.mode = next.draw.mode;
    }
    return syncCurrent(next);
  }
  function replaceSnapshot(state, item) {
    const next = checkedClone(state);
    if (!validateSnapshot(item)) fail();
    if (!next.history.some(existing => existing.id === item.id) && next.history.length >= MAX_HISTORY) throw new RangeError('보관 한도에 도달했습니다. 전체 백업을 저장해주세요.');
    const replacement = cloneSnapshot(item);
    // A record describes the last played lineup, never a later unplayed draw.
    replacement.draw = cloneDraw(replacement.games[replacement.games.length - 1].draw, replacement.roster);
    next.history = sorted(next.history.filter(existing => existing.id !== replacement.id).concat(replacement));
    if (replacement.id === next.seriesId) {
      const currentIdentities = new Map(next.roster.map(person => [person.id, { currentNickname: person.currentNickname, nicknameAliases: person.nicknameAliases.slice() }]));
      next.roster = cloneRoster(replacement.roster);
      next.roster.forEach(person => { if (currentIdentities.has(person.id)) Object.assign(person, currentIdentities.get(person.id)); });
      next.matchDate = replacement.date;
      next.bestOf = replacement.bestOf;
      next.games = cloneGames(replacement);
      next.results = replacement.results.slice();
      next.draw = cloneDraw(replacement.draw, next.roster);
      next.mode = next.draw.mode;
      next.drawNumber = replacement.drawNumber;
      // Editing an ended record to an incomplete score means it was stopped,
      // not resumed. Start a new active series so syncCurrent cannot erase it.
      if (replacement.status === 'stopped') {
        next.seriesId = freshId();
        next.results = [];
        next.games = [];
      }
    }
    if (!validate(next)) fail();
    return next;
  }
  function removeSnapshot(state, recordId) {
    const next = checkedClone(state);
    if (!id(recordId) || !next.history.some(item => item.id === recordId)) throw new RangeError('삭제할 경기 기록을 찾을 수 없습니다. 새로고침해 주세요.');
    next.history = next.history.filter(item => item.id !== recordId);
    // The current series may be a mirror of this completed archive. Detach it
    // so later saves and live-stat selectors cannot resurrect the deleted sets.
    if (next.seriesId === recordId) {
      next.seriesId = freshId();
      next.results = [];
      next.games = [];
    }
    return next;
  }
  function percent(wins, games) { return games ? wins / games * 100 : 0; }
  function summarize(records) {
    if (!validHistory(records)) fail();
    const teams = C.TEAM_NAMES.map(name => ({ name, seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 }));
    const players = new Map();
    let completed = 0;
    let games = 0;
    const chronological = sorted(records.slice()).reverse();
    chronological.forEach(raw => {
      const item = cloneSnapshot(raw);
      const status = C.seriesStatus(item.bestOf, item.results);
      games += item.games.length;
      if (status.complete) completed += 1;
      teams.forEach((team, index) => {
        team.name = item.teamNames[index];
        team.gameWins += status.wins[index];
        team.gameLosses += status.wins[1 - index];
        team.seriesWins += status.complete && status.winner === index ? 1 : 0;
        team.seriesLosses += status.complete && status.winner !== index ? 1 : 0;
      });
      const roster = new Map(item.roster.map(person => [person.id, person]));
      const participated = new Map();
      item.games.forEach(game => game.draw.teams.forEach((team, teamIndex) => team.forEach(slot => {
        const person = roster.get(slot.id);
        if (!players.has(person.id)) players.set(person.id, { id: person.id, name: person.name, matches: 0, seriesWins: 0, seriesLosses: 0, mixedSeries: 0, gameWins: 0, gameLosses: 0, winRate: 0 });
        const stats = players.get(person.id);
        stats.name = person.name;
        stats.gameWins += game.winner === teamIndex ? 1 : 0;
        stats.gameLosses += game.winner !== teamIndex ? 1 : 0;
        stats.winRate = percent(stats.gameWins, stats.gameWins + stats.gameLosses);
        if (!participated.has(person.id)) participated.set(person.id, new Set());
        participated.get(person.id).add(teamIndex);
      })));
      participated.forEach((memberships, playerId) => {
        const stats = players.get(playerId);
        stats.matches += 1;
        if (!status.complete) return;
        if (memberships.size !== 1) { stats.mixedSeries += 1; return; }
        const teamIndex = memberships.values().next().value;
        stats.seriesWins += status.winner === teamIndex ? 1 : 0;
        stats.seriesLosses += status.winner !== teamIndex ? 1 : 0;
      });
    });
    return { matches: records.length, completed, stopped: records.length - completed, games, teams, players: Array.from(players.values()).sort((a, b) => b.gameWins - a.gameWins || b.winRate - a.winRate || a.name.localeCompare(b.name, 'ko')), days: new Set(records.map(item => item.date)).size };
  }
  // Compatibility projection for earlier callers. All individual calculation
  // lives in player-stats; the UI and future balancing readers share that layer.
  function playerDetails(records, playerId) {
    if (!validHistory(records) || !id(playerId)) fail();
    const S = root.LoLPlayerStats || (typeof require === 'function' ? require('./player-stats.cjs') : null);
    if (!S) throw new Error('개인 성적 계산 모듈을 먼저 불러와주세요.');
    const detail = S.selectPlayer({ roster: [], history: records }, playerId);
    const totals = detail ? detail.totals : S.aggregateStats([]);
    const group = value => ({ games: value.games, wins: value.wins, losses: value.losses, winRate: value.winRate });
    return {
      id: playerId, name: detail ? detail.profile.name : playerId,
      games: totals.games, wins: totals.wins, losses: totals.losses, winRate: totals.winRate,
      seriesWins: totals.seriesWins || 0, seriesLosses: totals.seriesLosses || 0, mixedSeries: totals.mixedSeries || 0,
      kda: { kills: totals.kda.kills, deaths: totals.kda.deaths, assists: totals.kda.assists, games: totals.kda.games, ratio: totals.kda.ratio, perfect: totals.kda.perfect },
      roles: detail ? detail.positions.filter(value => value.games).map(value => ({ id: value.id, name: value.name, ...group(value) })).sort((a,b) => b.games-a.games || a.id.localeCompare(b.id)) : [],
      champions: detail ? detail.champions.map(value => ({ name: value.name, ...group(value) })) : [],
      recent: detail ? detail.recent : [], teammates: detail ? detail.teammates : [], unknownChampions: detail ? detail.missing.champion : 0
    };
  }

  const api = Object.freeze({ MAX_HISTORY, STAT_LIMITS, today, upgrade, validate, syncCurrent, archiveCurrent, newSeries, mergeHistory, summarize, recordGame, undoGame, setNextDraw, replaceGame, cloneSnapshot, validateSnapshot, replaceSnapshot, removeSnapshot, playerDetails, updatePlayerNicknames, rememberPlayerNicknames });
  root.LoLHistory = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
