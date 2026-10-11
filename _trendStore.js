const ACCESS = 'private';

function pathname(season, week) {
  return `trend/${season}/week-${week}.json`;
}

async function blobSdk() {
  return import('@vercel/blob');
}

async function readJson(season, week) {
  const { get } = await blobSdk();
  const result = await get(pathname(season, week), { access: ACCESS, useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return [];
  const text = await new Response(result.stream).text();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeJson(season, week, snapshots) {
  const { put } = await blobSdk();
  return put(pathname(season, week), JSON.stringify(snapshots), {
    access: ACCESS,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60
  });
}

module.exports = { readJson, writeJson, pathname };
