const app = getApp()
const historyUtil = require('../../utils/history')

Page({
  data: {
    statusBarHeight: 0, headerRight: 0,
    records: []
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, headerRight: app.globalData.capsulePaddingRight || 100 })
  },

  onShow() {
    this._loadHistory()
  },

  _loadHistory() {
    const history = historyUtil.load()
    const records = history.map(r => ({
      recipe: r.recipe || '自定义冲煮',
      type: r.type,
      typeLabel: r.type === 'espresso' ? '☕ ' : '',
      coffeeWeightText: (Number(r.coffeeWeight) || 0).toFixed(1) + 'g',
      maxWeightText: (Number(r.maxWeight) || 0).toFixed(0) + 'g',
      durationText: historyUtil.formatDuration(Number(r.duration) || 0),
      timeText: historyUtil.formatHistoryTime(r.date)
    }))
    this.setData({ records })
  },

  showDetail(e) {
    const index = e.currentTarget.dataset.index
    wx.navigateTo({ url: '/pages/history-detail/history-detail?index=' + index })
  },

  clearAll() {
    const history = historyUtil.load()
    if (history.length === 0) return
    wx.showModal({
      title: '提示',
      content: '确定清空所有历史记录？',
      success: (res) => {
        if (res.confirm) {
          historyUtil.clearAll()
          this._loadHistory()
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
