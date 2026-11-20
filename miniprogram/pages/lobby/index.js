const { api } = require('../../lib/api')
const { cover, enterRoom, setTab } = require('../../lib/ui')

Page({
  data: {
    q: '', category: '', rooms: [], loaded: false, error: '',
    categories: [
      { code: '', label: '全部' }, { code: 'casual', label: '闲聊' },
      { code: 'interest', label: '兴趣' }, { code: 'mbti', label: 'MBTI' }
    ]
  },
  onShow() {
    setTab(this, 0)
    this.load()
  },
  onHide() {
    clearTimeout(this.searchTimer)
    this.loadKey = null
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },
  search(event) {
    this.setData({ q: event.detail.value })
    this.loadKey = null
    clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => this.load(), 250)
  },
  submitSearch() {
    clearTimeout(this.searchTimer)
    this.load()
  },
  filter(event) {
    clearTimeout(this.searchTimer)
    this.setData({ category: event.currentTarget.dataset.code })
    this.load()
  },
  async load() {
    const key = {}
    this.loadKey = key
    const { q, category } = this.data
    try {
      const rooms = await api(`/api/rooms?q=${encodeURIComponent(q.trim())}&category=${encodeURIComponent(category)}`)
      if (this.loadKey === key) this.setData({ loaded: true, error: '', rooms: rooms.map(room => ({ ...room, cover: cover(room.cover_key) })) })
    } catch (error) {
      if (this.loadKey === key) this.setData({ loaded: true, error: error.message, rooms: [] })
    }
  },
  enterRoom
})
