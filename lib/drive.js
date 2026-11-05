// Screenshots live in a subfolder of FOLDER_ID: "Indosat Micro Receptionist Test Tracker — screenshots".
import { google, env, GoogleError } from './google.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_NAME = 'Indosat Micro Receptionist Test Tracker — screenshots';
const ALL_DRIVES = 'supportsAllDrives=true';

let shotsFolderId = null; // reused while the function instance stays warm

async function shotsFolder() {
  if (shotsFolderId) return shotsFolderId;
  const parent = env('FOLDER_ID');
  const q = `'${parent}' in parents and name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await google('GET', FILES + '?' + new URLSearchParams({ q, fields: 'files(id)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }));
  if (found.files && found.files.length) return (shotsFolderId = found.files[0].id);
  const made = await google('POST', FILES + '?fields=id&' + ALL_DRIVES,
    { json: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [parent] } });
  return (shotsFolderId = made.id);
}

// Only files inside the screenshots folder can be read or removed through the tracker.
async function checkInFolder(id) {
  const [meta, folder] = await Promise.all([
    google('GET', FILES + '/' + encodeURIComponent(id) + '?fields=parents,mimeType&' + ALL_DRIVES),
    shotsFolder(),
  ]);
  if (!(meta.parents || []).includes(folder)) throw new GoogleError('Not a tracker screenshot', 404);
  return meta;
}

// → { id, name }
export async function uploadImage({ name, code, mimeType, data }) {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '');
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const fname = [name.trim(), code, stamp].join(' — ') + '.' + ext;
  const boundary = 'ea' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fname, parents: [await shotsFolder()] })}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.from(data, 'base64'),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return google('POST', UPLOAD + '?uploadType=multipart&fields=id,name&' + ALL_DRIVES,
    { body, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary } });
}

// → { mimeType, bytes: Buffer }
export async function readImage(id) {
  const meta = await checkInFolder(id);
  const res = await google('GET', FILES + '/' + encodeURIComponent(id) + '?alt=media&' + ALL_DRIVES, { raw: true });
  return { mimeType: meta.mimeType, bytes: Buffer.from(await res.arrayBuffer()) };
}

export async function trashImage(id) {
  await checkInFolder(id);
  await google('PATCH', FILES + '/' + encodeURIComponent(id) + '?' + ALL_DRIVES, { json: { trashed: true } });
}
