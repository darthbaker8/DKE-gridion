const LEAGUE_ID = '69403';
const YEARS = [2021, 2022, 2023, 2024, 2025];

async function getJson(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });
  if (!r.ok) {
    const err = new Error(`ESPN returned ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function endpoint(year) {
  const u = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${LEAGUE_ID}`);
  u.searchParams.append('view', 'mTeam');
  u.searchParams.append('view', 'mStandings');
  u.searchParams.append('view', 'mSettings');
  u.searchParams.append('view', 'mSchedule');
  return u.toString();
}

function teamName(t) {
  return t?.name || [t?.location, t?.nickname].filter(Boolean).join(' ') || t?.abbrev || `Team ${t?.id ?? ''}`;
}

function ownerInfo(t, membersById) {
  const ids = (Array.isArray(t?.owners) ? t.owners : []).map(String);
  const names = ids.map(id => {
    const m = membersById.get(id);
    if (!m) return null;
    const full = [m.firstName, m.lastName].filter(Boolean).join(' ').trim();
    return full || m.displayName || m.name || null;
  }).filter(Boolean);
  return {
    ownerKey: ids.length ? ids.sort().join('|') : `team:${t?.id ?? teamName(t)}`,
    ownerName: names.length ? names.join(' + ') : teamName(t)
  };
}

function buildWeeklyScores(data, regularSeasonWeeks) {
  const byWeek = new Map();
  for (const m of (data?.schedule || [])) {
    const week = Number(m?.matchupPeriodId);
    if (!Number.isFinite(week) || week < 1 || week > regularSeasonWeeks) continue;
    if (!byWeek.has(week)) byWeek.set(week, new Map());
    const weekMap = byWeek.get(week);
    for (const side of ['home', 'away']) {
      const s = m?.[side];
      const teamId = Number(s?.teamId);
      const pts = Number(s?.totalPoints);
      if (Number.isFinite(teamId) && Number.isFinite(pts)) weekMap.set(teamId, pts);
    }
  }
  return byWeek;
}

// Recreates the new league rule: top half of teams in weekly points receive a win.
// Exact ties that cross the cutoff split the remaining win credit, preserving exactly
// half the league's wins per week (e.g. 2 teams tied for one final spot => 0.5 each).
function calcTopHalfWins(data, teamIds) {
  const regularSeasonWeeks = Number(data?.settings?.scheduleSettings?.matchupPeriodCount || 0);
  const winnersPerWeek = Math.ceil(teamIds.length / 2);
  const weekly = buildWeeklyScores(data, regularSeasonWeeks);
  const wins = new Map(teamIds.map(id => [Number(id), 0]));
  const points = new Map(teamIds.map(id => [Number(id), 0]));
  const weeksPlayed = new Map(teamIds.map(id => [Number(id), 0]));

  for (let week = 1; week <= regularSeasonWeeks; week++) {
    const weekMap = weekly.get(week);
    if (!weekMap) continue;
    const entries = [...weekMap.entries()]
      .filter(([teamId, pts]) => wins.has(Number(teamId)) && Number.isFinite(pts))
      .map(([teamId, pts]) => ({ teamId: Number(teamId), pts: Number(pts) }));
    if (!entries.length) continue;

    for (const e of entries) {
      points.set(e.teamId, (points.get(e.teamId) || 0) + e.pts);
      weeksPlayed.set(e.teamId, (weeksPlayed.get(e.teamId) || 0) + 1);
    }

    entries.sort((a,b) => b.pts - a.pts || a.teamId - b.teamId);
    const availableWins = Math.min(winnersPerWeek, entries.length);
    let rankStart = 0;
    while (rankStart < entries.length) {
      let rankEnd = rankStart + 1;
      while (rankEnd < entries.length && entries[rankEnd].pts === entries[rankStart].pts) rankEnd++;
      const groupSize = rankEnd - rankStart;
      const spotsBefore = Math.min(rankStart, availableWins);
      const spotsLeft = Math.max(0, availableWins - spotsBefore);
      const groupCredit = Math.min(1, spotsLeft / groupSize);
      if (groupCredit > 0) {
        for (let i = rankStart; i < rankEnd; i++) {
          const id = entries[i].teamId;
          wins.set(id, (wins.get(id) || 0) + groupCredit);
        }
      }
      rankStart = rankEnd;
    }
  }

  return { wins, points, weeksPlayed, regularSeasonWeeks };
}

function seasonRows(data, year) {
  const membersById = new Map((data?.members || []).map(m => [String(m.id), m]));
  const teams = data?.teams || [];
  const ids = teams.map(t => Number(t?.id)).filter(Number.isFinite);
  const recalced = calcTopHalfWins(data, ids);
  return teams.map(t => {
    const owner = ownerInfo(t, membersById);
    const overall = t?.record?.overall || {};
    const teamId = Number(t?.id);
    return {
      year,
      teamId,
      teamName: teamName(t),
      ownerKey: owner.ownerKey,
      ownerName: owner.ownerName,
      wins: Number(overall.wins ?? 0),
      pointsFor: Number(overall.pointsFor ?? 0),
      topHalfWins: Number(recalced.wins.get(teamId) ?? 0),
      recalcPoints: Number(recalced.points.get(teamId) ?? 0),
      weeksPlayed: Number(recalced.weeksPlayed.get(teamId) ?? 0),
      regularSeasonWeeks: recalced.regularSeasonWeeks
    };
  });
}

module.exports = async (req, res) => {
  const settled = await Promise.all(YEARS.map(async year => {
    try {
      const data = await getJson(endpoint(year));
      return { year, ok: true, rows: seasonRows(data, year) };
    } catch (err) {
      return { year, ok: false, status: err?.status || 500, error: String(err?.message || err), rows: [] };
    }
  }));

  const available = settled.filter(x => x.ok);
  if (!available.length) {
    res.status(502).json({
      error: 'ESPN historical seasons are not available publicly right now',
      leagueId: LEAGUE_ID,
      years: settled
    });
    return;
  }

  const people = new Map();
  for (const season of available) {
    for (const r of season.rows) {
      let key = r.ownerKey;
      if (key.startsWith('team:')) key = `name:${r.ownerName.toLowerCase()}`;
      if (!people.has(key)) people.set(key, { ownerKey: key, ownerName: r.ownerName, seasons: {} });
      const p = people.get(key);
      if (!p.ownerName || p.ownerName === r.teamName) p.ownerName = r.ownerName;
      p.seasons[String(r.year)] = {
        wins: r.wins,
        pointsFor: r.pointsFor,
        topHalfWins: r.topHalfWins,
        recalcPoints: r.recalcPoints,
        weeksPlayed: r.weeksPlayed,
        regularSeasonWeeks: r.regularSeasonWeeks,
        teamName: r.teamName
      };
    }
  }

  const owners = [...people.values()].map(p => {
    let totalWins = 0, totalTopHalfWins = 0, totalPoints = 0, seasonsPlayed = 0;
    for (const y of YEARS) {
      const s = p.seasons[String(y)];
      if (!s) continue;
      totalWins += Number(s.wins || 0);
      totalTopHalfWins += Number(s.topHalfWins || 0);
      totalPoints += Number(s.pointsFor || 0);
      seasonsPlayed += 1;
    }
    return { ...p, totalWins, totalTopHalfWins, winDelta: totalTopHalfWins-totalWins, totalPoints, seasonsPlayed };
  });

  const h2hOwners = [...owners].sort((a,b) => b.totalWins - a.totalWins || b.totalPoints - a.totalPoints || a.ownerName.localeCompare(b.ownerName));
  const topHalfOwners = [...owners].sort((a,b) => b.totalTopHalfWins - a.totalTopHalfWins || b.totalPoints - a.totalPoints || a.ownerName.localeCompare(b.ownerName));

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({
    leagueId: LEAGUE_ID,
    years: YEARS,
    updatedAt: new Date().toISOString(),
    unavailableYears: settled.filter(x => !x.ok).map(x => ({year:x.year,status:x.status})),
    owners: h2hOwners,
    topHalfOwners,
    methodology: {
      regularSeasonOnly: true,
      winnersPerWeek: 'top half of teams by total points',
      cutoffTieRule: 'ties crossing the cutoff split the remaining win credit evenly'
    }
  });
};
