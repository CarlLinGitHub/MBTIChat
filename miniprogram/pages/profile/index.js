const { api, signIn, signOut, localDemo, getAccount } = require('../../lib/api')
const { avatar, errorToast, setTab } = require('../../lib/ui')

const accounts = [
  { id: 'new', label: '新用户' },
  { id: 'chestnut', label: '栗子' },
  { id: 'lin', label: '小林' },
  { id: 'zhou', label: '阿舟' }
]

Page({
  data: {
    user: null, account: '', error: '', switching: false, localDemo,
    groups: [
      { key: 'favorites', items: [{ view: 'favorites', icon: 'favorite', label: '收藏的聊天室' }, { view: 'notifications', icon: 'bell', label: '消息通知' }] },
      { key: 'privacy', items: [{ view: 'privacy', icon: 'shield', label: '隐私设置' }, { view: 'blocks', icon: 'block', label: '黑名单' }, { view: 'help', icon: 'help', label: '帮助与反馈' }] }
    ]
  },
  onShow() {
    setTab(this, 2)
    const current = accounts.find(item => item.id === getAccount())
    this.setData({ account: current ? current.label : '' })
    this.load()
  },
  onHide() { this.loadKey = null },
  async load() {
    const key = {}
    this.loadKey = key
    try {
      const user = await api('/api/me')
      if (this.loadKey === key) this.setData({ user: { ...user, avatar: avatar(user.avatar_key) }, error: '' })
    } catch (error) {
      if (this.loadKey === key) this.setData({ error: error.message })
    }
  },
  open(event) {
    if (!this.data.switching) wx.navigateTo({ url: `/pages/settings/index?view=${event.currentTarget.dataset.view}` })
  },
  switchAccount() {
    if (this.data.switching) return
    const choices = accounts.filter(item => item.id !== getAccount())
    wx.showActionSheet({
      itemList: choices.map(item => `切换为${item.label}`),
      success: async ({ tapIndex }) => {
        this.setData({ switching: true })
        try {
          const { user } = await signIn(choices[tapIndex].id)
          wx.reLaunch({ url: user.mbti ? '/pages/profile/index' : '/pages/onboarding/index' })
        } catch (error) {
          this.setData({ switching: false })
          errorToast(error)
        }
      }
    })
  },
  logout() {
    if (this.data.switching) return
    signOut()
    wx.reLaunch({ url: '/pages/login/index' })
  }
})
