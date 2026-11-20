const covers = ['tea', 'planet', 'ticket', 'lamp']
const avatars = ['chestnut', 'lin', 'zhou', 'youzi']

function cover(key) {
  return covers.includes(key) ? `/assets/${key}.png` : ''
}

function avatar(key) {
  return avatars.includes(key) ? `/assets/${key}.png` : ''
}

function time(value, dateLabel = false) {
  const source = value == null ? '' : String(value)
  const normalized = source.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  const result = new Date(normalized && !/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized + 'Z' : normalized)
  if (Number.isNaN(result.getTime())) return ''
  const now = new Date()
  if (dateLabel && result.toDateString() !== now.toDateString()) {
    now.setDate(now.getDate() - 1)
    if (result.toDateString() === now.toDateString()) return '昨天'
    return `${result.getMonth() + 1}/${result.getDate()}`
  }
  return `${String(result.getHours()).padStart(2, '0')}:${String(result.getMinutes()).padStart(2, '0')}`
}

function messageText(message) {
  if (typeof message.placeholder === 'string' && message.placeholder) return message.placeholder
  if (message.state === 'recalled') return '消息已撤回'
  if (message.placeholder || message.state === 'hidden') return '消息不可见'
  return message.kind === 'image' ? '[图片]' : (message.body || '')
}

function errorToast(error) {
  wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none' })
}

function enterRoom(event) {
  wx.navigateTo({ url: `/pages/room/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` })
}

function setTab(page, selected) {
  const tab = page.getTabBar && page.getTabBar()
  if (tab) tab.setData({ selected })
}

function confirm(title, content) {
  return new Promise(resolve => wx.showModal({ title, content, success: reply => resolve(reply.confirm), fail: () => resolve(false) }))
}

module.exports = { covers, avatars, cover, avatar, time, messageText, errorToast, enterRoom, setTab, confirm }
