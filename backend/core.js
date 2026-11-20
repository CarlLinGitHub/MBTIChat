import { createHmac, timingSafeEqual } from 'node:crypto';
import mysql from 'mysql2/promise';

export const demo = process.env.LOCAL_DEMO === '1';
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error('SESSION_SECRET is required');

export const db = mysql.createPool({
  host: process.env.MYSQL_HOST || 'db',
  database: process.env.MYSQL_DATABASE || 'mbtichat',
  user: process.env.MYSQL_USER || 'mbti',
  password: process.env.MYSQL_PASSWORD,
  timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
});
db.on('connection', connection => connection.query("SET time_zone = '+00:00'"));

export async function rows(connection, sql, params = []) {
  const [result] = await connection.execute(sql, params);
  return result;
}

export async function transaction(fn) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode });
}

export function decimal(value, { zero = false } = {}) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value) ||
      (!zero && value === '0') || BigInt(value) > 18446744073709551615n) {
    fail(400, 'Invalid decimal identifier or sequence');
  }
  return value;
}

export function text(value, max, allowEmpty = false) {
  if (typeof value !== 'string' || [...value].length > max || (!allowEmpty && !value.trim())) {
    fail(400, `Expected ${allowEmpty ? 'a' : 'nonempty'} string up to ${max} characters`);
  }
  return value;
}

export function flag(value) {
  if (typeof value !== 'boolean') fail(400, 'Expected a boolean');
  return value;
}

function signature(purpose, encoded) {
  return createHmac('sha256', secret).update(`${purpose}.${encoded}`).digest('base64url');
}

export function sign(purpose, data, lifetime) {
  const encoded = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + lifetime })).toString('base64url');
  return `${encoded}.${signature(purpose, encoded)}`;
}

export function verify(purpose, token) {
  if (typeof token !== 'string' || token.length > 2048) fail(401, 'Invalid or expired token');
  const [encoded, mac, extra] = token.split('.');
  const expected = Buffer.from(signature(purpose, encoded));
  if (!mac || extra !== undefined || Buffer.byteLength(mac) !== expected.length ||
      !timingSafeEqual(Buffer.from(mac), expected)) fail(401, 'Invalid or expired token');
  const data = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  if (data.exp <= Date.now() / 1000) fail(401, 'Invalid or expired token');
  return data;
}

export function requestUser(request) {
  return verify('session', request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1]).id;
}

export const ownFields = 'id, nickname, avatar_key, bio, mbti, show_mbti, notifications_enabled, created_at';
export const publicFields = 'u.id, u.nickname, u.avatar_key, u.bio, IF(u.show_mbti, u.mbti, NULL) AS mbti';
export async function ownUser(id) {
  const [user] = await rows(db, `SELECT ${ownFields} FROM users WHERE id = ?`, [id]);
  if (!user) fail(401, 'Unknown user');
  user.show_mbti = Boolean(user.show_mbti);
  user.notifications_enabled = Boolean(user.notifications_enabled);
  return user;
}

export async function session({ account, code } = {}) {
  let openId;
  if (account !== undefined) {
    if (!demo || !['new', 'chestnut', 'lin', 'zhou'].includes(account)) fail(400, 'Unknown demo account');
    openId = `local-${account}`;
    if (account === 'new') {
      await rows(db, `INSERT INTO users (wechat_openid, nickname) VALUES (?, '新用户')
                      ON DUPLICATE KEY UPDATE id = id`, [openId]);
    }
  } else {
    text(code, 512);
    const { WX_APP_ID, WX_APP_SECRET } = process.env;
    if (!WX_APP_ID || !WX_APP_SECRET) fail(503, 'WeChat login is not configured');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: WX_APP_ID, secret: WX_APP_SECRET, js_code: code, grant_type: 'authorization_code' });
    let result;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) fail(502, 'WeChat login unavailable');
      result = await response.json();
    } catch {
      fail(502, 'WeChat login unavailable');
    }
    if (result.errcode || typeof result.openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.openid) || result.openid.startsWith('local-')) {
      fail(401, 'WeChat login code rejected');
    }
    openId = result.openid;
    await rows(db, `INSERT INTO users (wechat_openid, nickname) VALUES (?, '微信用户')
                    ON DUPLICATE KEY UPDATE id = id`, [openId]);
  }
  const [found] = await rows(db, 'SELECT id FROM users WHERE wechat_openid = ?', [openId]);
  if (!found) fail(401, 'Unknown account');
  return { token: sign('session', { id: found.id }, 7 * 86400), user: await ownUser(found.id) };
}

export async function moderate(kind, content) {
  const { MODERATION_URL, MODERATION_TOKEN } = process.env;
  if (!MODERATION_URL) {
    if (demo) return;
    fail(503, 'Content moderation is not configured');
  }
  const image = kind === 'image';
  let result;
  try {
    const response = await fetch(MODERATION_URL, {
      method: 'POST', signal: AbortSignal.timeout(8000), redirect: 'error',
      headers: {
        'Content-Type': image ? content.mime : 'application/json',
        ...(MODERATION_TOKEN ? { Authorization: `Bearer ${MODERATION_TOKEN}` } : {}),
      },
      body: image ? content.bytes : JSON.stringify({ kind, body: content }),
    });
    if (!response.ok) fail(502, 'Moderation service unavailable');
    result = await response.json();
  } catch {
    fail(502, 'Moderation service unavailable');
  }
  if (result?.allowed === false) fail(422, 'Content was rejected by moderation');
  if (result?.allowed !== true) fail(502, 'Invalid moderation response');
}
