(function (root) {
  'use strict';

  const ROLES = Object.freeze([
    { id: 'top', label: '탑', short: 'TOP' },
    { id: 'jungle', label: '정글', short: 'JGL' },
    { id: 'mid', label: '미드', short: 'MID' },
    { id: 'adc', label: '원딜', short: 'ADC' },
    { id: 'support', label: '서포터', short: 'SUP' }
  ].map(Object.freeze));
  const TIERS = Object.freeze([
    { id: 'unranked', label: '언랭크', score: 0 },
    { id: 'iron', label: '아이언', score: 1 },
    { id: 'bronze', label: '브론즈', score: 2 },
    { id: 'silver', label: '실버', score: 3 },
    { id: 'gold', label: '골드', score: 4 },
    { id: 'platinum', label: '플래티넘', score: 5 },
    { id: 'emerald', label: '에메랄드', score: 6 },
    { id: 'diamond', label: '다이아몬드', score: 7 },
    { id: 'master', label: '마스터', score: 8 },
    { id: 'grandmaster', label: '그랜드마스터', score: 9 },
    { id: 'challenger', label: '챌린저', score: 10 }
  ].map(Object.freeze));
  const CAPTAINS = Object.freeze(['jongwon', 'minjae']);
  const TEAM_NAMES = Object.freeze(['종원 팀', '민재 팀']);
  const roleIds = new Set(ROLES.map(function (role) { return role.id; }));
  const preferenceIds = new Set(Array.from(roleIds).concat('fill'));
  const tiersById = new Map(TIERS.map(function (tier) { return [tier.id, tier]; }));
  const modes = new Set(['balanced', 'random']);
  const allowedBestOf = new Set([1, 3, 5, 7]);
  const DEFAULT_ROSTER = Object.freeze([
    { id: 'injae', name: '신인재', tier: 'silver', primary: 'top', secondary: ['mid', 'jungle'], excluded: [], active: true },
    { id: 'seungju', name: '피승주', tier: 'gold', primary: 'mid', secondary: ['top'], excluded: [], active: true },
    { id: 'dongin', name: '홍동인', tier: 'gold', primary: 'top', secondary: ['mid'], excluded: [], active: true },
    { id: 'minjae', name: '권민재', tier: 'diamond', primary: 'adc', secondary: ['fill'], excluded: [], active: true },
    { id: 'seongpyo', name: '전성표', tier: 'emerald', primary: 'top', secondary: ['jungle'], excluded: [], active: true },
    { id: 'haeram', name: '최해람', tier: 'silver', primary: 'mid', secondary: ['top'], excluded: [], active: true },
    { id: 'junhyeok', name: '전준혁', tier: 'gold', primary: 'top', secondary: ['mid'], excluded: [], active: true },
    { id: 'sejun', name: '권세준', tier: 'silver', primary: 'mid', secondary: ['top', 'jungle'], excluded: [], active: true },
    { id: 'changwoo', name: '유창우', tier: 'silver', primary: 'fill', secondary: [], excluded: ['support'], active: true },
    { id: 'jongwon', name: '이종원', tier: 'diamond', primary: 'adc', secondary: ['fill'], excluded: [], active: true }
  ].map(function (person) {
    person.currentNickname = null;
    person.nicknameAliases = Object.freeze([]);
    Object.freeze(person.secondary);
    Object.freeze(person.excluded);
    return Object.freeze(person);
  }));

  function fail(message) { throw new RangeError(message); }
  function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isText(value, maxLength) { return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength; }
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function identityRecord(value) {
    if (!isRecord(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) && Object.keys(value).every(function (key) {
      return !['__proto__', 'constructor', 'prototype'].includes(key) && own(Object.getOwnPropertyDescriptor(value, key), 'value');
    });
  }
  // A lookup key only: presentation strings retain their case and Riot tag.
  // Invalid lookup values never become a match; strict validators reject them.
  function normalizeNickname(value) {
    if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) return '';
    const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    return normalized.length <= 100 ? normalized : '';
  }
  function validNicknames(person) {
    const current = own(person, 'currentNickname') ? person.currentNickname : null;
    const aliases = own(person, 'nicknameAliases') ? person.nicknameAliases : [];
    if (current !== null && !normalizeNickname(current)) return false;
    if (!Array.isArray(aliases) || aliases.length > 30) return false;
    const keys = Array.from(aliases).map(normalizeNickname);
    return keys.every(Boolean) && new Set(keys).size === keys.length && !keys.includes(normalizeNickname(current));
  }
  function distinctValues(values, allowed) {
    return Array.isArray(values) && Array.from(values).every(function (value) { return allowed.has(value); }) && new Set(values).size === values.length;
  }
  function checkRoster(roster, requirePlayable) {
    if (!Array.isArray(roster) || roster.length < 1 || roster.length > 100) fail('참가자 명단이 올바르지 않습니다.');
    const ids = new Set();
    Array.from(roster).forEach(function (person) {
      if (!identityRecord(person) || !isText(person.id, 100) || !isText(person.name, 50) || /[\u0000-\u001f\u007f]/.test(person.id + person.name) || ['__proto__', 'constructor', 'prototype'].includes(person.id) || ids.has(person.id)) fail('참가자 이름과 고유 ID를 확인해주세요.');
      if (!validNicknames(person)) fail('현재 닉네임과 이전 닉네임 목록을 확인해주세요.');
      ids.add(person.id);
      if (!tiersById.has(person.tier) || !preferenceIds.has(person.primary) || typeof person.active !== 'boolean') fail('참가자 티어와 주 라인을 확인해주세요.');
      if (!distinctValues(person.secondary, preferenceIds) || !distinctValues(person.excluded, roleIds)) fail('부 라인과 제외 라인을 확인해주세요.');
      if (person.secondary.includes(person.primary) || person.excluded.includes(person.primary) || person.secondary.some(function (role) { return person.excluded.includes(role); })) fail('선호 라인과 제외 라인은 중복될 수 없습니다.');
      if (person.excluded.length === ROLES.length) fail('최소 한 개의 라인을 선택해주세요.');
    });
    const active = roster.filter(function (person) { return person.active; });
    if (requirePlayable) {
      if (active.length !== 10) fail('5 대 5 내전은 참가자 10명이 필요합니다.');
      if (!CAPTAINS.every(function (id) { return active.some(function (person) { return person.id === id; }); })) fail('이종원, 권민재 팀장이 모두 참가해야 합니다.');
    }
    return active;
  }

  function normalizeShuffleOptions(options, roster) {
    if (options === undefined) options = {};
    if (!isRecord(options)) fail('셔플 조건이 올바르지 않습니다.');
    if (options.captainsLocked !== undefined && typeof options.captainsLocked !== 'boolean') fail('팀장 고정 조건을 확인해주세요.');
    if (options.avoidRepeat !== undefined && typeof options.avoidRepeat !== 'boolean') fail('이전 조합 최소화 조건을 확인해주세요.');
    const sourcePairs = options.separatePairs === undefined ? [] : options.separatePairs;
    if (!Array.isArray(sourcePairs) || sourcePairs.length > 10) fail('분리할 선수는 최대 10쌍까지 설정할 수 있습니다.');
    const ids = roster === undefined ? null : new Set(checkRoster(roster, false).map(function (person) { return person.id; }));
    const seen = new Set();
    const separatePairs = Array.from(sourcePairs).map(function (pair) {
      if (!Array.isArray(pair) || pair.length !== 2 || !Array.from(pair).every(function (id) { return isText(id, 100); }) || pair[0] === pair[1]) fail('서로 다른 선수 2명을 분리 조건으로 선택해주세요.');
      if (ids && pair.some(function (id) { return !ids.has(id); })) fail('분리 조건에는 참가 중인 선수만 선택할 수 있습니다.');
      const canonical = pair.slice().sort();
      const key = JSON.stringify(canonical);
      if (seen.has(key)) fail('같은 선수 분리 조건을 중복할 수 없습니다.');
      seen.add(key);
      return canonical;
    }).sort(function (a, b) { return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1; });
    return { captainsLocked: options.captainsLocked === undefined ? true : options.captainsLocked, separatePairs, avoidRepeat: options.avoidRepeat === undefined ? true : options.avoidRepeat };
  }

  function randomInt(max) {
    if (root.TeamDrawCore && typeof root.TeamDrawCore.randomInt === 'function') return root.TeamDrawCore.randomInt(max);
    if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) fail('난수 범위가 올바르지 않습니다.');
    if (max === 1) return 0;
    if (!root.crypto || typeof root.crypto.getRandomValues !== 'function') throw new Error('안전한 난수 생성을 지원하는 브라우저가 필요합니다.');
    const samples = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    do { root.crypto.getRandomValues(samples); } while (samples[0] >= limit);
    return samples[0] % max;
  }

  function fit(person, role) {
    if (!isRecord(person) || !roleIds.has(role)) fail('라인 적합도를 계산할 수 없습니다.');
    if (Array.isArray(person.excluded) && person.excluded.includes(role)) return { kind: 'excluded', label: '제외 라인', cost: Infinity };
    if (person.primary === role) return { kind: 'primary', label: '주 라인', cost: 0 };
    if (Array.isArray(person.secondary) && person.secondary.includes(role)) return { kind: 'secondary', label: '부 라인', cost: 2 + person.secondary.indexOf(role) };
    if (person.primary === 'fill' || (Array.isArray(person.secondary) && person.secondary.includes('fill'))) return { kind: 'flex', label: '가능 라인', cost: 3 };
    return { kind: 'off', label: '비선호 배정', cost: 18 };
  }

  function tierScore(person) {
    if (!isRecord(person) || !tiersById.has(person.tier)) fail('티어 정보가 올바르지 않습니다.');
    return tiersById.get(person.tier).score;
  }

  function checkedTeams(teams, roster, options) {
    const active = checkRoster(roster, true);
    const constraints = normalizeShuffleOptions(options, roster);
    const people = new Map(active.map(function (person) { return [person.id, person]; }));
    if (!Array.isArray(teams) || teams.length !== 2) fail('두 팀의 편성 정보가 필요합니다.');
    const seen = new Set();
    Array.from(teams).forEach(function (team, teamIndex) {
      if (!Array.isArray(team) || team.length !== 5) fail('각 팀은 5명이어야 합니다.');
      const lanes = new Set();
      Array.from(team).forEach(function (slot) {
        if (!isRecord(slot) || !people.has(slot.id) || seen.has(slot.id) || !roleIds.has(slot.role) || lanes.has(slot.role)) fail('중복 인원 또는 중복 라인이 있습니다.');
        if (fit(people.get(slot.id), slot.role).kind === 'excluded') fail('제외한 라인에는 배정할 수 없습니다.');
        seen.add(slot.id);
        lanes.add(slot.role);
      });
      if (constraints.captainsLocked && !team.some(function (slot) { return slot.id === CAPTAINS[teamIndex]; })) fail('팀장 배정이 올바르지 않습니다.');
      const members = new Set(team.map(function (slot) { return slot.id; }));
      if (constraints.separatePairs.some(function (pair) { return members.has(pair[0]) && members.has(pair[1]); })) fail('분리 조건으로 지정한 선수는 같은 팀에 배정할 수 없습니다.');
    });
    return people;
  }

  function summarize(teams, roster, options) {
    const people = checkedTeams(teams, roster, options);
    const totals = [0, 0];
    let offRole = 0;
    let primary = 0;
    teams.forEach(function (team, index) {
      team.forEach(function (slot) {
        const person = people.get(slot.id);
        totals[index] += tierScore(person);
        const kind = fit(person, slot.role).kind;
        if (kind === 'off') offRole += 1;
        if (kind === 'primary') primary += 1;
      });
    });
    return { totals, difference: Math.abs(totals[0] - totals[1]), offRole, primary };
  }

  // All 5! assignments are small enough to solve exactly. Hard exclusions never
  // become a soft penalty; an impossible team has no assignment candidates.
  function bestAssignments(people) {
    let bestCost = Infinity;
    const assignments = [];
    const occupied = new Set();
    const slots = [];
    function visit(roleIndex, cost) {
      if (cost > bestCost) return;
      if (roleIndex === ROLES.length) {
        if (cost < bestCost) { bestCost = cost; assignments.length = 0; }
        assignments.push(slots.map(function (slot) { return { id: slot.id, role: slot.role }; }));
        return;
      }
      const role = ROLES[roleIndex].id;
      people.forEach(function (person) {
        if (occupied.has(person.id)) return;
        const preference = fit(person, role);
        if (!Number.isFinite(preference.cost)) return;
        occupied.add(person.id);
        slots.push({ id: person.id, role });
        visit(roleIndex + 1, cost + preference.cost);
        slots.pop();
        occupied.delete(person.id);
      });
    }
    visit(0, 0);
    return { cost: bestCost, assignments };
  }

  function signature(team) {
    if (!Array.isArray(team)) return null;
    return team.map(function (slot) {
      return isRecord(slot) ? String(slot.role) + ':' + String(slot.id) : '';
    }).sort().join('|');
  }

  function readTeams(draw) {
    const teams = Array.isArray(draw) ? draw : draw && draw.teams;
    return Array.isArray(teams) && teams.length === 2 && teams.every(Array.isArray) ? teams : null;
  }

  function pairKeys(draw) {
    const keys = new Set();
    const teams = readTeams(draw);
    if (!teams) return keys;
    teams.forEach(function (team) {
      const ids = team.filter(function (slot) { return isRecord(slot) && typeof slot.id === 'string'; }).map(function (slot) { return slot.id; }).sort();
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) keys.add(JSON.stringify([ids[i], ids[j]]));
      }
    });
    return keys;
  }

  // Team-side changes do not disguise repeated teammates; all 20 unordered
  // same-team pairs are compared with the previous draw.
  function repeatPairs(draw, previous) {
    const before = pairKeys(previous);
    let total = 0;
    pairKeys(draw).forEach(function (key) { if (before.has(key)) total += 1; });
    return total;
  }

  function makeCandidates(roster, mode = 'balanced', previous = null, options, count = 3) {
    const active = checkRoster(roster, true);
    const constraints = normalizeShuffleOptions(options, roster);
    if (!modes.has(mode)) fail('지원하지 않는 편성 방식입니다.');
    if (!Number.isSafeInteger(count) || count < 1 || count > 10) fail('편성 후보 수는 1개부터 10개까지 선택해주세요.');
    const captains = CAPTAINS.map(function (id) { return active.find(function (person) { return person.id === id; }); });
    const pool = constraints.captainsLocked ? active.filter(function (person) { return !CAPTAINS.includes(person.id); }) : active;
    const selectedCount = constraints.captainsLocked ? 4 : 5;
    const previousTeams = readTeams(previous);
    const previousSignatures = previousTeams ? previousTeams.map(signature) : [null, null];
    const assignmentCache = new Map();
    const candidates = [];
    function assignmentsFor(people) {
      const key = JSON.stringify(people.map(function (person) { return person.id; }).sort());
      if (!assignmentCache.has(key)) assignmentCache.set(key, bestAssignments(people));
      return assignmentCache.get(key);
    }
    function visit(start, selected) {
      if (selected.length === selectedCount) {
        const selectedIds = new Set(selected.map(function (person) { return person.id; }));
        const remaining = pool.filter(function (person) { return !selectedIds.has(person.id); });
        const people = constraints.captainsLocked ? [[captains[0]].concat(selected), [captains[1]].concat(remaining)] : [selected.slice(), remaining];
        const memberships = people.map(function (team) { return new Set(team.map(function (person) { return person.id; })); });
        if (constraints.separatePairs.some(function (pair) { return memberships.some(function (team) { return team.has(pair[0]) && team.has(pair[1]); }); })) return;
        const assignments = people.map(assignmentsFor);
        if (assignments.some(function (option) { return option.assignments.length === 0; })) return;
        const totals = people.map(function (team) { return team.reduce(function (sum, person) { return sum + tierScore(person); }, 0); });
        const score = Math.abs(totals[0] - totals[1]) * 6 + assignments[0].cost + assignments[1].cost;
        const previousIndexes = assignments.map(function (option, i) { return option.assignments.findIndex(function (team) { return signature(team) === previousSignatures[i]; }); });
        const total = assignments[0].assignments.length * assignments[1].assignments.length;
        const forbidden = constraints.avoidRepeat && previousIndexes.every(function (index) { return index >= 0; }) ? previousIndexes[0] * assignments[1].assignments.length + previousIndexes[1] : -1;
        const membershipKey = JSON.stringify(people.map(function (team) { return team.map(function (person) { return person.id; }).sort(); }).sort(function (a, b) { return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1; }));
        candidates.push({ assignments, score, total, forbidden, available: total - (forbidden >= 0 ? 1 : 0), membershipKey, repeats: repeatPairs(people, previousTeams) });
        return;
      }
      for (let i = start; i <= pool.length - (selectedCount - selected.length); i += 1) {
        selected.push(pool[i]);
        visit(i + 1, selected);
        selected.pop();
      }
    }
    visit(0, []);
    if (candidates.length === 0) fail('선수 분리·제외 라인 조건을 만족하는 5 대 5 팀을 만들 수 없습니다. 조건을 확인해주세요.');
    // Assignment work is shared by all candidates. Mirrored teams count as the
    // same candidate so the preview contains genuinely different teammates.
    let eligible = candidates.filter(function (candidate) { return candidate.available > 0; });
    if (eligible.length === 0) eligible = candidates.slice();
    if (mode === 'balanced') {
      const bestScore = Math.min.apply(null, eligible.map(function (candidate) { return candidate.score; }));
      // Repetition is only a secondary preference within this small original
      // balance tolerance; it never outweighs the tier/role objective.
      eligible = eligible.filter(function (candidate) { return candidate.score <= bestScore + 2; });
    }
    const results = [];
    while (eligible.length && results.length < count) {
      let preferred = eligible;
      if (constraints.avoidRepeat && previousTeams) {
        const fewest = Math.min.apply(null, eligible.map(function (candidate) { return candidate.repeats; }));
        preferred = eligible.filter(function (candidate) { return candidate.repeats === fewest; });
      }
      const chosen = preferred[randomInt(preferred.length)];
      let index = chosen.available > 0 ? randomInt(chosen.available) : 0;
      if (chosen.available > 0 && chosen.forbidden >= 0 && index >= chosen.forbidden) index += 1;
      const secondLength = chosen.assignments[1].assignments.length;
      const teams = [chosen.assignments[0].assignments[Math.floor(index / secondLength)], chosen.assignments[1].assignments[index % secondLength]].map(function (team) { return team.map(function (slot) { return { id: slot.id, role: slot.role }; }); });
      results.push({ teams, metrics: summarize(teams, roster, constraints), createdAt: new Date().toISOString(), mode, constraints: normalizeShuffleOptions(constraints) });
      eligible = eligible.filter(function (candidate) { return candidate.membershipKey !== chosen.membershipKey; });
    }
    return results;
  }

  function makeTeams(roster, mode = 'balanced', previous = null, options) {
    return makeCandidates(roster, mode, previous, options, 1)[0];
  }

  function seriesStatus(bestOf, results) {
    if (!allowedBestOf.has(bestOf)) fail('경기 방식은 단판, 3판 2선승, 5판 3선승, 7판 4선승 중 선택해주세요.');
    if (!Array.isArray(results) || results.length > bestOf) fail('경기 결과가 올바르지 않습니다.');
    const wins = [0, 0];
    const target = Math.floor(bestOf / 2) + 1;
    let winner = null;
    Array.from(results).forEach(function (team) {
      if (team !== 0 && team !== 1) fail('승리 팀이 올바르지 않습니다.');
      if (winner !== null) fail('시리즈 종료 후에는 승리를 추가할 수 없습니다.');
      wins[team] += 1;
      if (wins[team] === target) winner = team;
    });
    const complete = winner !== null;
    return { wins, target, winner, nextGame: complete ? null : results.length + 1, complete };
  }

  function createDefaultState() {
    return {
      version: 1,
      roster: DEFAULT_ROSTER.map(function (person) { return { ...person, secondary: person.secondary.slice(), excluded: person.excluded.slice(), nicknameAliases: person.nicknameAliases.slice() }; }),
      mode: 'balanced',
      shuffleOptions: normalizeShuffleOptions(),
      bestOf: 3,
      draw: null,
      results: [],
      drawNumber: 0
    };
  }

  function validateState(state) {
    try {
      if (!isRecord(state) || state.version !== 1 || !modes.has(state.mode) || !Number.isSafeInteger(state.drawNumber) || state.drawNumber < 0) return false;
      checkRoster(state.roster, true);
      if (state.shuffleOptions !== undefined) normalizeShuffleOptions(state.shuffleOptions, state.roster);
      seriesStatus(state.bestOf, state.results);
      if (state.draw === null) return state.results.length === 0;
      if (!isRecord(state.draw) || !modes.has(state.draw.mode) || !isText(state.draw.createdAt, 40) || !Number.isFinite(Date.parse(state.draw.createdAt)) || new Date(state.draw.createdAt).toISOString() !== state.draw.createdAt || state.drawNumber < 1) return false;
      const metrics = summarize(state.draw.teams, state.roster, state.draw.constraints);
      const stored = state.draw.metrics;
      if (!isRecord(stored) || !Array.isArray(stored.totals) || stored.totals.length !== 2 || stored.totals.some(function (total, index) { return total !== metrics.totals[index]; })) return false;
      return stored.difference === metrics.difference && stored.offRole === metrics.offRole && stored.primary === metrics.primary;
    } catch (_error) {
      return false;
    }
  }

  const api = Object.freeze({ ROLES, TIERS, CAPTAINS, TEAM_NAMES, DEFAULT_ROSTER, fit, tierScore, normalizeNickname, normalizeShuffleOptions, summarize, repeatPairs, makeTeams, makeCandidates, seriesStatus, createDefaultState, validateState });
  root.LoLCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
