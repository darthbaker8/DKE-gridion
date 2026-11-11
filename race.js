// Historical playoff race comparison for DKE Gridiron.
// Uses completed weekly ESPN scores to reconstruct the standings at the end of each week.
// Prior seasons: original H2H results or retrospective top-five wins.
// 2026: top-five wins, with manager-adjusted ESPN records preferred for the latest completed week.
const LEAGUE_ID = '69403';
const CURRENT_YEAR = 2026;
const YEARS = [2021, 2022, 2023, 2024, 2025, CURRENT_YEAR];

async function fetchSeason(year) {
  const u = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${LEAGUE_ID}`);
  for (const view of ['mTeam', 'mStandings', 'mSettings', 'mSchedule']) u.searchParams.append('view', view);
  const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`ESPN ${year}: HTTP ${r.status}`);
  return r.json();
}

function displayName(team, membersById) {
  const ids = Array.isArray(team.owners) ? team.owners : [];
  const found = ids.map(id => {
    const m = membersById.get(String(id));
    if (!m) return '';
    return [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.displayName || '';
  }).filter(Boolean);
  return found.join(' + ') || team.name || [team.location, team.nickname].filter(Boolean).join(' ') || `Team ${team.id}`;
}
function rawPoints(side) {
  if (!side || side.teamId == null || side.totalPoints == null) return null;
  const pts = Number(side.totalPoints);
  return Number.isFinite(pts) ? pts : null;
}

// Actual end-of-season results: badges remain attached to the team when the
// slider replays an earlier week. Never infer these from the week-N standings.
// Exactly four badges are shown: champion, runner-up, and the two other top-4
// finishers (semifinalists), not every possible consolation-bracket participant.
function completedPlayoffResult(match) {
  const home = Number(match?.home?.teamId), away = Number(match?.away?.teamId);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home <= 0 || away <= 0 || home === away) return null;
  const w = String(match?.winner || '').toUpperCase();
  if (w !== 'HOME' && w !== 'AWAY') return null; // Never infer a winner from incomplete scores.
  return {week: Number(match?.matchupPeriodId), home, away, winner:w === 'HOME' ? home : away, loser:w === 'HOME' ? away : home};
}
function extractPlayoffFinishes(data, year, regularWeeks, playoffTeams, ids) {
  const teams = Array.isArray(data.teams) ? data.teams : [];
  // ESPN's final ranking is the authoritative historical result (including
  // manually adjusted championships). Do not use projected playoff seeds.
  if (year < CURRENT_YEAR) {
    for (const field of ['rankFinal', 'rankCalculatedFinal']) {
      const byRank = new Map();
      for (const t of teams) {
        const rank = Number(t?.[field]);
        if (!Number.isInteger(rank) || rank < 1 || rank > 4) continue;
        if (!byRank.has(rank)) byRank.set(rank, []);
        byRank.get(rank).push(Number(t.id));
      }
      if ([1,2,3,4].every(rank=>byRank.get(rank)?.length===1 && ids.has(byRank.get(rank)[0]))) {
        return {finishes: Object.fromEntries([1,2,3,4].map((rank)=>[String(byRank.get(rank)[0]),rank===1?'winner':rank===2?'runnerUp':'playoff'])),source:field};
      }
    }
  }

  // Fallback for four-team brackets when official final rankings are missing.
  // A completed championship must follow a completed semifinal round. This
  // also prevents the active 2026 season being awarded badges prematurely.
  if (playoffTeams !== 4) return {finishes:{},source:'not-complete'};
  const eligible = new Set(teams.filter(t=>Number(t.playoffSeed)>=1 && Number(t.playoffSeed)<=4).map(t=>Number(t.id)));
  const games = (data.schedule||[]).filter(m=>Number(m?.matchupPeriodId)>regularWeeks).map(m=>({
    tier:String(m.playoffTierType||'').toUpperCase(),result:completedPlayoffResult(m)
  })).filter(m=>m.result && ids.has(m.result.home) && ids.has(m.result.away));
  const winners = games.filter(m=>m.tier==='WINNERS_BRACKET' || (!m.tier && eligible.has(m.result.home) && eligible.has(m.result.away)))
    .map(m=>m.result).sort((a,b)=>a.week-b.week);
  const rounds = [...new Set(winners.map(g=>g.week))].sort((a,b)=>a-b);
  if (rounds.length<2)return {finishes:{},source:'not-complete'};
  const semiWeek=rounds[rounds.length-2], finalWeek=rounds[rounds.length-1];
  const semis=winners.filter(g=>g.week===semiWeek);
  const finals=winners.filter(g=>g.week===finalWeek);
  if (semis.length!==2 || new Set(semis.flatMap(g=>[g.home,g.away])).size!==4) return {finishes:{},source:'not-complete'};
  const finalists=new Set(semis.map(g=>g.winner));
  const titleGames=finals.filter(g=>finalists.has(g.home)&&finalists.has(g.away));
  if (titleGames.length!==1)return {finishes:{},source:'not-complete'};
  const title=titleGames[0];
  const other=semis.map(g=>g.loser);
  const finishing=[title.winner,title.loser,...other];
  if (new Set(finishing).size!==4)return {finishes:{},source:'not-complete'};
  return {finishes:Object.fromEntries(finishing.map((id,i)=>[String(id),i===0?'winner':i===1?'runnerUp':'playoff'])),source:'completed-bracket'};
}

function standingsAtWeek(data, year) {
  const teams = Array.isArray(data.teams) ? data.teams : [];
  if (!teams.length) throw new Error('No ESPN teams returned');
  const members = new Map((data.members || []).map(m => [String(m.id), m]));
  const descriptors = teams.map(t => ({
    id: Number(t.id),
    name: displayName(t, members),
    teamName: t.name || `Team ${t.id}`,
    record: t.record?.overall || {}
  })).filter(t => Number.isFinite(t.id));
  const ids = new Set(descriptors.map(t => t.id));
  const scheduleSettings = data.settings?.scheduleSettings || {};
  const regularWeeks = Number(scheduleSettings.matchupPeriodCount || 14);
  const playoffTeams = Number(scheduleSettings.playoffTeamCount || 0) || null;
  if (!Number.isInteger(regularWeeks) || regularWeeks < 1 || regularWeeks > 25) throw new Error('Invalid regular season length');

  // ESPN's currentScoringPeriod advances as a new week begins. A commissioner can
  // manually adjust current overall records; count those only if they are a full week.
  const statusWeek = Number(data.status?.currentScoringPeriod || data.scoringPeriodId || data.status?.currentMatchupPeriod || 1);
  const completedByStatus = Math.max(0, Math.min(regularWeeks, statusWeek - 1));
  const gamesPlayed = descriptors.map(t => Number(t.record.wins || 0) + Number(t.record.losses || 0) + Number(t.record.ties || 0));
  const allHaveSameGames = gamesPlayed.length > 0 && gamesPlayed.every(n => Number.isInteger(n) && n === gamesPlayed[0]);
  // In a completed season, the ESPN current scoring period can be frozen at the final week.
  const completedFromRecords = allHaveSameGames ? gamesPlayed[0] : 0;
  const completedWeeks = year === CURRENT_YEAR
    ? Math.min(regularWeeks, Math.max(completedByStatus, completedFromRecords))
    : regularWeeks;

  const weeklyScores = new Map();
  const weeklyMatchups = new Map();
  const allRegularMatchups = new Map();
  for (const match of (data.schedule || [])) {
    const week = Number(match.matchupPeriodId ?? match.scoringPeriodId);
    if (!Number.isInteger(week) || week < 1 || week > regularWeeks) continue;
    const home = match.home, away = match.away;
    // Matchup pairings are known ahead of time; including only IDs avoids leaking
    // future scores into the playoff-chance model for prior seasons.
    if (ids.has(Number(home?.teamId)) && ids.has(Number(away?.teamId))) {
      if (!allRegularMatchups.has(week)) allRegularMatchups.set(week, []);
      const pair = {homeId:Number(home.teamId),awayId:Number(away.teamId)};
      const key = [pair.homeId,pair.awayId].sort((a,b)=>a-b).join('-');
      if (!allRegularMatchups.get(week).some(m=>[m.homeId,m.awayId].sort((a,b)=>a-b).join('-')===key)) allRegularMatchups.get(week).push(pair);
    }
    if (week > completedWeeks) continue;
    if (!weeklyScores.has(week)) weeklyScores.set(week, new Map());
    if (!weeklyMatchups.has(week)) weeklyMatchups.set(week, []);
    for (const side of [home, away]) {
      const id = Number(side?.teamId), pts = rawPoints(side);
      if (ids.has(id) && pts !== null) weeklyScores.get(week).set(id, pts);
    }
    if (ids.has(Number(home?.teamId)) && ids.has(Number(away?.teamId))) {
      weeklyMatchups.get(week).push({ homeId: Number(home.teamId), awayId: Number(away.teamId),
        homePts: rawPoints(home), awayPts: rawPoints(away), winner: String(match.winner || '').toUpperCase() });
    }
  }

  const running = new Map(descriptors.map(t => [t.id, { winsH2h: 0, winsTop5: 0, points: 0 }]));
  const snapshots = {};
  const incompleteWeeks = [];
  for (let week = 1; week <= completedWeeks; week++) {
    const weekMap = weeklyScores.get(week);
    // Never present partial weeks as valid standings, especially for this season.
    if (!weekMap || descriptors.some(t => !weekMap.has(t.id))) { incompleteWeeks.push(week); continue; }
    const sorted = [...weekMap].map(([id, points]) => ({ id, points }))
      .sort((a, b) => b.points - a.points || a.id - b.id);
    const winningSpots = Math.ceil(descriptors.length / 2);
    // Award fraction of the last spot for ties crossing the top-five cutoff.
    let pos = 0;
    while (pos < sorted.length) {
      let end = pos + 1;
      while (end < sorted.length && sorted[end].points === sorted[pos].points) end++;
      const spots = Math.max(0, Math.min(end, winningSpots) - pos);
      const credit = spots / (end - pos);
      for (let k = pos; k < end; k++) running.get(sorted[k].id).winsTop5 += credit;
      pos = end;
    }
    for (const row of sorted) running.get(row.id).points += row.points;
    for (const match of weeklyMatchups.get(week) || []) {
      const h = running.get(match.homeId), a = running.get(match.awayId);
      if (!h || !a) continue;
      const winner = match.winner;
      if (winner === 'HOME') h.winsH2h += 1;
      else if (winner === 'AWAY') a.winsH2h += 1;
      else if (winner === 'TIE') { h.winsH2h += 0.5; a.winsH2h += 0.5; }
      else if (match.homePts !== null && match.awayPts !== null) {
        if (match.homePts > match.awayPts) h.winsH2h += 1;
        else if (match.awayPts > match.homePts) a.winsH2h += 1;
        else { h.winsH2h += 0.5; a.winsH2h += 0.5; }
      }
    }
    const original = descriptors.map(t => ({
      teamId: t.id, name: t.name, teamName: t.teamName,
      wins: running.get(t.id).winsH2h, points: running.get(t.id).points, source: 'weekly'
    }));
    const normalized = descriptors.map(t => ({
      teamId: t.id, name: t.name, teamName: t.teamName,
      wins: running.get(t.id).winsTop5, points: running.get(t.id).points, source: 'weekly'
    }));
    let asPlayed = year === CURRENT_YEAR ? normalized.map(r => ({ ...r })) : original;
    // Trust the commissioner-adjusted ESPN standings at the latest completed week,
    // but not if records haven't been fully updated yet (or include future weeks).
    if (year === CURRENT_YEAR && week === completedWeeks && allHaveSameGames && completedFromRecords === week) {
      asPlayed = asPlayed.map(row => {
        const record = descriptors.find(t => t.id === row.teamId).record;
        return { ...row, wins: Number(record.wins || 0) + Number(record.ties || 0) * 0.5, source: 'ESPN adjusted record' };
      });
    }
    const byRank = (a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name);
    snapshots[String(week)] = {
      week,
      asPlayed: asPlayed.sort(byRank),
      topFive: normalized.sort(byRank)
    };
  }
  const playoffResult = extractPlayoffFinishes(data, year, regularWeeks, playoffTeams, ids);
  return {
    year, regularWeeks, completedWeeks, playoffTeams, teamCount: descriptors.length,
    playoffFinishes: playoffResult.finishes, playoffFinishSource: playoffResult.source,
    availableWeeks: Object.keys(snapshots).map(Number), incompleteWeeks,
    // Important for the current season: the latest official ESPN standings can override a
    // reconstructed top-five snapshot only when all games in that week are reflected.
    hasOfficialLatest: year === CURRENT_YEAR && allHaveSameGames && completedFromRecords === completedWeeks,
    // Pairings only, used to simulate unfinished head-to-head seasons without
    // peeking at any later recorded results.
    matchupsByWeek: Object.fromEntries(allRegularMatchups),
    snapshots
  };
}

async function handler(req, res) {
  const settled = await Promise.all(YEARS.map(async year => {
    try { return { year, ok: true, value: standingsAtWeek(await fetchSeason(year), year) }; }
    catch (err) { return { year, ok: false, error: String(err?.message || err) }; }
  }));
  const seasons = Object.fromEntries(settled.filter(x => x.ok).map(x => [x.year, x.value]));
  if (!Object.keys(seasons).length) return res.status(502).json({ error: 'ESPN standings unavailable', unavailableYears: settled.map(x => x.year) });
  const current = seasons[CURRENT_YEAR];
  const maxWeek = current?.availableWeeks?.length
    ? Math.max(...current.availableWeeks)
    : Math.max(0, ...Object.values(seasons).flatMap(s => s.availableWeeks));
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  return res.status(200).json({ leagueId: LEAGUE_ID, years: YEARS, currentYear: CURRENT_YEAR,
    maxWeek, seasons, unavailableYears: settled.filter(x => !x.ok).map(x => ({ year: x.year, error: x.error })),
    updatedAt: new Date().toISOString() });
}
handler.standingsAtWeek = standingsAtWeek;
handler.extractPlayoffFinishes = extractPlayoffFinishes;
module.exports = handler;
