(function (root) {
  'use strict';

  const C = root.LoLCore;
  const FONT = 'Paperlogy, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const COLORS = { navy: '#00176a', blue: '#003e9c', coral: '#b95540', ink: '#18233d', muted: '#6e7d95', line: '#e0e7f1', bg: '#f3f6fb' };
  const TIER_COLORS = { unranked: '#69778b', iron: '#746675', bronze: '#966440', silver: '#64758d', gold: '#9b772e', platinum: '#357d80', emerald: '#2b8155', diamond: '#477bbd', master: '#9159aa', grandmaster: '#bb505b', challenger: '#ab842a' };
  const fail = message => { throw new Error(message); };
  const safeText = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 100) : fallback;
  const roles = new Map(C.ROLES.map(role => [role.id, role.label]));
  const tiers = new Map(C.TIERS.map(tier => [tier.id, tier.label]));

  function lineupModel(draw, roster) {
    if (!draw || !Array.isArray(roster)) fail('팀이 편성된 뒤 결과 카드를 만들 수 있습니다.');
    C.summarize(draw.teams, roster, draw.constraints);
    const people = new Map(roster.map(person => [person.id, person]));
    return draw.teams.map(team => C.ROLES.map(role => {
      const slot = team.find(member => member.role === role.id);
      const person = people.get(slot.id);
      return { id: person.id, name: safeText(person.name, '참가자'), role: role.id, roleLabel: roles.get(role.id), tier: person.tier, tierLabel: tiers.get(person.tier) };
    }));
  }
  function lineupKey(teams) { return JSON.stringify(teams); }

  function buildModel(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.results)) fail('공유할 경기 정보를 불러올 수 없습니다.');
    const status = C.seriesStatus(input.bestOf, input.results);
    const current = lineupModel(input.draw, input.roster);
    const teamNames = (Array.isArray(input.teamNames) && input.teamNames.length === 2 ? input.teamNames : C.TEAM_NAMES).map((name, index) => safeText(name, C.TEAM_NAMES[index]));
    const date = safeText(input.date || input.matchDate, '날짜 미지정');
    const isSaved = typeof input.status === 'string';
    const groups = [];
    // A recorded set must retain the exact lineup and roster used for that set.
    const games = Array.isArray(input.games) ? input.games : null;
    if (games && games.length !== input.results.length) fail('세트 결과와 라인업 수가 맞지 않습니다. 기록을 확인해주세요.');
    input.results.forEach((winner, index) => {
      const game = games && games[index];
      if (game && game.winner !== winner) fail('세트별 승리 팀이 경기 결과와 다릅니다. 기록을 확인해주세요.');
      const teams = game ? lineupModel(game.draw, input.roster) : current;
      const key = lineupKey(teams);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.sets.push(index + 1);
      else groups.push({ key, teams, sets: [index + 1], pending: false });
    });
    if (!input.results.length) groups.push({ key: lineupKey(current), teams: current, sets: [], pending: true });
    else if (!isSaved && !status.complete && groups[groups.length - 1].key !== lineupKey(current)) groups.push({ key: lineupKey(current), teams: current, sets: [], pending: true });
    const stateLabel = status.complete ? teamNames[status.winner] + ' 시리즈 승리' : isSaved && input.status === 'stopped' ? '중도 종료 · 기록된 세트 기준' : input.results.length ? '진행 중 · ' + status.nextGame + '세트 대기' : '경기 시작 전 · 편성 공유';
    const rule = input.bestOf === 1 ? '단판 · 1승' : input.bestOf + '판 ' + status.target + '선승 · BO' + input.bestOf;
    const timelineRows = input.results.length ? Math.ceil(input.results.length / 4) : 1;
    const height = 416 + 56 + timelineRows * 86 + 22 + groups.length * 460 + 86;
    return { date, teamNames, wins: status.wins.slice(), winner: status.winner, complete: status.complete, rule, stateLabel,
      results: input.results.slice(), groups, width: 1080, height,
      filename: '융합본부_내전_' + date.replace(/[^0-9-]/g, '') + '_' + status.wins.join('-') + '.png' };
  }

  function clipText(context, value, maxWidth) {
    const text = String(value);
    if (context.measureText(text).width <= maxWidth) return text;
    const chars = Array.from(text);
    while (chars.length && context.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
    return chars.join('') + '…';
  }
  function label(context, value, x, y, options) {
    const settings = options || {};
    context.font = (settings.weight || 400) + ' ' + (settings.size || 24) + 'px ' + FONT;
    context.fillStyle = settings.color || COLORS.ink;
    context.textAlign = settings.align || 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(clipText(context, value, settings.width || 968), x, y);
  }
  function rounded(context, x, y, width, height, radius, fill, stroke) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y); context.lineTo(x + width - r, y); context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r); context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height); context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath();
    context.fillStyle = fill; context.fill();
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = 1; context.stroke(); }
  }
  function line(context, x, y, x2, y2, color) {
    context.beginPath(); context.moveTo(x, y); context.lineTo(x2, y2); context.strokeStyle = color; context.lineWidth = 1; context.stroke();
  }

  function paintCard(context, model) {
    context.fillStyle = COLORS.bg; context.fillRect(0, 0, model.width, model.height);
    context.fillStyle = COLORS.navy; context.fillRect(0, 0, model.width, 382);
    context.fillStyle = '#09257e'; context.beginPath(); context.moveTo(820, 0); context.lineTo(1080, 0); context.lineTo(1080, 382); context.lineTo(580, 382); context.fill();
    label(context, 'LEAGUE OF LEGENDS · INTERNAL MATCH', 56, 58, { size: 17, color: '#a9c3f1', weight: 700 });
    label(context, '융합본부 LoL 내전', 56, 120, { size: 47, color: '#ffffff', weight: 800 });
    label(context, model.date + '   /   ' + model.rule, 56, 165, { size: 25, color: '#bdcceb' });
    label(context, model.teamNames[0], 238, 244, { size: 34, color: '#c8dcff', weight: 800, width: 340, align: 'center' });
    label(context, model.teamNames[1], 842, 244, { size: 34, color: '#f1c8bc', weight: 800, width: 340, align: 'center' });
    label(context, model.wins[0], 468, 263, { size: 82, color: '#ffffff', weight: 800, width: 106, align: 'center' });
    label(context, ':', 540, 256, { size: 55, color: '#7f9ccc', weight: 400, width: 45, align: 'center' });
    label(context, model.wins[1], 612, 263, { size: 82, color: '#ffffff', weight: 800, width: 106, align: 'center' });
    line(context, 56, 299, 1024, 299, '#3b5088');
    label(context, model.stateLabel, 56, 345, { size: 24, color: '#e6edff', weight: 700 });

    let y = 434;
    label(context, '세트별 결과', 56, y, { size: 27, weight: 800 });
    y += 27;
    if (!model.results.length) {
      rounded(context, 56, y, 968, 72, 12, '#ffffff', COLORS.line);
      label(context, '아직 기록된 경기 결과가 없습니다.', 80, y + 46, { size: 24, color: COLORS.muted });
    } else model.results.forEach((winner, index) => {
      const x = 56 + (index % 4) * 246;
      const top = y + Math.floor(index / 4) * 86;
      rounded(context, x, top, 230, 72, 12, winner === 0 ? '#e6eefb' : '#f8eae5');
      label(context, String(index + 1).padStart(2, '0'), x + 16, top + 43, { size: 23, weight: 800, color: winner === 0 ? COLORS.blue : COLORS.coral, width: 35 });
      label(context, model.teamNames[winner] + ' 승', x + 62, top + 43, { size: 23, weight: 700, color: winner === 0 ? COLORS.blue : COLORS.coral, width: 151 });
    });
    y += Math.max(1, Math.ceil(model.results.length / 4)) * 86 + 42;
    model.groups.forEach(group => {
      const first = group.sets[0], last = group.sets[group.sets.length - 1];
      const title = group.pending ? (model.results.length ? '다음 세트 예정 라인업' : '대기 라인업') : (first === last ? first + '세트' : first + '–' + last + '세트') + ' 라인업';
      label(context, title, 56, y, { size: 26, weight: 800 });
      const top = y + 23;
      group.teams.forEach((team, index) => {
        const x = index === 0 ? 56 : 556;
        const accent = index === 0 ? COLORS.blue : COLORS.coral;
        rounded(context, x, top, 468, 386, 15, '#ffffff', COLORS.line);
        rounded(context, x + 1, top + 1, 466, 55, 14, index === 0 ? '#e9f0fc' : '#faede8');
        label(context, model.teamNames[index], x + 22, top + 37, { size: 26, weight: 800, color: accent, width: 420 });
        team.forEach((person, rowIndex) => {
          const rowY = top + 58 + rowIndex * 64;
          if (rowIndex) line(context, x + 22, rowY, x + 446, rowY, '#edf0f5');
          label(context, person.roleLabel, x + 22, rowY + 41, { size: 22, color: COLORS.muted, width: 72 });
          label(context, person.name, x + 106, rowY + 41, { size: 27, weight: 700, width: 188 });
          label(context, person.tierLabel, x + 446, rowY + 40, { size: 21, weight: 700, color: TIER_COLORS[person.tier], align: 'right', width: 142 });
        });
      });
      y += 460;
    });
    line(context, 56, y - 6, 1024, y - 6, COLORS.line);
    label(context, '우리끼리, 제대로 한 판.', 56, y + 31, { size: 22, weight: 700, color: COLORS.navy });
    label(context, '융합본부 · 내전 경기 기록', 1024, y + 31, { size: 20, color: COLORS.muted, align: 'right', width: 490 });
  }

  async function createCard(input) {
    const model = buildModel(input);
    if (!root.document) fail('이미지 저장을 지원하는 브라우저에서 열어주세요.');
    if (document.fonts) {
      await Promise.all([document.fonts.load('400 24px Paperlogy'), document.fonts.load('700 24px Paperlogy'), document.fonts.load('800 24px Paperlogy')]);
      await document.fonts.ready;
    }
    const canvas = document.createElement('canvas');
    canvas.width = model.width; canvas.height = model.height;
    const context = canvas.getContext('2d');
    if (!context || typeof canvas.toBlob !== 'function') fail('이 브라우저에서 결과 이미지를 만들 수 없습니다. Safari 또는 Chrome에서 다시 열어주세요.');
    paintCard(context, model);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('이미지를 만들지 못했습니다. 다시 시도해주세요.')), 'image/png'));
    return { blob, url: URL.createObjectURL(blob), filename: model.filename, model };
  }

  let elements = null, current = null, sequence = 0, busy = false;
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function releaseCard() {
    if (current) URL.revokeObjectURL(current.url);
    current = null;
    if (elements) { elements.image.removeAttribute('src'); elements.image.hidden = true; }
  }
  function ensureModal() {
    if (elements) return elements;
    const dialog = node('dialog', 'result-card-dialog');
    dialog.id = 'resultCardDialog'; dialog.setAttribute('aria-labelledby', 'resultCardTitle');
    const heading = node('div', 'result-card-heading');
    const title = node('h2', '', '경기 결과 카드'); title.id = 'resultCardTitle';
    const close = node('button', 'icon-btn', '×'); close.type = 'button'; close.setAttribute('aria-label', '결과 카드 닫기');
    close.addEventListener('click', () => dialog.close());
    heading.append(title, close);
    const description = node('p', 'result-card-description', '날짜·시리즈 점수·세트별 결과와 당시 라인업을 한 장에 담았습니다.');
    const status = node('p', 'result-card-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const preview = node('div', 'result-card-preview');
    const image = node('img'); image.alt = '경기 결과 공유 카드'; image.hidden = true; preview.append(image);
    const actions = node('div', 'result-card-actions');
    const download = node('button', 'btn primary', 'PNG 이미지 저장'); download.type = 'button'; download.disabled = true;
    const share = node('button', 'btn', '이미지 공유'); share.type = 'button'; share.hidden = true;
    actions.append(download, share);
    const hint = node('p', 'result-card-hint', '모바일에서 저장 버튼이 작동하지 않으면 미리보기 이미지를 길게 눌러 사진에 저장하세요.');
    dialog.append(heading, description, status, preview, actions, hint); document.body.append(dialog);
    dialog.addEventListener('close', () => { sequence += 1; releaseCard(); busy = false; });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
    download.addEventListener('click', () => {
      if (!current || busy) return;
      const link = node('a'); link.href = current.url; link.download = current.filename;
      document.body.append(link); link.click(); link.remove();
      status.textContent = '저장이 시작됩니다. 모바일에서는 미리보기 이미지를 길게 눌러 저장할 수도 있습니다.';
    });
    share.addEventListener('click', async () => {
      if (!current || busy) return;
      busy = true; share.disabled = true; download.disabled = true;
      const thisCard = current;
      try {
        const file = new File([thisCard.blob], thisCard.filename, { type: 'image/png' });
        await navigator.share({ files: [file], title: '융합본부 LoL 내전 결과' });
        if (current === thisCard) status.textContent = '이미지를 공유했습니다.';
      } catch (error) {
        if (current === thisCard && error.name !== 'AbortError') status.textContent = '공유 창을 열지 못했습니다. PNG 이미지 저장 후 직접 공유해주세요.';
      } finally {
        if (current === thisCard) { busy = false; share.disabled = false; download.disabled = false; }
      }
    });
    elements = { dialog, image, status, download, share };
    return elements;
  }
  async function open(input) {
    const ui = ensureModal();
    if (busy && ui.dialog.open) return false;
    const request = ++sequence;
    releaseCard(); busy = true;
    ui.download.disabled = true; ui.share.hidden = true; ui.status.classList.remove('is-error');
    ui.status.textContent = '결과 이미지를 만들고 있습니다…';
    if (!ui.dialog.open) ui.dialog.showModal();
    try {
      const created = await createCard(input);
      if (request !== sequence || !ui.dialog.open) { URL.revokeObjectURL(created.url); return false; }
      current = created; ui.image.src = created.url; ui.image.hidden = false;
      ui.image.alt = created.model.date + ' ' + created.model.teamNames.join(' 대 ') + ' ' + created.model.wins.join(' 대 ') + ' 경기 결과';
      ui.download.disabled = false;
      if (typeof root.File === 'function' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
        try { ui.share.hidden = !navigator.canShare({ files: [new File([created.blob], created.filename, { type: 'image/png' })] }); }
        catch (_error) { ui.share.hidden = true; }
      }
      ui.share.disabled = false;
      ui.status.textContent = '공유할 이미지를 확인한 뒤 저장하거나 공유하세요.';
      return true;
    } catch (error) {
      if (request === sequence) { ui.status.classList.add('is-error'); ui.status.textContent = error.message || '결과 카드를 만들지 못했습니다. 다시 시도해주세요.'; }
      return false;
    } finally { if (request === sequence) busy = false; }
  }

  const api = Object.freeze({ open, createCard, buildModel, clipText });
  root.ResultCard = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
