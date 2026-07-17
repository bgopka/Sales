// /api/upload — true in-app file upload for sequence step template files (HTML/JPG).
// Multipart: field 'file' + 'pageId' (the sequence step). Puts file in Vercel Blob,
// then APPENDS its public URL to that step's Notion 'Attachments' files property.
// Requires BLOB_READ_WRITE_TOKEN (create a Blob store in Vercel → Storage).
import { put } from '@vercel/blob';
import { notion } from './_notion.js';

export const config = { api: { bodyParser: false } };

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(200).json({ ok: false, error: 'Blob store not configured. In Vercel → Storage → Create Blob store (adds BLOB_READ_WRITE_TOKEN).' });
  }
  try {
    const ct = req.headers['content-type'] || '';
    const m = ct.match(/boundary=(.+)$/); if (!m) return res.status(400).json({ ok: false, error: 'No multipart boundary' });
    const boundary = '--' + m[1];
    const raw = await readMultipart(req);
    // minimal multipart parse: find the file part + pageId part
    const parts = raw.toString('latin1').split(boundary).filter(p => p.includes('Content-Disposition'));
    let fileBuf = null, filename = 'upload.bin', pageId = '';
    for (const part of parts) {
      const header = part.slice(0, part.indexOf('\r\n\r\n'));
      const bodyStart = part.indexOf('\r\n\r\n') + 4;
      let body = part.slice(bodyStart);
      body = body.slice(0, body.lastIndexOf('\r\n'));
      if (/name="pageId"/.test(header)) { pageId = body.trim(); }
      else if (/name="file"/.test(header)) {
        const fn = header.match(/filename="([^"]*)"/); if (fn) filename = fn[1];
        fileBuf = Buffer.from(body, 'latin1');
      }
    }
    if (!fileBuf || !pageId) return res.status(400).json({ ok: false, error: 'file and pageId required' });

    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await put('sequence/' + Date.now() + '-' + safe, fileBuf, { access: 'public', addRandomSuffix: false });

    // read existing attachments, append, patch
    const page = await notion('pages/' + pageId, { method: 'GET' });
    const existing = ((page.properties && page.properties['Attachments'] && page.properties['Attachments'].files) || [])
      .map(f => ({ name: f.name, external: { url: (f.file && f.file.url) || (f.external && f.external.url) || '' } }))
      .filter(f => f.external.url);
    existing.push({ name: filename, external: { url: blob.url } });
    await notion('pages/' + pageId, { method: 'PATCH', body: JSON.stringify({ properties: { 'Attachments': { files: existing } } }) });

    return res.status(200).json({ ok: true, url: blob.url, name: filename });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
