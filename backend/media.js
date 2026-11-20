import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db, rows, fail, sign, verify, moderate } from './core.js';

export const imageLimit = 8 * 1024 * 1024;
const directory = process.env.MEDIA_DIR || 'media';
const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const keyPattern = /^([1-9]\d{0,19})\/([1-9]\d{0,19})\/(\d{20})\/([a-f0-9-]{36})\.(jpg|png|gif|webp)$/;
const types = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function imageExtension(bytes) {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpg';
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function epoch(joinedAt) {
  const [seconds, micros = ''] = joinedAt.split('.');
  return seconds.replace(/\D/g, '') + micros.padEnd(6, '0');
}

export async function saveUpload(userId, roomId, joinedAt, bytes, contentType) {
  const ext = Buffer.isBuffer(bytes) && imageExtension(bytes);
  const mime = types[ext];
  if (!mime || mime !== contentType?.split(';')[0].trim().toLowerCase()) fail(415, 'Expected a supported raster image');
  await moderate('image', { mime, bytes });
  const prefix = `${roomId}/${userId}/${epoch(joinedAt)}`;
  const key = `${prefix}/${randomUUID()}.${ext}`;
  await mkdir(join(directory, prefix), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, key), bytes, { flag: 'wx', mode: 0o600 });
  return { media_key: key };
}

async function fileInfo(key) {
  try {
    const info = await stat(join(directory, key));
    if (info.isFile()) return info;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return null;
}

export async function checkUpload(userId, roomId, joinedAt, key) {
  const parts = keyPattern.exec(key);
  if (!parts || parts[1] !== roomId || parts[2] !== userId || parts[3] !== epoch(joinedAt) || !await fileInfo(key)) {
    fail(400, 'Invalid image upload for this membership');
  }
}

export function mediaUrl(userId, roomId, seq, joinedAt) {
  const token = sign('image', { userId, roomId, seq, joinedAt }, 900);
  return `${baseUrl}/api/media/${token}`;
}

export async function readMedia(token, reply) {
  const { userId, roomId, seq, joinedAt } = verify('image', token);
  const [visible] = await rows(db, `SELECT x.media_key FROM room_messages x
    JOIN rooms r ON r.id = x.room_id AND r.status = 'open'
    JOIN room_members m ON m.room_id = r.id AND m.user_id = CAST(? AS UNSIGNED)
      AND m.left_at IS NULL AND x.seq > m.joined_seq AND m.joined_at = ?
    LEFT JOIN user_blocks b ON b.user_id = m.user_id AND b.blocked_user_id = x.sender_id
    WHERE x.room_id = CAST(? AS UNSIGNED) AND x.seq = CAST(? AS UNSIGNED)
      AND x.kind = 'image' AND x.state = 'visible' AND b.user_id IS NULL`, [userId, joinedAt, roomId, seq]);
  const parts = visible && keyPattern.exec(visible.media_key);
  const info = parts && await fileInfo(visible.media_key);
  if (!info) fail(404, 'Image not found');
  return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
    .header('Content-Length', info.size).type(types[parts[5]]).send(createReadStream(join(directory, visible.media_key)));
}
