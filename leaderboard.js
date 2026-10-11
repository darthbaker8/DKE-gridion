const LEAGUE_ID = '69403';
const SEASON = '2026';
const ESPN = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;
const NFL_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

async function getJson(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!r.ok) throw new Error(`${new URL(url).hostname} returned ${r.status}`);
  return r.json();
}

async function espn(params = []) {
  const u = new URL(ESPN);
  for (const [k, v] of params) u.searchParams.append(k, String(v));
  return getJson(u.toString());
}

async function nflWeek(scoringPeriodId) {
  const u = new URL(NFL_SCOREBOARD);
  u.searchParams.set('dates', SEASON);
  u.searchParams.set('seasontype', '2');
  u.searchParams.set('week', String(scoringPeriodId));
  u.searchParams.set('limit', '100');
  return getJson(u.toString());
}

function teamName(t) {
  return t?.name || [t?.location, t?.nickname].filter(Boolean).join(' ') || t?.abbrev || `Team ${t?.id ?? ''}`;
}

function ownerDisplayName(t, membersById) {
  const ownerIds = Array.isArray(t?.owners) ? t.owners : [];
  const names = ownerIds.map(id => {
    const m = membersById.get(String(id));
    if (!m) return null;
    const full = [m.firstName, m.lastName].filter(Boolean).join(' ').trim();
    return full || m.displayName || m.name || null;
  }).filter(Boolean);
  if (names.length) return names.join(' + ');
  return teamName(t);
}

function playerName(entry) {
  return entry?.playerPoolEntry?.player?.fullName || entry?.playerPoolEntry?.player?.name || null;
}

function isBench(entry) {
  return [20, 21].includes(Number(entry?.lineupSlotId));
}

function gameStatesFromScoreboard(board) {
  const byTeam = new Map();
  for (const event of board?.events || []) {
    const comp = event?.competitions?.[0];
    const status = comp?.status || event?.status || {};
    const type = status?.type || {};
    const completed = Boolean(type.completed) || type.state === 'post';
    const state = completed ? 'FINAL' : (type.state === 'in' ? 'LIVE' : 'UPCOMING');
    const detail = type.shortDetail || type.detail || '';
    for (const c of comp?.competitors || []) {
      const id = Number(c?.team?.id);
      if (id) byTeam.set(id, { state, detail, completed });
    }
  }
  return byTeam;
}

function remainingFromRoster(roster, gameStates) {
  const entries = roster?.entries || [];
  const left = [];
  for (const e of entries) {
    if (isBench(e)) continue;
    const p = e?.playerPoolEntry?.player;
    const n = playerName(e);
    if (!n || !p) continue;
    const proTeamId = Number(p.proTeamId);
    const game = gameStates.get(proTeamId);
    if (game && !game.completed) {
      left.push({ name: n, state: game.state });
      continue;
    }
    const gs = p?.proTeamSchedule?.gameStatus || p?.gameStatus || e?.playerPoolEntry?.status;
    const active = p?.activeGameStatus;
    const upcoming = gs === 0 || gs === 'PRE' || gs === 'SCHEDULED' || active === 0 || active === 'PRE';
    const inProgress = gs === 1 || gs === 'IN' || gs === 'IN_PROGRESS' || active === 1 || active === 'IN';
    if (upcoming || inProgress) left.push({ name: n, state: inProgress ? 'LIVE' : 'UPCOMING' });
  }
  return left;
}



const SLOT_NAMES = {
  0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 7: 'OP', 16: 'D/ST', 17: 'K',
  20: 'BE', 21: 'IR', 23: 'FLEX'
};
const POSITION_NAMES = {1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'};
const PRO_TEAM_ABBR = {
  1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',
  11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',
  21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WAS',29:'CAR',30:'JAX',
  33:'BAL',34:'HOU'
};
function playerStatTotal(entry, scoringPeriodId, statSourceId) {
  const player = entry?.playerPoolEntry?.player;
  const stats = Array.isArray(player?.stats) ? player.stats : [];
  const exact = stats.find(s => Number(s.scoringPeriodId) === Number(scoringPeriodId) && Number(s.statSourceId) === Number(statSourceId));
  if (Number.isFinite(Number(exact?.appliedTotal))) return Number(exact.appliedTotal);
  const fallback = stats.find(s => Number(s.statSourceId) === Number(statSourceId) && Number.isFinite(Number(s?.appliedTotal)));
  return Number.isFinite(Number(fallback?.appliedTotal)) ? Number(fallback.appliedTotal) : null;
}
function playerGameState(entry, gameStates) {
  const p = entry?.playerPoolEntry?.player;
  const game = gameStates.get(Number(p?.proTeamId));
  if (game) return game.state === 'UPCOMING' ? 'LATER' : game.state;
  const gs = p?.proTeamSchedule?.gameStatus ?? p?.gameStatus ?? entry?.playerPoolEntry?.status;
  const active = p?.activeGameStatus;
  if (gs === 1 || gs === 'IN' || gs === 'IN_PROGRESS' || active === 1 || active === 'IN') return 'LIVE';
  if (gs === 0 || gs === 'PRE' || gs === 'SCHEDULED' || active === 0 || active === 'PRE') return 'LATER';
  return 'FINAL';
}
function starterDetails(roster, gameStates, scoringPeriodId) {
  const entries = Array.isArray(roster?.entries) ? roster.entries : [];
  return entries.filter(e => !isBench(e)).map((e, idx) => {
    const p = e?.playerPoolEntry?.player || {};
    const actualFromEntry = Number(e?.playerPoolEntry?.appliedStatTotal);
    const actualFromStats = playerStatTotal(e, scoringPeriodId, 0);
    const projectedFromStats = playerStatTotal(e, scoringPeriodId, 1);
    const current = Number.isFinite(actualFromEntry) ? actualFromEntry : (Number.isFinite(actualFromStats) ? actualFromStats : 0);
    const projected = Number.isFinite(projectedFromStats) ? projectedFromStats : current;
    const slotId = Number(e?.lineupSlotId);
    return {
      slot: SLOT_NAMES[slotId] || POSITION_NAMES[Number(p?.defaultPositionId)] || 'FLEX',
      slotId,
      name: playerName(e) || 'Unknown player',
      proTeam: PRO_TEAM_ABBR[Number(p?.proTeamId)] || '',
      position: POSITION_NAMES[Number(p?.defaultPositionId)] || '',
      status: playerGameState(e, gameStates),
      current,
      projected,
      order: idx
    };
  });
}

function sideRows(match, teamsById, membersById, gameStates, scoringPeriodId) {
  const out = [];
  for (const key of ['home', 'away']) {
    const s = match?.[key];
    if (!s?.teamId) continue;
    const t = teamsById.get(Number(s.teamId)) || {};
    const current = Number(s.totalPointsLive ?? s.totalPoints ?? 0);
    const projected = Number(s.totalProjectedPointsLive ?? s.totalProjectedPoints ?? current);
    const roster = s.rosterForCurrentScoringPeriod || s.rosterForMatchupPeriod || t.roster;
    const remaining = remainingFromRoster(roster, gameStates);
    const players = starterDetails(roster, gameStates, scoringPeriodId);
    out.push({
      id: Number(s.teamId),
      name: teamName(t),
      ownerName: ownerDisplayName(t, membersById),
      current,
      projected,
      playersLeft: remaining.map(x => x.name),
      playersLive: remaining.filter(x => x.state === 'LIVE').map(x => x.name),
      playersUpcoming: remaining.filter(x => x.state !== 'LIVE').map(x => x.name),
      playersLeftCount: remaining.length,
      players
    });
  }
  return out;
}

async function getLeaderboardData(weekOverride) {
  const base = await espn([['view', 'mSettings'], ['view', 'mTeam']]);
  // ESPN advances scoringPeriodId automatically each fantasy week. Query ?week=N still allows manual override.
  const scoringPeriodId = Number(weekOverride || base.scoringPeriodId || base.status?.currentScoringPeriod || base.status?.currentMatchupPeriod || 1);

  const [data, board] = await Promise.all([
    espn([
      ['view', 'mScoreboard'],
      ['view', 'mMatchup'],
      ['view', 'mMatchupScore'],
      ['view', 'mTeam'],
      ['view', 'mRoster'],
      ['scoringPeriodId', scoringPeriodId]
    ]),
    nflWeek(scoringPeriodId).catch(() => ({ events: [] }))
  ]);

  const gameStates = gameStatesFromScoreboard(board);
  const sourceTeams = data.teams || base.teams || [];
  const teamsById = new Map(sourceTeams.map(t => [Number(t.id), t]));
  const members = data.members || base.members || [];
  const membersById = new Map(members.map(m => [String(m.id), m]));
  const dedupe = new Map();

  for (const m of data.schedule || []) {
    const sp = Number(m.matchupPeriodId ?? m.scoringPeriodId ?? scoringPeriodId);
    if (sp !== scoringPeriodId) continue;
    for (const row of sideRows(m, teamsById, membersById, gameStates, scoringPeriodId)) dedupe.set(row.id, row);
  }

  if (!dedupe.size) {
    for (const t of teamsById.values()) {
      const remaining = remainingFromRoster(t.roster, gameStates);
      const players = starterDetails(t.roster, gameStates, scoringPeriodId);
      dedupe.set(Number(t.id), {
        id: Number(t.id),
        name: teamName(t),
        ownerName: ownerDisplayName(t, membersById),
        current: 0,
        projected: 0,
        playersLeft: remaining.map(x => x.name),
        playersLive: remaining.filter(x => x.state === 'LIVE').map(x => x.name),
        playersUpcoming: remaining.filter(x => x.state !== 'LIVE').map(x => x.name),
        playersLeftCount: remaining.length,
      players
      });
    }
  }

  const teams = [...dedupe.values()].sort((a, b) =>
    b.projected - a.projected || b.current - a.current || a.ownerName.localeCompare(b.ownerName)
  );

  return {
    leagueId: LEAGUE_ID,
    season: Number(SEASON),
    scoringPeriodId,
    updatedAt: new Date().toISOString(),
    teams
  };
}

async function handler(req, res) {
  try {
    const result = await getLeaderboardData(req.query.week);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=15');
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Unable to load ESPN league data', detail: String(err?.message || err) });
  }
}

handler.getLeaderboardData = getLeaderboardData;
module.exports = handler;
