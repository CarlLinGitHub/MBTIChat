function compare(a, b) {
  return a.length - b.length || (a === b ? 0 : a < b ? -1 : 1)
}

function step(value, direction) {
  const digits = value.split('')
  for (let index = digits.length - 1; index >= 0; index--) {
    const digit = Number(digits[index]) + direction
    digits[index] = String((digit + 10) % 10)
    if (digit > -1 && digit < 10) {
      return digits.join('').replace(/^0+(?=\d)/, '')
    }
  }
  return direction === 1 ? '1' + digits.join('') : '0'
}

const next = value => step(value, 1)
const previous = value => step(value, -1)
const concealed = message => Boolean(message.placeholder) || (message.state && message.state !== 'visible')

class Timeline {
  constructor(room, pending = new Map()) {
    this.joinedAt = room.joined_at
    this.joinedSeq = String(room.joined_seq)
    this.readSeq = String(room.last_read_seq)
    this.tail = this.joinedSeq
    this.rows = new Map()
    this.pending = pending
    this.seen = new Set()
    this.imageErrors = new Set()
  }

  merge(messages, userId) {
    for (const message of messages) {
      const seq = String(message.seq)
      if (compare(seq, this.joinedSeq) <= 0) continue
      const current = this.rows.get(seq)
      // A delayed history response must not restore content after a moderation event.
      if (!current || !concealed(current) || concealed(message)) this.rows.set(seq, { ...message, seq })
      if (String(message.sender_id) === userId) this.pending.delete(message.client_msg_id)
    }
    let cursor = next(this.tail)
    while (this.rows.has(cursor)) {
      this.tail = cursor
      cursor = next(cursor)
    }
  }

  ordered() {
    return [...this.rows.keys()].filter(seq => compare(seq, this.tail) <= 0).sort(compare).map(seq => this.rows.get(seq))
  }

  hasGap() {
    for (const seq of this.rows.keys()) {
      if (compare(seq, this.tail) > 0) return true
    }
    return false
  }

  visible(seq) {
    if (compare(seq, this.readSeq) > 0) this.seen.add(seq)
  }

  readTarget() {
    let seq = this.readSeq
    while (this.seen.has(next(seq))) seq = next(seq)
    return seq
  }

  advanceRead(seq) {
    if (compare(seq, this.readSeq) <= 0) return
    this.readSeq = seq
    for (const visible of this.seen) {
      if (compare(visible, seq) <= 0) this.seen.delete(visible)
    }
  }
}

module.exports = { Timeline, compare, next, previous, concealed }
