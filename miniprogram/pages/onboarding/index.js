const { api, signOut } = require('../../lib/api')

const types = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP'
]

Page({
  data: { types, selected: '', ready: false, pending: '', error: '', destination: '' },
  onLoad() { this.loadUser() },
  onShow() {
    if (wx.hideHomeButton) wx.hideHomeButton()
  },
  onUnload() { this.unloaded = true },
  async loadUser() {
    if (this.data.pending || this.data.destination) return
    this.setData({ pending: 'load', error: '' })
    try {
      const user = await api('/api/me')
      if (this.unloaded) return
      if (user.mbti) this.leave('/pages/lobby/index')
      else this.setData({ ready: true, pending: '' })
    } catch (error) {
      this.requestFailed(error, '无法加载资料，请重试。')
    }
  },
  select(event) {
    if (!this.canChoose()) return
    this.setData({ selected: event.currentTarget.dataset.type, error: '' })
  },
  canChoose() {
    const { ready, pending, destination } = this.data
    return ready && !pending && !destination
  },
  openQuiz() {
    if (!this.canChoose()) return
    this.setData({ pending: 'quiz', error: '' })
    wx.navigateTo({
      url: '/pages/quiz/index',
      events: {
        quizResult: ({ type }) => {
          if (!this.unloaded && types.includes(type)) this.setData({ selected: type, error: '' })
        }
      },
      success: () => {
        if (!this.unloaded) this.setData({ pending: '' })
      },
      fail: () => {
        if (!this.unloaded) this.setData({ pending: '', error: '无法打开测验，请重试。' })
      }
    })
  },
  async confirmType() {
    const mbti = this.data.selected
    if (!this.canChoose() || !mbti) return
    this.setData({ pending: 'save', error: '' })
    try {
      await api('/api/me', { method: 'PATCH', data: { mbti } })
      if (!this.unloaded) this.leave('/pages/lobby/index')
    } catch (error) {
      this.requestFailed(error, '无法保存 MBTI，请重试。')
    }
  },
  requestFailed(error, fallback) {
    if (this.unloaded) return
    this.setData({ pending: '', error: error.message || fallback })
  },
  async returnToLogin() {
    if (this.data.pending || this.data.destination) return
    this.setData({ pending: 'signout', error: '' })
    try {
      await signOut()
      if (!this.unloaded) this.leave('/pages/login/index')
    } catch (error) {
      this.requestFailed(error, '无法退出登录，请重试。')
    }
  },
  leave(destination) {
    this.setData({ destination, pending: '' })
    this.openDestination()
  },
  openDestination() {
    if (this.data.pending || !this.data.destination) return
    this.setData({ pending: 'route', error: '' })
    wx.reLaunch({
      url: this.data.destination,
      fail: () => {
        if (!this.unloaded) this.setData({ pending: '', error: '无法打开页面，请重试。' })
      }
    })
  }
})
