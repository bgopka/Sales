// POST /api/photo → set a contact's Picture from a pasted/uploaded image.
// body: { contactId, dataUrl }  where dataUrl is "data:image/png;base64,...."
// Uploads the bytes to Notion (file_uploads) and attaches them to the Picture property.
import { notion } from './_notion.js';

const TOKEN = process.env.NOTION_TOKEN;
const V = '2022-06-28';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const contactId = b.contactId || b.id;
    const dataUrl = String(b.dataUrl || '');
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'dataUrl must be a base64 data URL' });

    const contentType = m[1].toLowerCase();
    if (!EXT[contentType]) return res.status(400).json({ error: 'unsupported image type: ' + contentType });

    const bytes = Buffer.from(m[2], 'base64');
    if (!bytes.length) return res.status(400).json({ error: 'empty image' });
    if (bytes.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'image too large after resize (>4MB)' });

    const filename = (b.filename || ('photo-' + Date.now())).replace(/[^\w.-]/g, '_') + '.' + EXT[contentType];

    // 1) create the upload slot
    const up = await notion('file_uploads', {
      method: 'POST',
      body: JSON.stringify({ mode: 'single_part', filename, content_type: contentType }),
    });
    if (!up || !up.id) throw new Error('file_upload create failed');

    // 2) send the bytes (multipart — do NOT set Content-Type by hand, let fetch add the boundary)
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: contentType }), filename);
    const sendUrl = up.upload_url || ('https://api.notion.com/v1/file_uploads/' + up.id + '/send');
    const sr = await fetch(sendUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': V },
      body: form,
    });
    const st = await sr.text();
    if (!sr.ok) throw new Error('upload send failed: ' + st.slice(0, 300));

    // 3) attach to the contact's Picture property (replaces whatever was there)
    await notion('pages/' + contactId, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: { Picture: { files: [{ type: 'file_upload', name: filename, file_upload: { id: up.id } }] } },
      }),
    });

    // 4) read back the hosted URL so the client can show the stored image
    let url = '';
    try {
      const pg = await notion('pages/' + contactId);
      const f = ((pg.properties && pg.properties.Picture && pg.properties.Picture.files) || [])[0];
      url = (f && ((f.file && f.file.url) || (f.external && f.external.url))) || '';
    } catch (e) { /* non-fatal — the write already succeeded */ }

    return res.status(200).json({ ok: true, url, filename });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
