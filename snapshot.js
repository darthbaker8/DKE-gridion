const { readJson, writeJson } = require('./_trendStore');
const { getLeaderboardData } = require('./leaderboard');

function easternWeekday(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short'
  }).format(date);
}

function isAllowedDay(date = new Date()) {
  return ['Thu', 'Sun', 'Mon'].includes(easternWeekday(date));
}


module.exports = async (req, res) => {
  try {
    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const now = new Date();
    if (!isAllowedDay(now)) {
      return res.status(200).json({ stored: false, reason: 'not an NFL fantasy game day', weekdayET: easternWeekday(now) });
    }

    // Call the leaderboard data loader directly instead of HTTP-fetching our own
    // deployment URL. Vercel Cron requests use a deployment-specific hostname,
    // which can be protected and return 401 even though the public alias works.
    const data = await getLeaderboardData();

    const live = (data.teams || []).some(t => Array.isArray(t.playersLive) && t.playersLive.length > 0);
    if (!live) {
      return res.status(200).json({ stored: false, reason: 'no active games', week: data.scoringPeriodId });
    }

    const ts = Math.floor(now.getTime() / 900000) * 900000;
    const snapshot = {
      ts,
      capturedAt: now.toISOString(),
      teams: (data.teams || []).map(t => ({
        id: Number(t.id),
        name: t.ownerName || t.name,
        projected: Number(t.projected || 0),
        current: Number(t.current || 0)
      }))
    };

    let snapshots = await readJson(data.season, data.scoringPeriodId);
    const idx = snapshots.findIndex(x => Number(x.ts) === ts);
    if (idx >= 0) snapshots[idx] = snapshot;
    else snapshots.push(snapshot);
    snapshots.sort((a, b) => Number(a.ts) - Number(b.ts));
    if (snapshots.length > 300) snapshots = snapshots.slice(-300);
    await writeJson(data.season, data.scoringPeriodId, snapshots);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      stored: true,
      season: data.season,
      week: data.scoringPeriodId,
      ts,
      snapshots: snapshots.length
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const storageHint = /BLOB|blob|token|store/i.test(msg)
      ? ' Create a Vercel Blob store connected to this project.'
      : '';
    return res.status(500).json({ error: 'Unable to store trend snapshot', detail: msg + storageHint });
  }
};
