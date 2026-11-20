const { localDemo, restoreSession, signIn, signInWechat } = require('../../lib/api')

const accounts = [
  { id: 'new', label: '新用户' },
  { id: 'chestnut', label: '栗子' },
  { id: 'lin', label: '小林' },
  { id: 'zhou', label: '阿舟' }
]

const policies = {
  agreement: {
    title: '用户协议 · 本地使用说明',
    paragraphs: [
      '这是用于本地开发与演示的版本，不是正式上线服务。已有演示账号使用预设身份，不用于验证真实身份。',
      '请使用虚构资料和测试内容，不要输入真实身份、联系方式、密码或他人的个人信息，不要上传敏感图片。',
      '请选择自己的 MBTI，或用简短测验获得参考建议。测验不是专业心理评估。'
    ]
  },
  privacy: {
    title: '隐私政策 · 本地数据说明',
    paragraphs: [
      '小程序在本机缓存会话凭据，用于恢复登录。使用微信登录时，小程序向服务发送微信临时登录码；选择本地演示账号不需要微信登录。',
      '资料、MBTI、聊天记录和反馈保存在配置的服务端数据库中，图片保存在服务端媒体目录。向聊天室发送的内容可被有权查看该消息的成员看到。',
      '清除小程序缓存可移除设备上的会话凭据，不会删除服务端数据。本地开发者可重置项目的数据库和媒体卷以清除本地服务数据。'
    ]
  }
}

Page({
  data: {
    localDemo, accounts, agreed: false, pending: '', error: '', retry: '', destination: '',
    dialog: '', dialogTitle: '', paragraphs: []
  },
  onLoad() { this.resume() },
  onUnload() { this.unloaded = true },
  async resume() {
    if (this.data.pending || this.data.destination) return
    this.setData({ pending: 'resume', error: '', retry: '' })
    try {
      const user = await restoreSession()
      if (this.unloaded) return
      if (user) this.enter(user)
      else this.setData({ pending: '' })
    } catch (error) {
      if (!this.unloaded) this.setData({ pending: '', error: error.message || '无法恢复登录，请重试。', retry: 'resume' })
    }
  },
  enter(user) {
    this.setData({ destination: user.mbti ? '/pages/lobby/index' : '/pages/onboarding/index', pending: '' })
    this.openDestination()
  },
  openDestination() {
    if (this.data.pending || !this.data.destination) return
    this.setData({ pending: 'route', error: '', retry: '' })
    wx.reLaunch({
      url: this.data.destination,
      fail: () => {
        if (!this.unloaded) this.setData({ pending: '', error: '无法打开页面，请重试。', retry: 'route' })
      }
    })
  },
  changeConsent(event) {
    const agreed = event.detail.value.includes('agree')
    const update = { agreed }
    if (agreed && this.data.retry === 'consent') Object.assign(update, { error: '', retry: '' })
    this.setData(update)
  },
  canSignIn() {
    if (this.data.pending || this.data.destination) return false
    if (this.data.agreed) return true
    this.setData({ error: '请先阅读并勾选同意。', retry: 'consent' })
    return false
  },
  loginWechat() {
    if (this.canSignIn()) this.authenticate('wechat', signInWechat)
  },
  openAccounts() {
    if (!localDemo || !this.canSignIn()) return
    this.setData({ dialog: 'accounts', dialogTitle: '选择本地演示账号' })
  },
  loginAccount(event) {
    if (!localDemo || !this.canSignIn()) return
    const account = event.currentTarget.dataset.account
    this.closeDialog()
    this.authenticate('account', () => signIn(account))
  },
  async authenticate(pending, signInAction) {
    this.setData({ pending, error: '', retry: '' })
    try {
      const { user } = await signInAction()
      if (!this.unloaded) this.enter(user)
    } catch (error) {
      if (!this.unloaded) this.setData({ pending: '', error: error.message || '登录失败，请重试。', retry: pending })
    }
  },
  openPolicy(event) {
    const policy = policies[event.currentTarget.dataset.policy]
    this.setData({ dialog: 'policy', dialogTitle: policy.title, paragraphs: policy.paragraphs })
  },
  closeDialog() { this.setData({ dialog: '' }) }
})
