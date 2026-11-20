const origin = 'http://127.0.0.1:8080'
const localDemo = true
const storageKey = 'mbtichat.session'
let session = wx.getStorageSync(storageKey) || null
let restorePromise = null

function request(path, { method = 'GET', data, token, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const header = { 'content-type': contentType || 'application/json' }
    if (token) header.Authorization = `Bearer ${token}`
    wx.request({
      url: origin + path, method, data, header, timeout: 15000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
          return
        }
        const error = new Error((res.data && res.data.error) || `请求失败 (${res.statusCode})`)
        error.status = res.statusCode
        reject(error)
      },
      fail() { reject(new Error('无法连接服务，请检查网络后重试')) }
    })
  })
}

function remember(value, account) {
  session = { ...value, account }
  // Cache the credential, not the user's onboarding status.
  wx.setStorageSync(storageKey, { token: session.token, account })
  return session
}

function signOut() {
  session = null
  wx.removeStorageSync(storageKey)
}

async function signIn(account) {
  return remember(await request('/api/session', { method: 'POST', data: { account } }), account)
}

async function signInWechat() {
  const code = await new Promise((resolve, reject) => wx.login({
    success: result => result.code ? resolve(result.code) : reject(new Error('未获取到微信登录凭证')),
    fail: () => reject(new Error('微信登录失败，请重试'))
  }))
  return remember(await request('/api/session', { method: 'POST', data: { code } }), null)
}

function restoreSession() {
  if (!session) return Promise.resolve(null)
  if (session.user) return Promise.resolve(session.user)
  if (restorePromise) return restorePromise
  const active = session
  restorePromise = request('/api/me', { token: active.token }).then(user => {
    if (session === active) session = { ...active, user }
    return session?.user || null
  }).catch(error => {
    if (error.status !== 401) throw error
    if (session === active) signOut()
    return session?.user || null
  }).finally(() => { restorePromise = null })
  return restorePromise
}

function redirect(url) {
  const pages = getCurrentPages()
  if (pages[pages.length - 1]?.route !== url.slice(1)) wx.reLaunch({ url })
}

async function getSession() {
  if (await restoreSession() && session) return session
  redirect('/pages/login/index')
  throw new Error('请先登录')
}

async function api(path, options = {}) {
  const active = await getSession()
  if (!active.user.mbti && path !== '/api/me') {
    redirect('/pages/onboarding/index')
    throw new Error('请先设置 MBTI')
  }
  try {
    const result = await request(path, { ...options, token: active.token })
    if (session?.token === active.token && path === '/api/me') session = { ...session, user: result }
    return result
  } catch (error) {
    if (error.status === 401 && session?.token === active.token) {
      signOut()
      redirect('/pages/login/index')
    }
    throw error
  }
}

function connectRoom() {
  return wx.connectSocket({ url: origin.replace(/^http/, 'ws') + '/ws', fail() {} })
}

function mediaUrl(value) {
  if (!value || /^https?:\/\//i.test(value)) return value || ''
  return `${origin}/${value.replace(/^\/+/, '')}`
}

module.exports = { api, localDemo, signIn, signInWechat, signOut, restoreSession, getSession, connectRoom, mediaUrl, getAccount: () => session?.account }
