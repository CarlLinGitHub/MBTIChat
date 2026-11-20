import { db, rows, ownUser, publicFields, fail, text, flag, transaction, moderate } from './core.js';

const id = 'CAST(? AS UNSIGNED)';
const mbtiTypes = new Set('ISTJ ISFJ INFJ INTJ ISTP ISFP INFP INTP ESTP ESFP ENFP ENTP ESTJ ESFJ ENFJ ENTJ'.split(' '));
const avatarKeys = new Set(['chestnut', 'lin', 'zhou', 'youzi']);

export async function updateUser(userId, input) {
  const changes = [];
  const params = [];
  function set(field, value) {
    changes.push(`${field} = ?`);
    params.push(value);
  }
  if (input.nickname !== undefined) set('nickname', text(input.nickname, 40).trim());
  if (input.bio !== undefined) set('bio', text(input.bio, 240, true).trim());
  if (input.mbti !== undefined) {
    if (input.mbti !== null && !mbtiTypes.has(input.mbti)) fail(400, 'Unknown MBTI type');
    set('mbti', input.mbti);
  }
  if (input.avatar_key !== undefined) {
    if (input.avatar_key !== null && !avatarKeys.has(input.avatar_key)) fail(400, 'Unknown avatar');
    set('avatar_key', input.avatar_key);
  }
  for (const field of ['show_mbti', 'notifications_enabled']) {
    if (input[field] !== undefined) set(field, flag(input[field]));
  }
  if (changes.length) {
    const current = await ownUser(userId);
    for (const field of ['nickname', 'bio']) {
      if (typeof input[field] === 'string') {
        const value = input[field].trim();
        if (value && value !== current[field]) await moderate(field, value);
      }
    }
    await rows(db, `UPDATE users SET ${changes.join(', ')} WHERE id = ${id}`, [...params, userId]);
  }
  return ownUser(userId);
}

export async function blocks(userId) {
  return rows(db, `SELECT ${publicFields} FROM user_blocks b JOIN users u ON u.id = b.blocked_user_id
    WHERE b.user_id = ${id} ORDER BY b.created_at DESC, u.id DESC`, [userId]);
}

export async function block(userId, targetId, enabled) {
  if (userId === targetId) fail(400, 'Cannot block yourself');
  if (enabled) {
    const [target] = await rows(db, `SELECT id FROM users WHERE id = ${id}`, [targetId]);
    if (!target) fail(404, 'User not found');
    await rows(db, `INSERT INTO user_blocks (user_id, blocked_user_id) VALUES (${id}, ${id})
      ON DUPLICATE KEY UPDATE created_at = created_at`, [userId, targetId]);
  } else {
    await rows(db, `DELETE FROM user_blocks WHERE user_id = ${id} AND blocked_user_id = ${id}`, [userId, targetId]);
  }
  return { blocked: enabled };
}

export async function feedback(userId, value) {
  const body = text(value, 2000).trim();
  return transaction(async connection => {
    await rows(connection, `INSERT INTO user_feedback (user_id, body) VALUES (${id}, ?)`, [userId, body]);
    const [result] = await rows(connection, 'SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
    return result;
  });
}
