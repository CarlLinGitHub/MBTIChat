import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { WebSocket, WebSocketServer } from 'ws';
import { decimal, transaction, verify } from './core.js';
import { access, delivery } from './rooms.js';

const leaseMs = 65_000;
const key = roomId => `mbtichat:presence:${roomId}`;
const countLeaseUsers = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  local seen = {}
  local count = 0
  for _, entry in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
    local user = string.match(entry, '^%d+')
    if user and not seen[user] then
      seen[user] = true
      count = count + 1
    end
  end
  return count`;
const touchLease = `
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
  redis.call('PEXPIRE', KEYS[1], ARGV[3])`;

export async function realtime(server, log) {
  const redis = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379', disableOfflineQueue: true });
  redis.on('error', error => log.error(error, 'Redis error'));
  await redis.connect();
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const subscriptions = new Map();
  const latestPresence = new Map();
  const roomEvents = new Map();
  let stopped = false;

  async function online(roomId) {
    return redis.eval(countLeaseUsers, { keys: [key(roomId)], arguments: [String(Date.now())] });
  }

  function emit(socket, data) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1024 * 1024) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(data));
  }

  function queued(map, id, fn) {
    const task = (map.get(id) || Promise.resolve()).then(fn);
    const settled = task.catch(error => log.error(error, 'Realtime operation failed')).finally(() => {
      if (map.get(id) === settled) map.delete(id);
    });
    map.set(id, settled);
    return settled;
  }

  function presence(roomId) {
    return queued(roomEvents, roomId, async () => {
      if (!subscriptions.has(roomId)) return;
      const value = await online(roomId);
      const group = subscriptions.get(roomId);
      if (!group || latestPresence.get(roomId) === value) return;
      latestPresence.set(roomId, value);
      for (const socket of group) emit(socket, { type: 'presence', online: value });
    });
  }

  async function unsubscribe(socket, expected = socket.subscription, notify = false) {
    if (!expected || socket.subscription !== expected) return;
    socket.subscription = null;
    const { roomId, lease } = expected;
    const group = subscriptions.get(roomId);
    group.delete(socket);
    if (!group.size) {
      subscriptions.delete(roomId);
      latestPresence.delete(roomId);
    }
    if (notify) emit(socket, { type: 'left' });
    await redis.zRem(key(roomId), lease);
    if (!stopped) void presence(roomId);
  }

  function touch(sub) {
    return redis.eval(touchLease, { keys: [key(sub.roomId)],
      arguments: [String(sub.touched + leaseMs), sub.lease, String(leaseMs)] });
  }

  async function subscribe(socket, packet) {
    const session = verify('session', packet.token);
    const roomId = decimal(packet.room_id);
    await unsubscribe(socket);
    try {
      await transaction(async connection => {
        // Hold the room lock until the subscription is registered: a concurrent leave must see it.
        const { membership } = await access(connection, session.id, roomId, true);
        if (socket.readyState !== WebSocket.OPEN) return;
        const sub = { roomId, userId: session.id, exp: session.exp, joinedAt: membership.joined_at,
          lease: `${session.id}:${socket.connectionId}`, touched: Date.now() };
        if (!subscriptions.has(roomId)) subscriptions.set(roomId, new Set());
        subscriptions.get(roomId).add(socket);
        socket.subscription = sub;
        await touch(sub);
        const value = await online(roomId);
        emit(socket, { type: 'subscribed', joined_at: sub.joinedAt, joined_seq: membership.joined_seq, online: value });
      });
    } catch (error) {
      await unsubscribe(socket);
      throw error;
    }
    if (socket.subscription) void presence(roomId);
  }

  async function active(sub) {
    if (sub.exp <= Date.now() / 1000) return false;
    const { membership } = await transaction(connection => access(connection, sub.userId, sub.roomId));
    return membership.joined_at === sub.joinedAt;
  }

  async function heartbeat(socket) {
    const sub = socket.subscription;
    if (!sub) return;
    try {
      if (!await active(sub)) return unsubscribe(socket, sub, true);
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 404) return unsubscribe(socket, sub, true);
      throw error;
    }
    if (socket.subscription !== sub) return;
    sub.touched = Date.now();
    await touch(sub);
    emit(socket, { type: 'pong' });
  }

  wss.on('connection', socket => {
    socket.connectionId = randomUUID();
    socket.subscription = null;
    let pending = Promise.resolve();
    let queuedPackets = 0;
    socket.on('error', error => log.debug(error, 'WebSocket connection error'));
    socket.on('message', (data, binary) => {
      if (queuedPackets >= 16) return socket.close(1008, 'Too many queued events');
      queuedPackets++;
      pending = pending.then(async () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const packet = binary ? null : JSON.parse(data.toString());
        if (packet?.type === 'subscribe') await subscribe(socket, packet);
        else if (packet?.type === 'ping') await heartbeat(socket);
        else emit(socket, { type: 'error', error: 'Unknown event' });
      }).catch(error => {
        if (!error.statusCode && !(error instanceof SyntaxError)) log.error(error, 'WebSocket request failed');
        emit(socket, { type: 'error', error: error.statusCode ? error.message : error instanceof SyntaxError ? 'Invalid JSON' : 'Realtime request failed' });
      }).finally(() => { queuedPackets--; });
    });
    socket.once('close', () => {
      void pending.then(() => unsubscribe(socket)).catch(error => log.error(error, 'Presence cleanup failed'));
    });
  });

  function broadcast(roomId, compute) {
    return queued(roomEvents, roomId, async () => {
      const group = subscriptions.get(roomId);
      if (!group) return;
      const recipients = new Map();
      for (const socket of group) {
        const sub = socket.subscription;
        if (sub.exp <= Date.now() / 1000) {
          await unsubscribe(socket, sub, true);
          continue;
        }
        const identity = `${sub.userId}:${sub.joinedAt}`;
        let entry = recipients.get(identity);
        if (!entry) recipients.set(identity, entry = { sub, sockets: [] });
        entry.sockets.push([socket, sub]);
      }
      for (const { sub, sockets } of recipients.values()) {
        let event;
        try {
          event = await compute(sub);
        } catch (error) {
          if (error.statusCode !== 403 && error.statusCode !== 404) throw error;
          for (const [socket, expected] of sockets) await unsubscribe(socket, expected, true);
          continue;
        }
        if (event) for (const [socket, expected] of sockets) {
          if (socket.subscription === expected) emit(socket, event);
        }
      }
    });
  }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [roomId, group] of subscriptions) {
      for (const socket of group) {
        const sub = socket.subscription;
        if (sub.touched + leaseMs <= now || sub.exp <= now / 1000) socket.terminate();
      }
      void presence(roomId);
    }
  }, 10_000).unref();

  return {
    online,
    ping: () => redis.ping(),
    message: (roomId, seq) => broadcast(roomId, async sub => {
      const message = await delivery(sub.userId, roomId, seq, sub.joinedAt);
      return message && { type: 'message', message };
    }),
    announcement: (roomId, announcement) => broadcast(roomId, async sub =>
      await active(sub) ? { type: 'announcement', ...announcement } : null),
    async leave(roomId, userId, joinedAt) {
      for (const socket of subscriptions.get(roomId) || []) {
        const sub = socket.subscription;
        if (sub.userId === userId && sub.joinedAt === joinedAt) {
          try {
            await unsubscribe(socket, sub, true);
          } catch (error) {
            log.error(error, 'Presence cleanup failed');
          }
        }
      }
    },
    async close() {
      stopped = true;
      clearInterval(timer);
      const clients = [...wss.clients];
      await Promise.allSettled(clients.map(socket => unsubscribe(socket)));
      for (const socket of clients) socket.terminate();
      await new Promise((resolve, reject) => wss.close(error => error ? reject(error) : resolve()));
      await Promise.all(roomEvents.values());
      await redis.close();
    },
  };
}
