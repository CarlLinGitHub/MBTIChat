const { api, getSession, mediaUrl } = require('../../lib/api')
const { avatar, confirm, errorToast, messageText, time } = require('../../lib/ui')
const { Timeline, compare, next, previous, concealed } = require('../../lib/timeline')
const { messageId, chooseImage, readImage } = require('../../lib/outbox')
const { watchRoom } = require('../../lib/live')

const pageSize = 50
const ownerId = event => String(event.currentTarget.dataset.id || '')
const membershipError = error => error.status === 403 || error.status === 404

Page({
  data: {
    room: null, messages: [], draft: '', roomError: '', historyError: '',
    loadedHistory: false, olderLoading: false, hasOlder: false, scrollTarget: '', newBelow: false,
    connection: '', sheet: false, roomBusy: false
  },
  onLoad({ id }) {
    if (!/^\d+$/.test(id || '')) return this.setData({ roomError: '聊天室不存在' })
    this.roomId = id
    this.roomPath = `/api/rooms/${id}`
    this.historyPath = `${this.roomPath}/messages`
    this.stick = true
    this.reconnectDelay = 500
  },
  onShow() {
    this.visible = true
    if (this.roomId) this.refreshRoom()
  },
  onHide() {
    this.visible = false
    this.refreshKey = null
    this.stopLive()
    this.disconnectObserver()
    clearTimeout(this.readTimer)
    this.readTimer = null
  },
  onUnload() {
    this.disposed = true
    this.onHide()
    this.timeline = null
  },
  async refreshRoom() {
    const key = {}
    this.refreshKey = key
    try {
      const room = await api(this.roomPath)
      const session = await getSession()
      if (this.refreshKey !== key) return
      this.userId = String(session.user.id)
      this.applyRoom(room)
    } catch (error) {
      if (this.refreshKey !== key) return
      if (membershipError(error) || !this.data.room) {
        this.stopLive()
        this.disconnectObserver()
        this.timeline = null
        this.setData({ roomError: error.message, room: null, messages: [], sheet: false })
      } else if (this.timeline) {
        this.observe()
        this.scheduleReconnect()
      } else {
        errorToast(error)
      }
    }
  },
  applyRoom(room, resetHistory = false) {
    if (this.disposed) return
    const members = (room.members || []).map(user => ({ ...user, avatar: avatar(user.avatar_key), own: String(user.id) === this.userId }))
    const joined = room.joined && room.status !== 'closed'
    const existing = this.timeline
    const sameRound = joined && existing && existing.joinedAt === room.joined_at
    const display = { ...room, joined, members, topMembers: members.filter(user => !user.own).slice(0, 3) }
    wx.setNavigationBarTitle({ title: room.name })
    if (sameRound && !resetHistory) {
      existing.advanceRead(String(room.last_read_seq))
      this.setData({ room: display, roomError: '' }, () => this.observe())
      if (existing.ready) this.startLive(existing)
      else this.loadLatest(existing)
      return
    }
    this.stopLive()
    this.disconnectObserver()
    clearTimeout(this.readTimer)
    this.readTimer = null
    this.timeline = joined ? new Timeline(room, sameRound ? existing.pending : undefined) : null
    this.stick = true
    this.setData({
      room: display, roomError: '', historyError: '', messages: [], loadedHistory: false, olderLoading: false,
      hasOlder: false, newBelow: false, connection: '', scrollTarget: '', draft: sameRound ? this.data.draft : ''
    })
    if (this.timeline) this.loadLatest(this.timeline)
  },
  async loadLatest(state) {
    if (state.latestLoading || state.ready) return
    state.latestLoading = true
    try {
      const page = await api(`${this.historyPath}?limit=${pageSize}`)
      if (this.timeline !== state) return
      if (page.length) state.tail = previous(String(page[page.length - 1].seq))
      state.merge(page, this.userId)
      state.ready = true
      this.setData({ loadedHistory: true, historyError: '' })
      this.render(state, { bottom: true })
      this.startLive(state)
    } catch (error) {
      if (this.timeline !== state) return
      this.setData({ historyError: error.message })
      if (membershipError(error)) this.refreshRoom()
    } finally {
      state.latestLoading = false
    }
  },
  retryHistory() {
    const state = this.timeline
    if (!state) return
    this.setData({ historyError: '' })
    if (state.ready) this.loadOlder()
    else this.loadLatest(state)
  },
  async loadOlder() {
    const state = this.timeline
    if (!state || !state.ready || state.olderLoading || !this.data.hasOlder) return
    const first = state.ordered()[0]
    if (!first) return
    state.olderLoading = true
    this.setData({ olderLoading: true, historyError: '' })
    try {
      const page = await api(`${this.historyPath}?before_seq=${first.seq}&limit=${pageSize}`)
      if (this.timeline !== state) return
      if (!page.length) state.noOlder = true
      state.merge(page, this.userId)
      this.render(state, page.length && !this.stick ? { anchor: `m-${first.seq}` } : {})
    } catch (error) {
      if (this.timeline !== state) return
      this.setData({ historyError: error.message })
      if (membershipError(error)) this.refreshRoom()
    } finally {
      state.olderLoading = false
      if (this.timeline === state) this.setData({ olderLoading: false })
    }
  },
  async startLive(state) {
    if (!this.visible || this.liveKey || this.reconnectTimer || this.timeline !== state) return
    const key = {}
    this.liveKey = key
    this.setData({ connection: '连接中…' })
    try {
      const { token } = await getSession()
      if (this.liveKey !== key) return
      this.closeLive = watchRoom(this.roomId, token, event => {
        if (this.liveKey !== key || this.timeline !== state) return
        if (event.type === 'subscribed') {
          if (event.joined_at !== state.joinedAt || String(event.joined_seq) !== state.joinedSeq) {
            this.loseMembership()
            return
          }
          this.reconnectDelay = 500
          this.setData({ connection: '', 'room.online': event.online })
          this.pullNew(state)
        } else if (event.type === 'message' && event.message) {
          this.receive(state, [event.message])
          if (state.hasGap()) this.pullNew(state)
        } else if (event.type === 'presence') {
          this.setData({ 'room.online': event.online })
        } else if (event.type === 'announcement') {
          this.setData({ 'room.announcement': event.announcement })
        } else if (event.type === 'left') {
          this.loseMembership()
        } else if (event.type === 'error') {
          this.scheduleReconnect()
        }
      }, () => {
        if (this.liveKey === key) this.scheduleReconnect()
      })
    } catch (_) {
      if (this.liveKey === key) this.scheduleReconnect()
    }
  },
  stopLive() {
    this.liveKey = null
    if (this.closeLive) this.closeLive()
    this.closeLive = null
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.catchupTimer)
    this.reconnectTimer = null
    this.catchupTimer = null
  },
  scheduleReconnect() {
    if (this.reconnectTimer) return
    this.stopLive()
    if (!this.visible || !this.timeline) return
    this.setData({ connection: '正在重连…' })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.refreshRoom()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(10000, this.reconnectDelay * 2)
  },
  async pullNew(state) {
    if (!state.ready || this.timeline !== state || !this.visible) return
    if (state.pulling) {
      state.pullAgain = true
      return
    }
    state.pulling = true
    clearTimeout(this.catchupTimer)
    this.catchupTimer = null
    let retry = false
    try {
      while (this.timeline === state && this.visible) {
        const after = state.tail
        const page = await api(`${this.historyPath}?after_seq=${after}&limit=${pageSize}`)
        if (this.timeline !== state || !this.visible) return
        if (page.length) this.receive(state, page)
        if (page.length < pageSize || after === state.tail) break
      }
      retry = state.hasGap()
    } catch (error) {
      if (this.timeline !== state) return
      if (membershipError(error)) this.refreshRoom()
      else retry = true
    } finally {
      state.pulling = false
      const again = state.pullAgain
      state.pullAgain = false
      if (retry && this.timeline === state && this.visible) {
        this.catchupTimer = setTimeout(() => this.pullNew(state), 2000)
      } else if (again) {
        this.pullNew(state)
      }
    }
  },
  receive(state, page) {
    const before = state.tail
    state.merge(page, this.userId)
    if (!state.ready) return
    const newer = before !== state.tail
    if (newer && !this.stick) this.setData({ newBelow: true })
    this.render(state, { bottom: newer && this.stick })
  },
  leaveState() {
    const room = this.data.room
    if (room) this.applyRoom({ ...room, joined: false, members: [] })
    this.setData({ sheet: false })
  },
  loseMembership() {
    this.leaveState()
    this.refreshRoom()
  },
  render(state, { anchor, bottom = false } = {}) {
    if (this.timeline !== state) return
    let lastTime = ''
    const rows = state.ready ? state.ordered() : []
    const messages = rows.map(message => {
      const hidden = concealed(message)
      const own = !hidden && String(message.sender_id) === this.userId
      const label = time(message.created_at, true)
      const timestamp = lastTime === label ? '' : label
      lastTime = label
      return {
        key: `m-${message.seq}`, seq: message.seq, timestamp, own, hidden,
        sender: hidden ? '' : message.nickname, senderId: hidden ? '' : String(message.sender_id || ''),
        avatar: hidden || own ? '' : avatar(message.avatar_key), mbti: hidden ? '' : message.mbti,
        picture: !hidden ? mediaUrl(message.media_url) : '', text: messageText(message)
      }
    })
    for (const pending of state.pending.values()) {
      messages.push({ key: `p-${pending.id}`, pending: pending.id, sending: pending.status === 'sending',
        failed: pending.status === 'failed', own: true, text: pending.body, picture: pending.path })
    }
    if (bottom) this.stick = true
    const first = rows[0]
    const updates = { messages, hasOlder: !state.noOlder && Boolean(first && compare(first.seq, next(state.joinedSeq)) > 0) }
    if (bottom) {
      updates.scrollTarget = this.data.scrollTarget === 'end-a' ? 'end-b' : 'end-a'
      updates.newBelow = false
    } else if (anchor) updates.scrollTarget = anchor
    else updates.scrollTarget = ''
    this.setData(updates, () => this.observe())
  },
  onScroll({ detail }) {
    if (!this.historyHeight) return
    this.stick = detail.scrollHeight - detail.scrollTop - this.historyHeight < 75
    if (this.stick && this.data.newBelow) this.setData({ newBelow: false })
  },
  jumpNewest() {
    if (this.timeline) this.render(this.timeline, { bottom: true })
  },
  disconnectObserver() {
    if (this.observer) this.observer.disconnect()
    this.observer = null
  },
  observe() {
    this.disconnectObserver()
    const state = this.timeline
    if (!state || !this.visible || this.data.sheet || !state.ready) return
    this.createSelectorQuery().select('.history').boundingClientRect(rect => {
      if (rect) this.historyHeight = rect.height
    }).exec()
    if (!this.data.messages.some(message => message.seq)) return
    const observer = this.createIntersectionObserver({ observeAll: true, thresholds: [0, 0.01] })
    this.observer = observer
    observer.relativeTo('.history').observe('.visible-message', result => {
      if (this.observer !== observer || this.timeline !== state || !this.visible || result.intersectionRatio <= 0) return
      const seq = result.dataset.seq
      if (seq) {
        state.visible(String(seq))
        this.queueRead(state)
      }
    })
    this.queueRead(state)
  },
  queueRead(state, delay = 260) {
    if (this.readTimer || state.reading || !this.visible || this.timeline !== state || state.readTarget() === state.readSeq) return
    this.readTimer = setTimeout(() => {
      this.readTimer = null
      this.flushRead(state)
    }, delay)
  },
  async flushRead(state) {
    if (!this.visible || this.timeline !== state) return
    const seq = state.readTarget()
    if (seq === state.readSeq) return
    state.reading = true
    let delay
    try {
      await api(`${this.roomPath}/read`, { method: 'POST', data: { seq, joined_at: state.joinedAt } })
      state.advanceRead(seq)
    } catch (error) {
      if (membershipError(error) && this.timeline === state) this.refreshRoom()
      delay = 2500
    } finally {
      state.reading = false
      this.queueRead(state, delay)
    }
  },
  onInput(event) { this.setData({ draft: event.detail.value }) },
  sameRound(state) { return this.timeline && this.timeline.joinedAt === state.joinedAt },
  async sendText() {
    const state = this.timeline
    const draft = this.data.draft
    const body = draft.trim()
    if (!state || !body || this.allocating) return
    this.allocating = true
    try {
      const id = await messageId()
      if (!this.sameRound(state)) return
      if (this.data.draft === draft) this.setData({ draft: '' })
      this.send({ id, body, kind: 'text' }, state)
    } catch (error) {
      errorToast(error)
    } finally {
      this.allocating = false
    }
  },
  async sendImage() {
    const state = this.timeline
    if (!state || this.choosing) return
    this.choosing = true
    try {
      const file = await chooseImage()
      if (!file || !this.sameRound(state)) return
      if (file.size > 8 * 1024 * 1024) throw new Error('图片不能超过 8 MB')
      const id = await messageId()
      if (this.sameRound(state)) this.send({ id, path: file.tempFilePath, kind: 'image' }, state)
    } catch (error) {
      errorToast(error)
    } finally {
      this.choosing = false
    }
  },
  retrySend(event) {
    const state = this.timeline
    const pending = state && state.pending.get(event.currentTarget.dataset.pending)
    if (pending && pending.status === 'failed') this.send(pending, state)
  },
  async send(pending, round) {
    const active = this.timeline
    pending.status = 'sending'
    active.pending.set(pending.id, pending)
    this.render(active, { bottom: true })
    try {
      if (pending.kind === 'image' && !pending.mediaKey) {
        const image = await readImage(pending.path)
        if (!this.sameRound(round)) return
        const upload = await api(`${this.roomPath}/media`, { method: 'PUT', ...image })
        pending.mediaKey = upload.media_key
      }
      if (!this.sameRound(round)) return
      const payload = { client_msg_id: pending.id, kind: pending.kind }
      if (pending.kind === 'image') payload.media_key = pending.mediaKey
      else payload.body = pending.body
      const message = await api(this.historyPath, { method: 'POST', data: payload })
      if (!this.sameRound(round)) return
      const timeline = this.timeline
      timeline.pending.delete(pending.id)
      this.receive(timeline, [message])
      if (timeline.hasGap()) this.pullNew(timeline)
    } catch (error) {
      if (!this.sameRound(round)) return
      const timeline = this.timeline
      if (!timeline.pending.has(pending.id)) return
      pending.status = 'failed'
      this.render(timeline)
      if (this.visible) errorToast(error)
      if (membershipError(error)) this.refreshRoom()
    }
  },
  async freshImage(state, seq) {
    const page = await api(`${this.historyPath}?after_seq=${previous(seq)}&limit=1`)
    if (this.timeline !== state || !page.length || String(page[0].seq) !== seq) return ''
    this.receive(state, page)
    const message = state.rows.get(seq)
    return message && !concealed(message) ? mediaUrl(message.media_url) : ''
  },
  async imageError(event) {
    const state = this.timeline
    const seq = String(event.currentTarget.dataset.seq || '')
    if (!state || !seq || state.imageErrors.has(seq)) return
    state.imageErrors.add(seq)
    try { await this.freshImage(state, seq) } catch (_) { /* A tap can explicitly request a new image URL. */ }
  },
  async previewImage(event) {
    const state = this.timeline
    const { seq, pending } = event.currentTarget.dataset
    if (!state) return
    try {
      const item = state.pending.get(pending)
      const url = seq ? await this.freshImage(state, String(seq)) : item && item.path
      if (url) wx.previewImage({ current: url, urls: [url] })
      else if (this.timeline === state) throw new Error('图片暂不可用')
    } catch (error) {
      errorToast(error)
    }
  },
  openSheet() {
    if (!this.data.room) return
    this.disconnectObserver()
    this.setData({ sheet: true })
  },
  closeSheet() { this.setData({ sheet: false }, () => this.observe()) },
  async join() {
    if (this.data.roomBusy) return
    this.setData({ roomBusy: true, sheet: false })
    this.refreshKey = null
    try { this.applyRoom(await api(`${this.roomPath}/join`, { method: 'POST', data: {} })) }
    catch (error) { errorToast(error) }
    finally { this.setData({ roomBusy: false }) }
  },
  async leave() {
    if (this.data.roomBusy || !(await confirm('退出聊天室', '再次加入时，只能看到新一轮加入后的消息。'))) return
    this.setData({ roomBusy: true })
    this.refreshKey = null
    try {
      await api(`${this.roomPath}/leave`, { method: 'POST', data: {} })
      this.loseMembership()
    } catch (error) { errorToast(error) }
    finally { this.setData({ roomBusy: false }) }
  },
  async favorite() {
    if (this.data.roomBusy) return
    const enabled = !this.data.room.favorite
    this.setData({ roomBusy: true })
    try {
      await api(`${this.roomPath}/favorite`, { method: 'PUT', data: { enabled } })
      this.setData({ 'room.favorite': enabled })
    } catch (error) { errorToast(error) }
    finally { this.setData({ roomBusy: false }) }
  },
  async blockMember(event) {
    const id = ownerId(event)
    const label = event.currentTarget.dataset.label || '该成员'
    if (!id || id === this.userId || this.data.roomBusy) return
    this.setData({ roomBusy: true })
    try {
      const blocked = await api('/api/blocks')
      const enabled = !blocked.some(user => String(user.id) === id)
      if (!(await confirm(enabled ? '拉黑成员' : '解除拉黑', enabled ? `拉黑「${label}」后，该成员的消息将显示为占位提示。` : `确定解除对「${label}」的拉黑？`))) return
      await api(`/api/blocks/${id}`, { method: 'PUT', data: { enabled } })
      const state = this.timeline
      if (state) this.applyRoom({ ...this.data.room, last_read_seq: state.readSeq }, true)
      wx.showToast({ title: enabled ? '已拉黑' : '已解除拉黑' })
    } catch (error) { errorToast(error) }
    finally { this.setData({ roomBusy: false }) }
  }
})
