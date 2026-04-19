const app = getApp()
const historyUtil = require('../../utils/history')

Page({
  data: {
    statusBarHeight: 0, headerRight: 0,
    title: '冲煮详情',
    type: '',
    coffeeWeightText: '',
    maxWeightText: '',
    durationText: '',
    avgFlowText: '',
    hasData: false
  },

  _index: -1,
  _record: null,

  onLoad(options) {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, headerRight: app.globalData.capsulePaddingRight || 100 })
    this._index = parseInt(options.index) || 0
    this._record = historyUtil.getRecord(this._index)
    if (!this._record) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }
    this._renderDetail()
  },

  onReady() {
    if (this._record && this._record.data && this._record.data.length >= 2) {
      this._drawChart()
    }
  },

  _renderDetail() {
    const r = this._record
    let avgFlow = 0
    if (r.data && r.data.length > 0) {
      const flows = r.data.filter(d => d.flow > 0).map(d => d.flow)
      avgFlow = flows.length > 0 ? flows.reduce((a, b) => a + b, 0) / flows.length : 0
    }

    this.setData({
      title: r.recipe || '冲煮详情',
      type: r.type || '',
      coffeeWeightText: (Number(r.coffeeWeight) || 0).toFixed(1) + 'g',
      maxWeightText: (Number(r.maxWeight) || 0).toFixed(1) + 'g',
      durationText: historyUtil.formatDuration(Number(r.duration) || 0),
      avgFlowText: avgFlow.toFixed(1) + 'g/s',
      hasData: !!(r.data && r.data.length >= 2)
    })
  },

  _drawChart() {
    const query = this.createSelectorQuery()
    query.select('#historyChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio
        canvas.width = res[0].width * dpr
        canvas.height = res[0].height * dpr
        ctx.scale(dpr, dpr)

        const w = res[0].width
        const h = res[0].height
        const data = this._record.data || []

        ctx.fillStyle = '#0d0d0d'
        ctx.fillRect(0, 0, w, h)

        if (data.length < 2) {
          ctx.fillStyle = '#555'
          ctx.font = '12px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('无数据', w / 2, h / 2)
          return
        }

        ctx.fillStyle = '#444'
        ctx.font = '9px sans-serif'
        ctx.textAlign = 'center'

        const maxTime = Math.max(...data.map(d => d.time), 60)
        for (let t = 0; t <= maxTime; t += 30) {
          const x = (t / maxTime) * w
          ctx.fillText(this._formatTime(t), x, h - 2)
        }

        const weights = data.map(d => d.weight)
        const maxW = Math.max(...weights, 100)
        const minW = Math.min(...weights, 0)
        const rangeW = maxW - minW + 20

        ctx.strokeStyle = '#4ade80'
        ctx.lineWidth = 2
        ctx.beginPath()
        data.forEach((d, i) => {
          const x = (d.time / maxTime) * w
          const y = h - ((d.weight - minW + 10) / rangeW) * (h - 16) * 0.9 - 14
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      })
  },

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    if (m > 0) return m + "'" + s.toString().padStart(2, '0')
    return s + 's'
  },

  deleteRecord() {
    wx.showModal({
      title: '提示',
      content: '确定删除此记录？',
      success: (res) => {
        if (res.confirm) {
          historyUtil.deleteRecord(this._index)
          wx.navigateBack()
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
