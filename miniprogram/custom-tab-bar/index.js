Component({
  data: {
    selected: 0,
    tabs: [
      { path: '/pages/lobby/index', label: '大厅', icon: 'house' },
      { path: '/pages/messages/index', label: '消息', icon: 'chat' },
      { path: '/pages/profile/index', label: '我的', icon: 'person' }
    ]
  },
  methods: {
    select(event) {
      const index = Number(event.currentTarget.dataset.index)
      if (index !== this.data.selected) wx.switchTab({ url: this.data.tabs[index].path })
    }
  }
})
