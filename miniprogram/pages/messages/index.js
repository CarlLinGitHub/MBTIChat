const { api } = require('../../lib/api')
const { cover, time, messageText, enterRoom, setTab } = require('../../lib/ui')

Page({
  data: { unread: false, conversations: [], loaded: false, error: '' },
  onShow() {
    setTab(this, 1)
    this.load()
  },
  onHide() { this.loadKey = null },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },
  filter(event) {
    const unread = event.currentTarget.dataset.mode === 'unread'
    if (unread === this.data.unread) return
    this.setData({ unread, loaded: false, conversations: [] })
    this.load()
  },
  async load() {
    const key = {}
    this.loadKey = key
    try {
      const rooms = await api(this.data.unread ? '/api/conversations?unread=1' : '/api/conversations')
      if (this.loadKey !== key) return
      const conversations = rooms.map(room => {
        const preview = room.preview
        const sender = preview && !preview.placeholder && preview.state === 'visible' && preview.nickname
        const count = String(room.unread_count)
        return {
          ...room,
          cover: cover(room.cover_key),
          activity: time(room.activity_at, true),
          summary: preview ? `${sender ? sender + '：' : ''}${messageText(preview)}` : '还没有消息',
          badge: count === '0' ? '' : count.length > 2 ? '99+' : count
        }
      })
      this.setData({ loaded: true, error: '', conversations })
    } catch (error) {
      if (this.loadKey === key) this.setData({ loaded: true, error: error.message, conversations: [] })
    }
  },
  enterRoom
})
