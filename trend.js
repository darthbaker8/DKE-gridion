const { readJson } = require('./_trendStore');

module.exports = async (req, res) => {
  try {
    const season = Number(req.query.season || 2026);
    const week = Number(req.query.week);
    if (!Number.isFinite(week) || week < 1 || week > 25) {
      return res.status(400).json({ error: 'week query parameter is required' });
    }
    const snapshots = await readJson(season, week);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ season, week, snapshots });
  } catch (err) {
    const msg = String(err?.message || err);
    const storageHint = /BLOB|blob|token|store/i.test(msg)
      ? ' Create a Vercel Blob store connected to this project.'
      : '';
    return res.status(500).json({ error: 'Unable to load trend history', detail: msg + storageHint });
  }
};
