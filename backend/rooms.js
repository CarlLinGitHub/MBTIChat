import { db, rows, transaction, fail, publicFields, moderate, text, decimal } from './core.js';
import { checkUpload, mediaUrl } from './media.js';

const id = 'CAST(? AS UNSIGNED)';
const roomFields = `r.*, c.code AS category, c.code AS category_code, c.name AS category_name,
  m.joined_at, m.joined_seq, m.last_read_seq, m.role, m.muted_until,
  m.user_id IS NOT NULL AS joined, f.user_id IS NOT NULL AS favorite`;
const roomJoins = `JOIN room_categories c ON c.id = r.category_id
  LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = ${id} AND m.left_at IS NULL
  LEFT JOIN room_favorites f ON f.room_id = r.id AND f.user_id = ${id}`;

export async function roomList(userId, { q, category, favorites, conversations, unread } = {}) {
  const where = [favorites ? 'f.user_id IS NOT NULL' : "r.status = 'open'"];
  const params = [userId, userId];
  let extra = '';
  let order = 'r.id';
  if (q) {
    where.push("r.name LIKE ? ESCAPE '!'");
    params.push(`%${q.replace(/[!%_]/g, '!$&')}%`);
  }
  if (category && category !== 'all') {
    where.push('c.code = ?');
    params.push(category);
  }
  if (favorites) order = 'f.created_at DESC, r.id DESC';
  if (conversations) {
    where.push('m.user_id IS NOT NULL');
    const condition = `x.room_id = r.id AND x.seq > GREATEST(m.joined_seq, m.last_read_seq) AND x.sender_id <> m.user_id`;
    extra = `, IF(r.last_seq > m.joined_seq, r.last_message_at, m.joined_at) AS activity_at,
      CAST((SELECT COUNT(*) FROM room_messages x WHERE ${condition}) AS CHAR) AS unread_count`;
    if (unread) where.push(`EXISTS (SELECT 1 FROM room_messages x WHERE ${condition})`);
    order = 'activity_at DESC, r.id DESC';
  }
  const query = `SELECT ${roomFields}${extra} FROM rooms r ${roomJoins} WHERE ${where.join(' AND ')} ORDER BY ${order}`;
  if (!conversations) return rows(db, query, params);
  return transaction(async connection => {
    const rooms = await rows(connection, query, params);
    for (const room of rooms) {
      room.preview = BigInt(room.last_seq) > BigInt(room.joined_seq)
        ? await message(connection, userId, room.id, room.last_seq, room.joined_at)
        : null;
    }
    return rooms;
  });
}

export async function roomDetail(userId, roomId) {
  return transaction(async connection => {
    const [room] = await rows(connection, `SELECT ${roomFields} FROM rooms r ${roomJoins} WHERE r.id = ${id}`, [userId, userId, roomId]);
    if (!room) fail(404, 'Room not found');
    room.members = room.status === 'open' ? await rows(connection, `SELECT ${publicFields}, m.role
      FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ${id} AND m.left_at IS NULL
      ORDER BY m.role, m.joined_at, u.id`, [roomId]) : [];
    return room;
  });
}

async function findRoom(connection, roomId, lock = false) {
  const [room] = await rows(connection, `SELECT * FROM rooms WHERE id = ${id}${lock ? ' FOR UPDATE' : ''}`, [roomId]);
  if (!room) fail(404, 'Room not found');
  return room;
}

function requireOpen(room) {
  if (room.status !== 'open') fail(403, 'Room is closed');
}

async function member(connection, userId, roomId, lock = false) {
  const [found] = await rows(connection, `SELECT *, muted_until > UTC_TIMESTAMP(6) AS is_muted FROM room_members
    WHERE room_id = ${id} AND user_id = ${id}${lock ? ' FOR UPDATE' : ''}`, [roomId, userId]);
  return found;
}

export async function access(connection, userId, roomId, lock = false) {
  const room = await findRoom(connection, roomId, lock);
  requireOpen(room);
  const membership = await member(connection, userId, roomId, lock);
  if (!membership || membership.left_at !== null) fail(403, 'Join the room first');
  return { room, membership };
}

export async function join(userId, roomId) {
  await transaction(async connection => {
    const room = await findRoom(connection, roomId, true);
    requireOpen(room);
    const current = await member(connection, userId, roomId, true);
    if (!current) {
      await rows(connection, `INSERT INTO room_members (room_id, user_id, joined_seq, last_read_seq)
        VALUES (${id}, ${id}, ${id}, ${id})`, [roomId, userId, room.last_seq, room.last_seq]);
    } else if (current.left_at !== null) {
      await rows(connection, `UPDATE room_members SET role = 'member',
        joined_at = GREATEST(UTC_TIMESTAMP(6), TIMESTAMPADD(MICROSECOND, 1, joined_at)), left_at = NULL,
        joined_seq = ${id}, last_read_seq = ${id} WHERE room_id = ${id} AND user_id = ${id}`,
      [room.last_seq, room.last_seq, roomId, userId]);
    }
  });
  return roomDetail(userId, roomId);
}

export async function leave(userId, roomId) {
  return transaction(async connection => {
    await findRoom(connection, roomId, true);
    const current = await member(connection, userId, roomId, true);
    if (!current || current.left_at !== null) return null;
    await rows(connection, `UPDATE room_members SET left_at = GREATEST(UTC_TIMESTAMP(6), joined_at)
      WHERE room_id = ${id} AND user_id = ${id}`, [roomId, userId]);
    return current.joined_at;
  });
}

export async function favorite(userId, roomId, enabled) {
  await findRoom(db, roomId);
  if (enabled) {
    await rows(db, `INSERT INTO room_favorites (user_id, room_id) VALUES (${id}, ${id})
      ON DUPLICATE KEY UPDATE created_at = created_at`, [userId, roomId]);
  } else {
    await rows(db, `DELETE FROM room_favorites WHERE user_id = ${id} AND room_id = ${id}`, [userId, roomId]);
  }
  return { favorite: enabled };
}

const messageFields = `x.room_id, x.seq, x.sender_id, BIN_TO_UUID(x.client_msg_id) AS client_msg_id,
  x.kind, x.state, x.body, x.media_key, x.created_at, u.nickname, u.avatar_key,
  IF(u.show_mbti, u.mbti, NULL) AS mbti, b.user_id IS NOT NULL AS blocked`;
const messageJoins = `JOIN users u ON u.id = x.sender_id LEFT JOIN user_blocks b
  ON b.user_id = ${id} AND b.blocked_user_id = x.sender_id`;

function presentMessage(row, userId, joinedAt) {
  const { blocked, ...message } = row;
  const placeholder = message.state === 'recalled' ? '消息已撤回'
    : message.state === 'hidden' ? '消息不可见' : Number(blocked) === 1 ? '已屏蔽该用户的消息' : null;
  if (placeholder) {
    message.body = null;
    message.media_key = null;
  }
  message.placeholder = placeholder;
  message.media_url = message.media_key ? mediaUrl(userId, message.room_id, message.seq, joinedAt) : null;
  return message;
}

async function message(connection, userId, roomId, seq, joinedAt) {
  const [found] = await rows(connection, `SELECT ${messageFields} FROM room_messages x ${messageJoins}
    WHERE x.room_id = ${id} AND x.seq = ${id}`, [userId, roomId, seq]);
  return found ? presentMessage(found, userId, joinedAt) : null;
}

export async function delivery(userId, roomId, seq, joinedAt) {
  return transaction(async connection => {
    const { membership } = await access(connection, userId, roomId);
    if (membership.joined_at !== joinedAt || BigInt(seq) <= BigInt(membership.joined_seq)) return null;
    return message(connection, userId, roomId, seq, joinedAt);
  });
}

export async function history(userId, roomId, { before_seq, after_seq, limit }) {
  if (before_seq !== undefined && after_seq !== undefined) fail(400, 'Use only one pagination cursor');
  const cursor = before_seq ?? after_seq;
  if (cursor !== undefined) decimal(cursor, { zero: true });
  const size = limit === undefined ? 50 : Number(decimal(limit));
  if (size > 100) fail(400, 'Limit must be between 1 and 100');
  return transaction(async connection => {
    const { membership } = await access(connection, userId, roomId);
    const after = after_seq !== undefined;
    const window = cursor === undefined ? '' : `AND x.seq ${after ? '>' : '<'} ${id}`;
    const found = await rows(connection, `SELECT ${messageFields} FROM room_messages x ${messageJoins}
      WHERE x.room_id = ${id} AND x.seq > ${id} ${window} ORDER BY x.seq ${after ? 'ASC' : 'DESC'} LIMIT ?`,
    [userId, roomId, membership.joined_seq, ...(cursor === undefined ? [] : [cursor]), String(size)]);
    return found.map(row => presentMessage(row, userId, membership.joined_at));
  });
}

async function existingMessage(connection, userId, roomId, clientId, membership, lock) {
  const [existing] = await rows(connection, `SELECT seq FROM room_messages WHERE room_id = ${id}
    AND sender_id = ${id} AND client_msg_id = UUID_TO_BIN(?)${lock ? ' FOR UPDATE' : ''}`, [roomId, userId, clientId]);
  if (!existing) return null;
  if (BigInt(existing.seq) <= BigInt(membership.joined_seq)) fail(409, 'Message identifier belongs to a previous membership');
  return message(connection, userId, roomId, existing.seq, membership.joined_at);
}

export async function send(userId, roomId, input) {
  const { client_msg_id: clientId, kind } = input;
  if (typeof clientId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(clientId)) fail(400, 'Expected a message UUID');
  const { existing, joinedAt } = await transaction(async connection => {
    const { membership } = await access(connection, userId, roomId);
    if (membership.is_muted) fail(403, 'You are muted');
    return { existing: await existingMessage(connection, userId, roomId, clientId, membership, false),
      joinedAt: membership.joined_at };
  });
  if (existing) return { value: existing, created: false };
  let body = null;
  let key = null;
  if (kind === 'text') {
    body = text(input.body, 2000).trim();
    await moderate(kind, body);
  } else if (kind === 'image') {
    key = text(input.media_key, 512);
  } else {
    fail(400, 'Expected text or image');
  }
  return transaction(async connection => {
    const { room, membership } = await access(connection, userId, roomId, true);
    if (membership.joined_at !== joinedAt) fail(409, 'Membership has changed');
    if (membership.is_muted) fail(403, 'You are muted');
    const duplicate = await existingMessage(connection, userId, roomId, clientId, membership, true);
    if (duplicate) return { value: duplicate, created: false };
    if (key) await checkUpload(userId, roomId, membership.joined_at, key);
    const seq = String(BigInt(room.last_seq) + 1n);
    await rows(connection, `INSERT INTO room_messages (room_id, seq, sender_id, client_msg_id, kind, body, media_key)
      VALUES (${id}, ${id}, ${id}, UUID_TO_BIN(?), ?, ?, ?)`, [roomId, seq, userId, clientId, kind, body, key]);
    await rows(connection, `UPDATE rooms r JOIN room_messages x ON x.room_id = r.id AND x.seq = ${id}
      SET r.last_seq = x.seq, r.last_message_at = x.created_at WHERE r.id = ${id}`, [seq, roomId]);
    return { value: await message(connection, userId, roomId, seq, membership.joined_at), created: true };
  });
}

export async function read(userId, roomId, { seq, joined_at: joinedAt }) {
  decimal(seq, { zero: true });
  return transaction(async connection => {
    const { room, membership } = await access(connection, userId, roomId, true);
    if (membership.joined_at !== joinedAt) fail(409, 'Membership has changed');
    await rows(connection, `UPDATE room_members SET last_read_seq = GREATEST(last_read_seq, LEAST(${id}, ${id}))
      WHERE room_id = ${id} AND user_id = ${id}`, [seq, room.last_seq, roomId, userId]);
    const updated = await member(connection, userId, roomId, true);
    return { last_read_seq: updated.last_read_seq };
  });
}

function requireAdmin(membership) {
  if (membership.role !== 'admin') fail(403, 'Room administrator required');
}

export async function announce(userId, roomId, announcement) {
  if (announcement !== null) {
    text(announcement, 500);
    await transaction(async connection => requireAdmin((await access(connection, userId, roomId)).membership));
    await moderate('announcement', announcement);
  }
  return transaction(async connection => {
    const { membership } = await access(connection, userId, roomId, true);
    requireAdmin(membership);
    await rows(connection, `UPDATE rooms SET announcement = ?, announcement_updated_at = UTC_TIMESTAMP(6)
      WHERE id = ${id}`, [announcement, roomId]);
    const room = await findRoom(connection, roomId, true);
    return { announcement: room.announcement, announcement_updated_at: room.announcement_updated_at };
  });
}

export async function mute(userId, roomId, targetId, value) {
  let until = null;
  if (value !== null) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value))) fail(400, 'Expected a UTC ISO timestamp or null');
    const canonical = new Date(value).toISOString();
    if (canonical !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) fail(400, 'Invalid UTC timestamp');
    if (Date.parse(value) <= Date.now()) fail(400, 'Mute expiration must be in the future');
    until = canonical.slice(0, -1).replace('T', ' ');
  }
  return transaction(async connection => {
    const { membership } = await access(connection, userId, roomId, true);
    requireAdmin(membership);
    const target = await member(connection, targetId, roomId, true);
    if (!target || target.left_at !== null) fail(404, 'Active member not found');
    if (target.role === 'admin') fail(403, 'Cannot mute a room administrator');
    await rows(connection, `UPDATE room_members SET muted_until = ? WHERE room_id = ${id} AND user_id = ${id}`,
      [until, roomId, targetId]);
    return { muted_until: (await member(connection, targetId, roomId, true)).muted_until };
  });
}

export async function changeState(userId, roomId, seq, state) {
  if (!['hidden', 'recalled'].includes(state)) fail(400, 'Expected hidden or recalled');
  return transaction(async connection => {
    const { membership } = await access(connection, userId, roomId, true);
    if (state === 'hidden') requireAdmin(membership);
    if (BigInt(seq) <= BigInt(membership.joined_seq)) fail(404, 'Message not found');
    const [current] = await rows(connection, `SELECT sender_id, state FROM room_messages
      WHERE room_id = ${id} AND seq = ${id} FOR UPDATE`, [roomId, seq]);
    if (!current) fail(404, 'Message not found');
    if (state === 'recalled' && current.sender_id !== userId) fail(403, 'Only the sender may recall a message');
    if (current.state === state) return { value: await message(connection, userId, roomId, seq, membership.joined_at), changed: false };
    if (current.state !== 'visible') fail(409, 'Message is already moderated');
    await rows(connection, `UPDATE room_messages SET state = ?, body = NULL, media_key = NULL
      WHERE room_id = ${id} AND seq = ${id}`, [state, roomId, seq]);
    return { value: await message(connection, userId, roomId, seq, membership.joined_at), changed: true };
  });
}
