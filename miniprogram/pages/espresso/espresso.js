const app = getApp()
const ble = app.globalData.ble
const historyUtil = require('../../utils/history')
const audio = require('../../utils/audio')

const STATES = {
  IDLE: 'idle',
  COUNTDOWN: 'countdown',
  BREWING: 'brewing',
  END: 'end'
}

const PREINFUSION = 5 // 预浸泡时间（秒）
const STABLE_THRESHOLD = 1 // 稳定判定阈值（克）
const STABLE_CONFIRM_MS = 3000 // 稳定持续时间（毫秒，3秒确认）

Page({
  data: {
    statusBarHeight: 0, headerRight: 0,
    guideIcon: '☕',
    guideText: '意式浓缩',
    guideSub: '按下开始，记录萃取时长和出液重量',
    espressoWeight: '0.0',
    weightStatusText: '--',
    showTimer: false,
    timerValue: '00.0',
    tareBtnDisabled: false,
    mainBtnDisabled: false,
    mainBtnText: '开始萃取'
  },

  _state: STATES.IDLE,
  _startTime: 0,
  _timerInterval: null,
  _countdownInterval: null,
  _countdown: 0,
  _stableWeight: -999,
  _stableTime: 0,
  _lastSignificantChangeTime: 0, // 最后一次显著重量变化的时间（用于稳定判定的起点）
  _lastSignificantWeight: 0,
  _finalWeight: 0,
  _finalTime: 0,
  _currentWeight: 0,
  _weightCb: null,
  _disconnectCb: null,

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, headerRight: app.globalData.capsulePaddingRight || 100 })

    this._weightCb = (w) => this._onWeight(w)
    this._disconnectCb = () => {
      wx.showToast({ title: '电子秤已断开', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
    }
    ble.onWeight(this._weightCb)
    ble.onDisconnect(this._disconnectCb)
  },

  onUnload() {
    this._cleanup()
    ble.offWeight(this._weightCb)
    ble.offDisconnect(this._disconnectCb)
  },

  _onWeight(weight) {
    this._currentWeight = weight
    this.setData({ espressoWeight: weight.toFixed(1) })

    if (this._state === STATES.BREWING) {
      this._checkStable(weight)
    }
  },

  _checkStable(weight) {
    if (this._state !== STATES.BREWING) return
    if (weight < 2) return

    const now = Date.now()

    // 判断是否为显著变化（超过阈值）
    if (Math.abs(weight - this._lastSignificantWeight) > STABLE_THRESHOLD) {
      // 出现显著变化，更新最后一次显著变化时间和参考重量
      this._lastSignificantChangeTime = now
      this._lastSignificantWeight = weight
      return
    }

    // 非显著变化：如果自上次显著变化后已经持续稳定超过确认时间，则结束萃取
    if (this._lastSignificantChangeTime > 0 && (now - this._lastSignificantChangeTime) >= STABLE_CONFIRM_MS) {
      // 使用最后一次显著变化的时间作为稳定开始时间（即萃取时长的结束时刻）
      this._endBrew(this._lastSignificantChangeTime)
    }
  },

  async onMainAction() {
    switch (this._state) {
      case STATES.IDLE:
        await ble.sendTare()
        this._startCountdown()
        break
      case STATES.BREWING:
        this._endBrew()
        break
      case STATES.END:
        this._reset()
        break
    }
  },

  async onTare() {
    if (this._state !== STATES.IDLE) return
    await ble.sendTare()
  },

  _startCountdown() {
    this._countdown = 3
    this._state = STATES.COUNTDOWN
    this.setData({
      guideIcon: '⏱️',
      guideText: '3',
      guideSub: '',
      showTimer: false,
      tareBtnDisabled: true,
      mainBtnDisabled: true,
      mainBtnText: '3...'
    })
    audio.speak('3')

    this._countdownInterval = setInterval(() => {
      this._countdown--
      if (this._countdown > 0) {
        this.setData({
          guideText: '' + this._countdown,
          mainBtnText: this._countdown + '...'
        })
        audio.speak(this._countdown.toString())
      } else {
        clearInterval(this._countdownInterval)
        this._countdownInterval = null
        // 倒计时结束：立即开始萃取（先启动计时与称重同步），再播放提示音
        this._startBrew()
        audio.speak('开始')
      }
    }, 1000)
  },

  _startBrew() {
    this._state = STATES.BREWING
    // 立即记录开始时间，确保计时器与后续重量回调以此时间为准
    this._startTime = Date.now()
    this._stableWeight = -999
    this._stableTime = 0
    this._lastSignificantChangeTime = this._startTime
    this._lastSignificantWeight = this._currentWeight || 0
    this._finalWeight = 0

    this.setData({
      guideIcon: '💧',
      guideText: '萃取中',
      guideSub: '',
      showTimer: true,
      tareBtnDisabled: true,
      mainBtnDisabled: false,
      mainBtnText: '结束萃取'
    })

    this._timerInterval = setInterval(() => {
      const elapsed = (Date.now() - this._startTime) / 1000
      // 计时器从0开始显示，不扣预浸泡时间
      this.setData({ timerValue: elapsed.toFixed(1) })
    }, 100)
  },

  _endBrew(endTime) {
    if (this._timerInterval) {
      clearInterval(this._timerInterval)
      this._timerInterval = null
    }
    this._finalWeight = this._currentWeight
    // 如果自动结束，使用最后一次重量变化的时间；手动结束使用当前时间
    const actualEndTime = endTime || Date.now()
    // 最终萃取时长取稳定开始时刻（不包含后续3秒确认等待）
    this._finalTime = Math.max(0, (actualEndTime - this._startTime) / 1000)
    this.setData({ timerValue: this._finalTime.toFixed(1) })
    this._state = STATES.END

    audio.beepLong()
    audio.speak('完成')

    this.setData({
      guideIcon: '🎉',
      guideText: '萃取完成！',
      guideSub: '液重: ' + this._finalWeight.toFixed(1) + 'g · 时长: ' + this._finalTime.toFixed(1) + 's',
      showTimer: true,
      tareBtnDisabled: true,
      mainBtnDisabled: false,
      mainBtnText: '返回',
      weightStatusText: '萃取完成 ' + this._finalWeight.toFixed(1) + 'g'
    })

    this._saveHistory()
  },

  _saveHistory() {
    historyUtil.addRecord({
      id: Date.now(),
      date: new Date().toISOString(),
      recipe: '意式浓缩',
      type: 'espresso',
      coffeeWeight: 0,
      maxWeight: this._finalWeight,
      duration: this._finalTime
    })
  },

  _reset() {
    this._cleanup()
    this._state = STATES.IDLE
    this.setData({
      guideIcon: '☕',
      guideText: '意式浓缩',
      guideSub: '按下开始，记录萃取时长和出液重量',
      espressoWeight: '0.0',
      weightStatusText: '--',
      showTimer: false,
      timerValue: '00.0',
      tareBtnDisabled: false,
      mainBtnDisabled: false,
      mainBtnText: '开始萃取'
    })
  },

  _cleanup() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval)
      this._timerInterval = null
    }
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval)
      this._countdownInterval = null
    }
  },

  goBack() {
    if (this._state === STATES.BREWING || this._state === STATES.COUNTDOWN) {
      wx.showModal({
        title: '提示',
        content: '萃取进行中，确定退出吗？',
        success: (res) => {
          if (res.confirm) {
            this._cleanup()
            wx.navigateBack()
          }
        }
      })
      return
    }
    this._cleanup()
    wx.navigateBack()
  }
})
