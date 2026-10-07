// Preserved from the sports-day team draw source.
(function (root) {
  'use strict';

  const UINT32_RANGE = 0x100000000;

  // Rejection sampling avoids modulo bias for bounds that do not divide 2^32.
  function randomInt(max) {
    if (!Number.isSafeInteger(max) || max < 1 || max > UINT32_RANGE) {
      throw new RangeError('난수 범위는 1 이상 2^32 이하의 정수여야 합니다.');
    }
    if (max === 1) return 0;
    if (!root.crypto || typeof root.crypto.getRandomValues !== 'function') {
      throw new Error('안전한 난수 생성 기능을 사용할 수 없습니다. 최신 브라우저를 사용해주세요.');
    }
    const limit = Math.floor(UINT32_RANGE / max) * max;
    const sample = new Uint32Array(1);
    do {
      root.crypto.getRandomValues(sample);
    } while (sample[0] >= limit);
    return sample[0] % max;
  }

  function shuffle(array) {
    if (!Array.isArray(array)) throw new TypeError('섞을 대상은 배열이어야 합니다.');
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function validate(participants, teamCount, mode) {
    if (!Array.isArray(participants) || participants.length === 0) {
      throw new RangeError('참가자를 한 명 이상 선택해주세요.');
    }
    if (!Number.isSafeInteger(teamCount) || teamCount < 1 || teamCount > participants.length) {
      throw new RangeError('팀 수는 1 이상 참가자 수 이하의 정수여야 합니다.');
    }
    if (mode !== 'random' && mode !== 'balanced') {
      throw new RangeError('지원하지 않는 팀 편성 방식입니다.');
    }
    const ids = new Set();
    participants.forEach(function (person) {
      const id = person && person.id;
      const validId = (typeof id === 'string' && id.trim().length > 0) ||
        (typeof id === 'number' && Number.isFinite(id));
      if (!person || typeof person !== 'object' || !validId) {
        throw new TypeError('각 참가자에게 유효한 고유 ID가 필요합니다.');
      }
      if (ids.has(id)) throw new RangeError('참가자 ID가 중복되었습니다.');
      ids.add(id);
    });
  }

  function makeQuotas(participantCount, teamCount) {
    const quotas = Array(teamCount).fill(Math.floor(participantCount / teamCount));
    const remainder = participantCount % teamCount;
    if (remainder > 0) {
      const slots = shuffle(Array.from({ length: teamCount }, function (_, i) { return i; }));
      slots.slice(0, remainder).forEach(function (index) { quotas[index] += 1; });
    }
    return quotas;
  }

  function makeBalancedTeams(participants, quotas) {
    const teams = quotas.map(function () { return []; });
    const rankCounts = quotas.map(function () { return new Map(); });
    const groupCounts = quotas.map(function () { return new Map(); });
    const byRank = new Map();
    participants.forEach(function (person) {
      if (!byRank.has(person.rank)) byRank.set(person.rank, []);
      byRank.get(person.rank).push(person);
    });

    // Larger rank categories are placed first. Equal-size categories retain
    // their shuffled order; this comparator contains no random operations.
    const rankBuckets = shuffle(Array.from(byRank.values()));
    rankBuckets.sort(function (a, b) { return b.length - a.length; });
    rankBuckets.forEach(function (bucket) {
      shuffle(bucket).forEach(function (person) {
        let best = null;
        let tied = [];
        teams.forEach(function (team, index) {
          if (team.length >= quotas[index]) return;
          const score = {
            rank: rankCounts[index].get(person.rank) || 0,
            group: groupCounts[index].get(person.group) || 0,
            used: team.length,
            quota: quotas[index]
          };
          const comparison = best === null ? -1 :
            score.rank - best.rank || score.group - best.group ||
            score.used * best.quota - best.used * score.quota;
          if (comparison < 0) {
            best = score;
            tied = [index];
          } else if (comparison === 0) {
            tied.push(index);
          }
        });
        const selected = tied[randomInt(tied.length)];
        teams[selected].push(person);
        rankCounts[selected].set(person.rank, (rankCounts[selected].get(person.rank) || 0) + 1);
        groupCounts[selected].set(person.group, (groupCounts[selected].get(person.group) || 0) + 1);
      });
    });
    return teams;
  }

  function makeTeams(participants, teamCount, mode = 'random') {
    validate(participants, teamCount, mode);
    const quotas = makeQuotas(participants.length, teamCount);
    if (mode === 'balanced') return makeBalancedTeams(participants, quotas);
    const pool = shuffle(participants);
    let offset = 0;
    return quotas.map(function (quota) {
      const team = pool.slice(offset, offset + quota);
      offset += quota;
      return team;
    });
  }

  root.TeamDrawCore = Object.freeze({ randomInt, shuffle, makeTeams });
})(globalThis);
