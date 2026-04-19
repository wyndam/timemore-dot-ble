const ble = require('./utils/ble')

App({
  globalData: {
    ble: ble,
    currentRecipeId: null,
    statusBarHeight: 0
  },

  onLaunch() {
    const sysInfo = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sysInfo.statusBarHeight || 20
    // 胶囊按钮右侧安全区（从屏幕右边到胶囊左侧的距离 + buffer）
    try {
      const mb = wx.getMenuButtonBoundingClientRect()
      this.globalData.capsulePaddingRight = (sysInfo.windowWidth - mb.left) + 8
    } catch(e) {
      this.globalData.capsulePaddingRight = 100
    }
  }
})
