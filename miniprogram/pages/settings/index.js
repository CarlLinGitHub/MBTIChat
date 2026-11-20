const { api } = require('../../lib/api')
const { cover, avatars, avatar, confirm, enterRoom, errorToast } = require('../../lib/ui')

const titles = {
  edit: '编辑资料', favorites: '收藏的聊天室', notifications: '消息通知',
  privacy: '隐私设置', blocks: '黑名单', help: '帮助与反馈'
}
const types = ['未设置', 'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ']

Page({
  data: {
    view: '', list: [], form: null, feedback: '', busy: false, loaded: false, error: '',
    types, avatarChoices: avatars.map(key => ({ key, src: avatar(key) }))
  },
  onLoad({ view }) {
    if (!Object.prototype.hasOwnProperty.call(titles, view)) return wx.navigateBack()
    this.setData({ view })
    wx.setNavigationBarTitle({ title: titles[view] })
  },
  onShow() {
    const { view, loaded } = this.data
    if (view && (!loaded || view === 'favorites' || view === 'blocks')) this.load()
  },
  async load() {
    const { view } = this.data
    try {
      const data = { loaded: true, error: '' }
      if (view === 'favorites') {
        data.list = (await api('/api/favorites')).map(room => ({ ...room, cover: cover(room.cover_key) }))
      } else if (view === 'blocks') {
        data.list = (await api('/api/blocks')).map(user => ({ ...user, avatar: avatar(user.avatar_key) }))
      } else if (view !== 'help') {
        const user = await api('/api/me')
        data.form = {
          nickname: user.nickname, bio: user.bio, avatar_key: user.avatar_key,
          mbtiIndex: Math.max(0, types.indexOf(user.mbti)),
          show_mbti: Boolean(user.show_mbti), notifications_enabled: Boolean(user.notifications_enabled)
        }
      }
      this.setData(data)
    } catch (error) {
      this.setData({ loaded: true, error: error.message })
    }
  },
  enterRoom,
  changeType(event) { this.setData({ 'form.mbtiIndex': Number(event.detail.value) }) },
  changeAvatar(event) { this.setData({ 'form.avatar_key': event.currentTarget.dataset.key }) },
  changeField(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  feedbackInput(event) { this.setData({ feedback: event.detail.value }) },
  async saveProfile() {
    if (this.data.busy) return
    const { nickname, bio, mbtiIndex, avatar_key } = this.data.form
    if (!nickname.trim()) return errorToast(new Error('请输入昵称'))
    this.setData({ busy: true })
    try {
      const saved = await api('/api/me', { method: 'PATCH', data: { nickname: nickname.trim(), bio: bio.trim(), mbti: mbtiIndex ? types[mbtiIndex] : null, avatar_key } })
      if (saved.mbti) wx.navigateBack()
      else wx.reLaunch({ url: '/pages/onboarding/index' })
    } catch (error) {
      errorToast(error)
    } finally {
      this.setData({ busy: false })
    }
  },
  async toggle(event) {
    if (this.data.busy) return
    const { field } = event.currentTarget.dataset
    const value = event.detail.value
    const previous = this.data.form[field]
    this.setData({ busy: true, [`form.${field}`]: value })
    try {
      await api('/api/me', { method: 'PATCH', data: { [field]: value } })
    } catch (error) {
      this.setData({ [`form.${field}`]: previous })
      errorToast(error)
    } finally {
      this.setData({ busy: false })
    }
  },
  async remove(event) {
    if (this.data.busy) return
    const { id, label } = event.currentTarget.dataset
    const favorite = this.data.view === 'favorites'
    if (!favorite && !(await confirm('解除拉黑', `确定解除对「${label}」的拉黑？`))) return
    this.setData({ busy: true })
    try {
      const path = favorite ? `/api/rooms/${id}/favorite` : `/api/blocks/${id}`
      await api(path, { method: 'PUT', data: { enabled: false } })
      this.setData({ list: this.data.list.filter(item => String(item.id) !== String(id)) })
    } catch (error) {
      errorToast(error)
    } finally {
      this.setData({ busy: false })
    }
  },
  async submitFeedback() {
    if (this.data.busy || !this.data.feedback.trim()) return
    this.setData({ busy: true })
    try {
      await api('/api/feedback', { method: 'POST', data: { body: this.data.feedback.trim() } })
      this.setData({ feedback: '' })
      wx.showToast({ title: '反馈已提交' })
    } catch (error) {
      errorToast(error)
    } finally {
      this.setData({ busy: false })
    }
  }
})
