(function (root) {
  'use strict';

  const C = root.LoLCore || (typeof require === 'function' ? require('./core.cjs') : null);
  if (!C) throw new Error('개인 성적을 불러오기 전에 경기 규칙을 불러와주세요.');
  const STAT_KEYS = Object.freeze(['kills', 'deaths', 'assists', 'cs', 'damage', 'gold', 'vision']);
  const KDA_KEYS = Object.freeze(['kills', 'deaths', 'assists']);
  const ROLE_IDS = new Set(C.ROLES.map(role => role.id));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && value.trim().length > 0;
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const duration = value => Number.isFinite(value) && value > 0 ? value : null;
  const name = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const excluded = value => !record(value) || value.cancelled === true || value.canceled === true || value.invalid === true || value.valid === false || ['cancelled', 'canceled', 'invalid', 'void'].includes(value.status);
  const copyList = values => Array.isArray(values) ? values.slice() : [];

  // Statistics are ephemeral projections. Never write them back into a match,
  // roster, or shuffle score. Missing measurements remain null at this boundary.
  function calculateWinRate(wins, games) {
    return number(wins) !== null && number(games) !== null && games > 0 && wins <= games ? wins / games * 100 : null;
  }
  function calculateKDA(kills, deaths, assists) {
    if ([kills, deaths, assists].some(value => number(value) === null)) return { ratio: null, perfect: false };
    return { ratio: deaths === 0 ? null : (kills + assists) / deaths, perfect: deaths === 0 };
  }
  function calculateAverageStats(rows) {
    const averages = {}, samples = {};
    STAT_KEYS.forEach(key => {
      let sum = 0, count = 0;
      rows.forEach(row => { const value = number(row[key]); if (value !== null) { sum += value; count += 1; } });
      averages[key] = count ? sum / count : null;
      samples[key] = count;
    });
    return { averages, samples };
  }
  function calculateCsPerMinute(rows) {
    let totalCs = 0, totalDurationSeconds = 0, games = 0;
    rows.forEach(row => {
      const cs = number(row.cs), seconds = duration(row.durationSeconds);
      if (cs === null || seconds === null) return;
      totalCs += cs;
      totalDurationSeconds += seconds;
      games += 1;
    });
    return { value: games ? totalCs / (totalDurationSeconds / 60) : null, games, totalCs: games ? totalCs : null, totalDurationSeconds: games ? totalDurationSeconds : null };
  }
  function aggregateStats(rows) {
    const games = rows.length, wins = rows.filter(row => row.won === true).length;
    const complete = rows.filter(row => KDA_KEYS.every(key => number(row[key]) !== null));
    const kda = { games: complete.length, kills: null, deaths: null, assists: null, ratio: null, perfect: false };
    if (complete.length) {
      KDA_KEYS.forEach(key => { kda[key] = complete.reduce((sum, row) => sum + row[key], 0); });
      Object.assign(kda, calculateKDA(kda.kills, kda.deaths, kda.assists));
    }
    const cs = calculateCsPerMinute(rows);
    return { games, wins, losses: games - wins, winRate: calculateWinRate(wins, games), kda, ...calculateAverageStats(rows), csPerMinute: cs.value, csPerMinuteGames: cs.games };
  }
  function aggregateByPosition(rows) {
    return C.ROLES.map(role => ({ id: role.id, name: role.label, ...aggregateStats(rows.filter(row => row.position === role.id)) }));
  }
  function aggregateByChampion(rows) {
    const groups = new Map();
    rows.forEach(row => {
      const champion = name(row.champion);
      if (!champion) return;
      const key = champion.toLocaleLowerCase('en-US');
      if (!groups.has(key)) groups.set(key, { id: key, name: champion, rows: [] });
      groups.get(key).rows.push(row);
    });
    return Array.from(groups.values(), group => ({ id: group.id, name: group.name, ...aggregateStats(group.rows) }))
      .sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name, 'ko'));
  }
  function recentOrder(a, b) {
    return String(b.date || '').localeCompare(String(a.date || '')) || String(b.endedAt || '').localeCompare(String(a.endedAt || '')) || String(b.seriesId || '').localeCompare(String(a.seriesId || '')) || (b.setNumber || 0) - (a.setNumber || 0);
  }
  function getRecentForm(rows, limit = 5) {
    const recent = rows.slice().sort(recentOrder);
    const results = recent.slice(0, Math.max(0, Number.isSafeInteger(limit) ? limit : 5)).map(row => row.won);
    const won = recent.length ? recent[0].won : null;
    let count = 0;
    for (const row of recent) { if (row.won !== won) break; count += 1; }
    const wins = results.filter(Boolean).length;
    return { games: results.length, wins, losses: results.length - wins, results, streak: { won, count } };
  }
  function profile(person, registered) {
    return { id: person.id, name: name(person.name) || person.id, tier: name(person.tier), primary: name(person.primary), secondary: copyList(person.secondary), excluded: copyList(person.excluded), active: person.active !== false, registered, currentNickname: name(person.currentNickname), nicknameAliases: copyList(person.nicknameAliases).map(name).filter(Boolean) };
  }
  function sourceSeries(state) {
    const history = record(state) && Array.isArray(state.history) ? state.history : [];
    const series = new Map();
    history.filter(item => record(item) && id(item.id)).slice()
      .sort((a, b) => String(a.endedAt || '').localeCompare(String(b.endedAt || '')))
      .forEach(item => series.set(item.id, { ...item, seriesId: item.id, current: false, archived: true }));
    if (record(state) && id(state.seriesId)) {
      const previous = series.get(state.seriesId);
      // Current played sets are authoritative even when the score was undone to
      // zero. This replaces, rather than adds to, an archived copy of the series.
      series.set(state.seriesId, { ...state, date: state.matchDate, endedAt: previous ? previous.endedAt : state.draw && state.draw.createdAt, current: true, archived: !!previous });
    }
    return Array.from(series.values());
  }
  function registeredProfiles(state, series) {
    const profiles = new Map();
    series.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.endedAt || '').localeCompare(String(b.endedAt || '')))
      .forEach(item => (Array.isArray(item.roster) ? item.roster : []).forEach(person => { if (record(person) && id(person.id)) profiles.set(person.id, profile(person, false)); }));
    const roster = record(state) && Array.isArray(state.roster) ? state.roster : C.DEFAULT_ROSTER;
    roster.forEach(person => { if (record(person) && id(person.id)) profiles.set(person.id, profile(person, true)); });
    return profiles;
  }
  function canonicalGame(raw, series, setNumber) {
    if (excluded(raw) || ![0, 1].includes(raw.winner) || !record(raw.draw) || !Array.isArray(raw.draw.teams) || raw.draw.teams.length !== 2) return null;
    if (!Array.isArray(raw.players)) return null;
    const details = new Map();
    for (const player of raw.players) {
      if (!record(player) || !id(player.id) || details.has(player.id)) return null;
      details.set(player.id, player);
    }
    const participants = [], seen = new Set();
    for (let teamIndex = 0; teamIndex < 2; teamIndex += 1) {
      const team = raw.draw.teams[teamIndex];
      if (!Array.isArray(team) || !team.length) return null;
      for (const slot of team) {
        if (!record(slot) || !id(slot.id) || seen.has(slot.id)) return null;
        seen.add(slot.id);
        const detail = details.get(slot.id) || {};
        const actualPosition = own(slot, 'role') ? slot.role : slot.position;
        const position = ROLE_IDS.has(actualPosition) ? actualPosition : null;
        const participant = { id: slot.id, teamIndex, won: raw.winner === teamIndex, position, role: position, champion: name(detail.champion), nicknameAtMatch: name(detail.nicknameAtMatch) };
        STAT_KEYS.forEach(key => { participant[key] = number(detail[key]); });
        participants.push(participant);
      }
    }
    if (Array.from(details.keys()).some(playerId => !seen.has(playerId))) return null;
    const teamNames = Array.isArray(series.teamNames) ? series.teamNames : C.TEAM_NAMES;
    return { seriesId: series.seriesId, date: typeof series.date === 'string' ? series.date : '', endedAt: series.endedAt || (raw.draw && raw.draw.createdAt) || '', setNumber, bestOf: series.bestOf, current: series.current, archived: series.archived, winner: raw.winner, durationSeconds: duration(raw.durationSeconds), externalId: name(raw.externalId), teamNames: teamNames.slice(), participants };
  }
  function normalizeSeries(series) {
    if (excluded(series)) return [];
    if (!Array.isArray(series.results)) return [];
    const winners = series.results;
    let status;
    try { status = C.seriesStatus(series.bestOf, winners); } catch (_error) { return []; }
    // Only absent `games` means a legacy record. Explicit malformed games never
    // turn into apparently valid records through a legacy fallback. A partial
    // or conflicting score log cannot establish which sets actually happened.
    if (own(series, 'games') && (!Array.isArray(series.games) || series.games.length !== winners.length || series.games.some((raw, index) => !record(raw) || raw.winner !== winners[index]))) return [];
    const rawGames = own(series, 'games') ? series.games : winners.map(winner => ({ winner, draw: series.draw, players: [], durationSeconds: null }));
    const games = [];
    rawGames.forEach((raw, index) => {
      const game = canonicalGame(raw, series, index + 1);
      if (game) games.push(game);
    });
    // Excluding a cancelled/invalid set must never manufacture a series win.
    const complete = status.complete && games.length === rawGames.length;
    const seriesWinner = complete ? status.winner : null;
    games.forEach(game => { game.seriesComplete = complete; game.seriesWinner = seriesWinner; game.ongoing = series.current && !complete; if (game.ongoing) game.archived = false; });
    return games;
  }
  function selectGames(state, options = {}) {
    return sourceSeries(state).flatMap(normalizeSeries).filter(game => !options.date || options.date === 'all' || game.date === options.date).sort(recentOrder);
  }
  function playerRows(games, playerId) {
    const rows = [];
    games.forEach(game => {
      const player = game.participants.find(value => value.id === playerId);
      if (!player) return;
      const { participants, teamNames, ...source } = game;
      rows.push({ ...source, ...player, teamName: teamNames[player.teamIndex] || C.TEAM_NAMES[player.teamIndex], kda: calculateKDA(player.kills, player.deaths, player.assists), teammates: participants.filter(value => value.teamIndex === player.teamIndex && value.id !== playerId).map(value => value.id) });
    });
    return rows;
  }
  function selectedPlayer(person, rows, profiles) {
    const totals = aggregateStats(rows), series = new Map(), teammateRows = new Map();
    totals.seriesWins = 0; totals.seriesLosses = 0; totals.mixedSeries = 0;
    rows.forEach(row => {
      if (!series.has(row.seriesId)) series.set(row.seriesId, { sides: new Set(), complete: row.seriesComplete, winner: row.seriesWinner });
      series.get(row.seriesId).sides.add(row.teamIndex);
      row.teammates.forEach(teammate => { if (!teammateRows.has(teammate)) teammateRows.set(teammate, []); teammateRows.get(teammate).push(row); });
    });
    series.forEach(item => {
      if (!item.complete) return;
      if (item.sides.size !== 1) { totals.mixedSeries += 1; return; }
      if (item.sides.values().next().value === item.winner) totals.seriesWins += 1;
      else totals.seriesLosses += 1;
    });
    const teammates = Array.from(teammateRows, ([playerId, matches]) => {
      const stats = aggregateStats(matches);
      return { id: playerId, name: profiles.get(playerId)?.name || playerId, games: stats.games, wins: stats.wins, losses: stats.losses, winRate: stats.winRate };
    }).sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name, 'ko'));
    return { profile: person, totals, seriesCount: series.size, recent: rows, positions: aggregateByPosition(rows), champions: aggregateByChampion(rows), form: getRecentForm(rows), teammates, missing: { position: rows.filter(row => row.position === null).length, champion: rows.filter(row => row.champion === null).length } };
  }
  function selection(state, options) {
    const series = sourceSeries(state), profiles = registeredProfiles(state, series);
    const games = series.flatMap(normalizeSeries).filter(game => !options.date || options.date === 'all' || game.date === options.date).sort(recentOrder);
    return { profiles, games };
  }
  function selectPlayers(state, options = {}) {
    const { profiles, games } = selection(state, options);
    return Array.from(profiles.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
      .map(person => selectedPlayer(person, playerRows(games, person.id), profiles));
  }
  function selectPlayer(state, playerId, options = {}) {
    const { profiles, games } = selection(state, options);
    return profiles.has(playerId) ? selectedPlayer(profiles.get(playerId), playerRows(games, playerId), profiles) : null;
  }

  const api = Object.freeze({ STAT_KEYS, calculateWinRate, calculateKDA, calculateAverageStats, calculateCsPerMinute, aggregateStats, aggregateByPosition, aggregateByChampion, getRecentForm, selectGames, selectPlayers, selectPlayer });
  root.LoLPlayerStats = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
