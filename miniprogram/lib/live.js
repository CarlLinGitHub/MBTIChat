const { connectRoom } = require('./api')

function watchRoom(roomId, token, event, disconnected) {
  const socket = connectRoom()
  let closed = false
  let lastPong = Date.now()
  let heartbeat
  const deadline = setTimeout(() => lost(), 10000)

  function close() {
    if (closed) return
    closed = true
    clearTimeout(deadline)
    clearInterval(heartbeat)
    socket.close({ fail() {} })
  }

  function lost() {
    if (closed) return
    close()
    disconnected()
  }

  function send(payload) {
    socket.send({ data: JSON.stringify(payload), fail: lost })
  }

  socket.onOpen(() => {
    if (!closed) send({ type: 'subscribe', token, room_id: roomId })
  })
  socket.onMessage(({ data }) => {
    if (closed || typeof data !== 'string') return
    let value
    try { value = JSON.parse(data) } catch (_) { return }
    if (!value || typeof value !== 'object') return
    if (value.type === 'subscribed') {
      clearTimeout(deadline)
      clearInterval(heartbeat)
      lastPong = Date.now()
      heartbeat = setInterval(() => {
        if (Date.now() - lastPong > 45000) lost()
        else send({ type: 'ping' })
      }, 15000)
    }
    if (value.type === 'pong') lastPong = Date.now()
    else event(value)
  })
  socket.onClose(lost)
  socket.onError(lost)
  return close
}

module.exports = { watchRoom }
