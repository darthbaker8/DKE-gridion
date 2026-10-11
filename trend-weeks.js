async function blobSdk() {
  return import('@vercel/blob');
}

module.exports = async (req, res) => {
  try {
    const { list } = await blobSdk();
    const items = [];
    let cursor;
    do {
      const page = await list({ prefix: 'trend/', cursor, limit: 1000 });
      for (const b of page.blobs || []) {
        const m = /^trend\/(\d{4})\/week-(\d+)\.json$/.exec(b.pathname || '');
        if (!m) continue;
        items.push({
          season: Number(m[1]),
          week: Number(m[2]),
          uploadedAt: b.uploadedAt || null,
          size: Number(b.size || 0)
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    items.sort((a,b) => b.season-a.season || b.week-a.week);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ weeks: items });
  } catch (err) {
    const msg = String(err?.message || err);
    const storageHint = /BLOB|blob|token|store/i.test(msg)
      ? ' Create a Vercel Blob store connected to this project.'
      : '';
    return res.status(500).json({ error: 'Unable to list trend history', detail: msg + storageHint });
  }
};
