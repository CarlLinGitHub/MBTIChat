import Fastify from 'fastify';
import { db, rows, decimal, fail, flag, ownUser, requestUser, session, text, transaction } from './core.js';
import { access, announce, changeState, favorite, history, join, leave, mute, read, roomDetail, roomList, send } from './rooms.js';
import { imageLimit, readMedia, saveUpload } from './media.js';
import { block, blocks, feedback, updateUser } from './users.js';
import { realtime } from './realtime.js';

const app = Fastify({ logger: true, disableRequestLogging: true, routerOptions: { maxParamLength: 512 } });
await rows(db, 'SELECT 1');
const live = await realtime(app.server, app.log);
app.addHook('preClose', () => live.close());
app.addHook('onClose', () => db.end());
app.addContentTypeParser(/^image\//i, { parseAs: 'buffer', bodyLimit: imageLimit }, (_request, body, done) => done(null, body));
app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Route not found' }));
app.setErrorHandler((error, _request, reply) => {
  const status = error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
  if (status >= 500) app.log.error(error);
  return reply.code(status).send({ error: status === 500 ? 'Internal server error' : error.message });
});

function body(request) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Buffer.isBuffer(request.body)) {
    fail(400, 'Expected a JSON object');
  }
  return request.body;
}

async function decorate(room) {
  room.online = room.status === 'open' ? await live.online(room.id) : 0;
  room.joined = Number(room.joined) === 1;
  room.favorite = Number(room.favorite) === 1;
  return room;
}

function authenticated(handler) {
  return (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return handler(requestUser(request), request, reply);
  };
}

function inRoom(handler) {
  return authenticated((userId, request, reply) => handler(userId, decimal(request.params.id), request, reply));
}

app.get('/healthz', async () => {
  try {
    await Promise.all([rows(db, 'SELECT 1'), live.ping()]);
    return { ok: true };
  } catch {
    fail(503, 'Dependencies unavailable');
  }
});
app.post('/api/session', (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return session(body(request));
});
app.get('/api/rooms', authenticated(async (userId, request) => {
  const { q, category } = request.query;
  if (q !== undefined) text(q, 100, true);
  if (category !== undefined) text(category, 24, true);
  return Promise.all((await roomList(userId, { q, category })).map(decorate));
}));
app.get('/api/rooms/:id', inRoom(async (userId, roomId) => decorate(await roomDetail(userId, roomId))));
app.post('/api/rooms/:id/join', inRoom(async (userId, roomId) => decorate(await join(userId, roomId))));
app.post('/api/rooms/:id/leave', inRoom(async (userId, roomId) => {
  const joinedAt = await leave(userId, roomId);
  if (joinedAt) await live.leave(roomId, userId, joinedAt);
  return { ok: true };
}));
app.put('/api/rooms/:id/favorite', inRoom((userId, roomId, request) => favorite(userId, roomId, flag(body(request).enabled))));
app.get('/api/rooms/:id/messages', inRoom((userId, roomId, request) => history(userId, roomId, request.query)));
app.post('/api/rooms/:id/messages', inRoom(async (userId, roomId, request) => {
  const { value, created } = await send(userId, roomId, body(request));
  if (created) void live.message(roomId, value.seq);
  return value;
}));
app.post('/api/rooms/:id/read', inRoom((userId, roomId, request) => read(userId, roomId, body(request))));
app.get('/api/conversations', authenticated(async (userId, request) =>
  Promise.all((await roomList(userId, { conversations: true, unread: request.query.unread === '1' })).map(decorate))));
app.get('/api/me', authenticated(ownUser));
app.patch('/api/me', authenticated((userId, request) => updateUser(userId, body(request))));
app.get('/api/favorites', authenticated(async userId => Promise.all((await roomList(userId, { favorites: true })).map(decorate))));
app.get('/api/blocks', authenticated(blocks));
app.put('/api/blocks/:id', authenticated((userId, request) => block(userId, decimal(request.params.id), flag(body(request).enabled))));
app.post('/api/feedback', authenticated((userId, request) => feedback(userId, body(request).body)));
app.put('/api/rooms/:id/media', { bodyLimit: imageLimit }, inRoom(async (userId, roomId, request) => {
  const { membership } = await transaction(connection => access(connection, userId, roomId));
  if (membership.is_muted) fail(403, 'You are muted');
  return saveUpload(userId, roomId, membership.joined_at, request.body, request.headers['content-type']);
}));
app.get('/api/media/:token', (request, reply) => readMedia(request.params.token, reply));
app.patch('/api/rooms/:id/announcement', inRoom(async (userId, roomId, request) => {
  const value = await announce(userId, roomId, body(request).announcement);
  void live.announcement(roomId, value);
  return value;
}));
app.put('/api/rooms/:id/members/:userId/mute', inRoom((userId, roomId, request) =>
  mute(userId, roomId, decimal(request.params.userId), body(request).muted_until)));
app.patch('/api/rooms/:id/messages/:seq', inRoom(async (userId, roomId, request) => {
  const { value, changed } = await changeState(userId, roomId, decimal(request.params.seq), body(request).state);
  if (changed) void live.message(roomId, value.seq);
  return value;
}));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    app.close().catch(error => {
      app.log.error(error, 'Shutdown failed');
      process.exitCode = 1;
    });
  });
}
await app.listen({ host: '0.0.0.0', port: 8080 });
