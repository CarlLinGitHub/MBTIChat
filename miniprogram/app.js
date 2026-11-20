const { restoreSession } = require('./lib/api')

App({
  onLaunch({ path } = {}) {
    if (!path || path === 'pages/login/index' || path === 'pages/onboarding/index') return
    const redirect = url => {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      if (!current || current.route === path) wx.reLaunch({ url })
    }
    restoreSession().then(user => {
      if (!user) redirect('/pages/login/index')
      else if (!user.mbti) redirect('/pages/onboarding/index')
      else if (path === 'pages/quiz/index') redirect('/pages/lobby/index')
    }, () => redirect('/pages/login/index'))
  }
})
