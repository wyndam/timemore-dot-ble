const app = getApp()
const ble = app.globalData.ble

Page({
  data: {
    statusBarHeight: 0, headerRight: 0,
    connected: false,
    connecting: false,
    deviceName: '未连接',
    weight: '0.0',
    connectBtnText: '连接电子秤'
  },

  _weightCb: null,
  _connectCb: null,
  _disconnectCb: null,

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, headerRight: app.globalData.capsulePaddingRight || 100 })

    this._weightCb = (w) => {
      this.setData({ weight: w.toFixed(1) })
    }
    this._connectCb = (info) => {
      this.setData({
        connected: true,
        connecting: false,
        deviceName: info.deviceName,
        connectBtnText: '断开连接'
      })
    }
    this._disconnectCb = () => {
      this.setData({
        connected: false,
        connecting: false,
        deviceName: '未连接',
        weight: '0.0',
        connectBtnText: '连接电子秤'
      })
    }

    ble.onWeight(this._weightCb)
    ble.onConnect(this._connectCb)
    ble.onDisconnect(this._disconnectCb)
  },

  onShow() {
    // 刷新连接状态
    if (ble.connected) {
      this.setData({
        connected: true,
        deviceName: ble.deviceName || 'TIMEMORE',
        connectBtnText: '断开连接'
      })
    } else {
      this.setData({
        connected: false,
        deviceName: '未连接',
        connectBtnText: '连接电子秤'
      })
    }
  },

  onUnload() {
    ble.offWeight(this._weightCb)
    ble.offConnect(this._connectCb)
    ble.offDisconnect(this._disconnectCb)
  },

  async onConnect() {
    if (this.data.connecting) return

    if (ble.connected) {
      await ble.disconnect()
      return
    }

    this.setData({
      connecting: true,
      deviceName: '扫描中...',
      connectBtnText: '搜索中...'
    })

    try {
      await ble.connect()
    } catch (e) {
      wx.showToast({ title: e.message || '连接失败', icon: 'none' })
      this.setData({
        connecting: false,
        deviceName: '连接失败',
        connectBtnText: '连接电子秤'
      })
    }
  },

  async onTare() {
    if (!ble.connected) return
    await ble.sendTare()
  },

  enterBrewMode() {
    if (!ble.connected) return
    wx.navigateTo({ url: '/pages/brew/brew' })
  },

  enterEspressoMode() {
    if (!ble.connected) return
    wx.navigateTo({ url: '/pages/espresso/espresso' })
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  }
})
