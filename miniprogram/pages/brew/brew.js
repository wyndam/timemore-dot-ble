const app = getApp()
const ble = app.globalData.ble
const recipeUtil = require('../../utils/recipe')
const historyUtil = require('../../utils/history')
const audio = require('../../utils/audio')

const STATES = {
  ADD_POWDER: 'addPowder',
  CONFIGURED: 'configured',
  COUNTDOWN: 'countdown',
  BREWING: 'brewing',
  END: 'end'
}

Page({
  data: {
    statusBarHeight: 0, headerRight: 0,
    // 方案
    recipeName: '',
    recipeRatioText: '1:15',
    stageTags: [],
    showRecipe: false,
    // 引导
    guideIcon: '☕',
    guideText: '请加入咖啡粉',
    guideSub: '当前粉重: 0.0g',
    // 重量
    brewWeight: '0.0',
    weightNegative: false,
    showWeightStatus: true,
    weightStatusText: '--',
    // 进度
    showProgress: false,
    progressStageLabel: '阶段 1/1',
    progressTargetLabel: '0 / 0g',
    progressPercent: 0,
    progressMarkers: [],
    progressLabelItems: [],
    // 指标
    showMetrics: false,
    timer: '00:00',
    flowRate: '0.0',
    flowStatusText: '',
    flowStatusClass: '',
    // 曲线
    showChart: false,
    // 完成
    showCompleted: false,
    completedPowder: '0g',
    completedTime: '00:00',
    completedWater: '0g',
    completedStages: [],
    // 按钮
    showTareBtn: true,
    tareBtnText: '取消',
    tareBtnDisabled: false,
    mainBtnText: '开始冲煮',
    mainBtnDisabled: true
  },

  // ---- 内部状态 ----
  _state: STATES.ADD_POWDER,
  _recipe: null,
  _recipes: [],
  _coffeeWeight: 0,
  _currentWeight: 0,
  _lastWeight: 0,
  _lastTime: 0,
  _smoothFlow: 0,
  _isRecording: false,
  _recordStartTime: 0,
  _recordInterval: null,
  _weightData: [],
  _maxRecordedWeight: 0,
  _lowWeightCount: 0,
  _finalWaterWeight: 0,
  _countdown: 0,
  _countdownInterval: null,
  _currentStageIndex: -1,
  _stageCompletedFlags: [],
  _stageWaterAccum: [],
  _stageTargets: [],
  _stageStopNotified: [],
  _totalPouredWater: 0,
  _brewUiFrozen: false,
  _chartCanvas: null,
  _chartCtx: null,
  _weightCb: null,
  _disconnectCb: null,
  // 流速提醒
  _lastFlowStatus: null,
  _flowStatusStartTime: 0,
  _FLOW_STATUS_DELAY: 200,

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, headerRight: app.globalData.capsulePaddingRight || 100 })

    // 加载方案
    this._recipes = recipeUtil.loadRecipes()
    const targetId = app.globalData.currentRecipeId
    const recipe = (targetId && this._recipes.find(r => r.id === targetId)) || this._recipes[0]
    this._selectRecipe(recipe)

    // BLE 回调
    this._weightCb = (w) => this._onWeight(w)
    this._disconnectCb = () => {
      wx.showToast({ title: '电子秤已断开', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
    }
    ble.onWeight(this._weightCb)
    ble.onDisconnect(this._disconnectCb)

    // 去皮 → 加粉
    this._initBrew()
  },

  onReady() {
    this._initCanvas()
  },

  onUnload() {
    this._cleanup()
    ble.offWeight(this._weightCb)
    ble.offDisconnect(this._disconnectCb)
  },

  onShow() {
    // 从方案页返回时刷新
    const newId = app.globalData.currentRecipeId
    if (newId && (!this._recipe || this._recipe.id !== newId)) {
      this._recipes = recipeUtil.loadRecipes()
      const recipe = this._recipes.find(r => r.id === newId)
      if (recipe) this._selectRecipe(recipe)
    }
  },

  // ==================== 初始化 ====================
  async _initBrew() {
    await ble.sendTare()
    this._coffeeWeight = 0
    this._currentWeight = 0
    this.setData({ brewWeight: '0.0' })
    setTimeout(() => this._setState(STATES.ADD_POWDER), 500)
  },

  _initCanvas() {
    const query = this.createSelectorQuery()
    query.select('#brewChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res[0]) {
          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          const dpr = wx.getSystemInfoSync().pixelRatio
          canvas.width = res[0].width * dpr
          canvas.height = res[0].height * dpr
          ctx.scale(dpr, dpr)
          this._chartCanvas = canvas
          this._chartCtx = ctx
          this._chartWidth = res[0].width
          this._chartHeight = res[0].height
        }
      })
  },

  // ==================== 方案 ====================
  _selectRecipe(recipe) {
    this._recipe = recipeUtil.normalizeRecipe(recipe)
    this._currentStageIndex = -1
    this._stageCompletedFlags = []
    this._stageWaterAccum = []
    this._stageTargets = []
    this._stageStopNotified = []
    this._totalPouredWater = 0
    this._brewUiFrozen = false

    this._updateRecipeUI()
  },

  _updateRecipeUI() {
    if (!this._recipe) return
    const r = this._recipe
    const pw = this._state === STATES.ADD_POWDER ? Math.max(0, this._currentWeight) : Math.max(0, this._coffeeWeight)
    const targets = pw > 0 ? recipeUtil.computeStageTargets(r, pw) : new Array(r.stages.length).fill(0)
    const cumulative = recipeUtil.getCumulativeTargets(targets)

    const stageTags = r.stages.map((s, i) => ({
      text: '第' + (i + 1) + '段：目标至 ' + (cumulative[i] || 0).toFixed(0) + 'g',
      active: false
    }))

    this.setData({
      recipeName: r.name,
      recipeRatioText: '1:' + recipeUtil.parseRatioValue(r.ratio),
      stageTags
    })
  },

  // ==================== 数据处理 ====================
  _onWeight(weight) {
    if (this._brewUiFrozen && this._state === STATES.END) return

    const now = Date.now()
    let flow = 0

    if (this._lastTime > 0 && this._isRecording) {
      const dt = (now - this._lastTime) / 1000
      if (dt > 0) {
        flow = Math.max(0, (weight - this._lastWeight) / dt)
        this._updateFlowStatus(flow)
      }
    }

    this._currentWeight = weight
    this._lastWeight = weight
    this._lastTime = now

    this.setData({
      brewWeight: weight.toFixed(1),
      weightNegative: weight < 0
    })

    // 加粉状态
    if (this._state === STATES.ADD_POWDER) {
      this._updateRecipeUI()
      this.setData({
        guideSub: '当前粉重: ' + weight.toFixed(1) + 'g',
        mainBtnDisabled: weight < 2
      })
    }

    // 冲煮记录
    if (this._isRecording) {
      if (weight > this._maxRecordedWeight) this._maxRecordedWeight = weight

      const brewWaterNow = Math.max(0, weight)
      this._totalPouredWater = Math.max(this._totalPouredWater, brewWaterNow)

      // 自动完成检测
      const allDone = this._stageCompletedFlags.every(f => f === true)
      if (allDone) {
        const plannedTotal = this._stageTargets.reduce((sum, v) => sum + (Number(v) || 0), 0)
        const effectiveTotal = Math.max(plannedTotal, this._totalPouredWater, this._maxRecordedWeight, 0)
        const dropThreshold = Math.max(6, effectiveTotal * 0.25)
        const dropAmount = effectiveTotal - weight
        const cupRemovedShock = weight < -5 && dropAmount > Math.max(10, effectiveTotal * 0.5)

        if ((dropAmount > dropThreshold && effectiveTotal >= Math.max(10, plannedTotal * 0.8)) || cupRemovedShock) {
          this._lowWeightCount++
          if (this._lowWeightCount >= 3) {
            this._finalWaterWeight = Math.max(this._totalPouredWater, this._maxRecordedWeight, 0)
            this._stopRecord()
            audio.stopFlowBeep()
            // 截断下降数据
            let cutIndex = this._weightData.length
            for (let i = this._weightData.length - 1; i >= 1; i--) {
              if (this._weightData[i - 1].weight > this._weightData[i].weight + 2) {
                cutIndex = i
                break
              }
            }
            this._weightData = this._weightData.slice(0, cutIndex)
            this._finalizeBrew()
            return
          }
        } else {
          this._lowWeightCount = 0
        }
      } else {
        this._lowWeightCount = 0
      }

      const elapsed = (now - this._recordStartTime) / 1000

      // 过滤异常
      if (this._weightData.length > 0) {
        const last = this._weightData[this._weightData.length - 1]
        if (last.weight - weight > 5) return
      }

      this._weightData.push({ time: elapsed, weight, flow: this._smoothFlow })
      if (this._weightData.length > 2400) this._weightData.shift()

      this._checkStageCompletion(this._totalPouredWater)
      this._updateProgressBar(this._totalPouredWater)
    }
  },

  _updateFlowStatus(flow) {
    if (flow > 20) return
    this._smoothFlow = this._smoothFlow * 0.85 + flow * 0.15

    if (!this._recipe || this._currentStageIndex < 0) {
      audio.stopFlowBeep()
      this.setData({ flowRate: this._smoothFlow.toFixed(1), flowStatusText: '', flowStatusClass: '' })
      return
    }

    const stage = this._recipe.stages[this._currentStageIndex]
    const targetFlow = stage.targetFlow
    const ratio = this._smoothFlow / targetFlow

    let text = '', cls = '', beepInterval = 0, beepType = null

    if (this._smoothFlow < 0.5) {
      text = ''; cls = ''
    } else if (ratio < 0.9) {
      text = '偏低'; cls = 'low'; beepInterval = 800; beepType = 'low'
    } else if (ratio <= 1.3) {
      text = '正常'; cls = 'normal'
    } else if (ratio <= 1.5) {
      text = '偏快'; cls = 'high'; beepInterval = 400; beepType = 'high'
    } else {
      text = '过快'; cls = 'danger'; beepInterval = 200; beepType = 'high'
    }

    this.setData({
      flowRate: this._smoothFlow.toFixed(1),
      flowStatusText: text,
      flowStatusClass: cls
    })

    if (cls !== this._lastFlowStatus) {
      this._flowStatusStartTime = Date.now()
      this._lastFlowStatus = cls
      audio.stopFlowBeep()
    }

    if (beepInterval > 0 && Date.now() - this._flowStatusStartTime >= this._FLOW_STATUS_DELAY) {
      if (audio.getCurrentBeepType() !== beepType) {
        audio.stopFlowBeep()
        audio.startFlowBeep(beepInterval, beepType)
      }
    }
  },

  // ==================== 状态机 ====================
  _setState(state) {
    this._state = state
    this._updateStateUI()
  },

  _updateStateUI() {
    const s = this._state
    const updates = {}

    switch (s) {
      case STATES.ADD_POWDER:
        Object.assign(updates, {
          guideIcon: '☕', guideText: '请加入咖啡粉',
          guideSub: '当前粉重: ' + this._currentWeight.toFixed(1) + 'g',
          mainBtnDisabled: this._currentWeight < 2, mainBtnText: '开始冲煮',
          showTareBtn: true, tareBtnText: '取消', tareBtnDisabled: false,
          showRecipe: true, showProgress: false, showMetrics: false,
          showChart: false, showCompleted: false, showWeightStatus: true,
          weightStatusText: '--'
        })
        break

      case STATES.CONFIGURED:
        Object.assign(updates, {
          guideIcon: '✅', guideText: '配置完成', guideSub: '准备进入倒计时',
          mainBtnDisabled: true, mainBtnText: '准备中...',
          showTareBtn: false,
          showRecipe: true, showProgress: true, showMetrics: true,
          showChart: false, showCompleted: false, showWeightStatus: false
        })
        break

      case STATES.COUNTDOWN:
        Object.assign(updates, {
          guideIcon: '⏱️', guideText: '' + this._countdown, guideSub: '',
          mainBtnDisabled: true, mainBtnText: this._countdown + '...',
          showTareBtn: false,
          showRecipe: true, showProgress: true, showMetrics: true,
          showChart: false, showCompleted: false, showWeightStatus: false
        })
        this._renderProgressBar()
        break

      case STATES.BREWING:
        this._updateBrewingUI()
        Object.assign(updates, {
          showTareBtn: false,
          showRecipe: true, showProgress: true, showMetrics: true,
          showChart: true, showCompleted: false, showWeightStatus: false
        })
        break

      case STATES.END:
        Object.assign(updates, {
          guideIcon: '🎉', guideText: '冲煮完成！',
          guideSub: '总注水量: ' + this._finalWaterWeight.toFixed(0) + 'g',
          brewWeight: this._finalWaterWeight.toFixed(1),
          mainBtnDisabled: false, mainBtnText: '返回称重',
          showTareBtn: true, tareBtnText: '再来一杯', tareBtnDisabled: false,
          showRecipe: true, showProgress: false, showMetrics: false,
          showChart: false, showCompleted: true, showWeightStatus: true,
          weightStatusText: '总注水量 ' + this._finalWaterWeight.toFixed(0) + 'g'
        })
        break
    }

    this.setData(updates)
    // 进入 BREWING 时 canvas 刚被渲染，需在下一帧初始化
    if (this._state === STATES.BREWING) {
      wx.nextTick(() => this._initCanvas())
    }
  },

  _updateBrewingUI() {
    const stage = this._recipe.stages[this._currentStageIndex]
    const cumTargets = recipeUtil.getCumulativeTargets(this._stageTargets)
    const targetWater = cumTargets[this._currentStageIndex] || 0

    let guideIcon, guideText, guideSub
    if (this._stageCompletedFlags[this._currentStageIndex]) {
      guideIcon = '⏳'
      guideText = '等待滴滤完成'
      guideSub = this._currentStageIndex < this._recipe.stages.length - 1 ? '继续注水' : '拿走滤杯自动完成'
    } else {
      guideIcon = '💧'
      guideText = '阶段' + (this._currentStageIndex + 1) + '：注水至 ' + targetWater.toFixed(0) + 'g'
      guideSub = ''
    }

    this.setData({
      guideIcon, guideText, guideSub,
      mainBtnDisabled: false, mainBtnText: '结束冲煮'
    })
  },

  // ==================== 进度条 ====================
  _renderProgressBar() {
    if (!this._recipe || !this._stageTargets.length) return

    const totalWater = this._stageTargets.reduce((sum, v) => sum + (Number(v) || 0), 0) || 1
    const cumTargets = recipeUtil.getCumulativeTargets(this._stageTargets)

    const markers = []
    const labelItems = []

    cumTargets.forEach((target, i) => {
      const offset = Math.max(0, Math.min(100, (target / totalWater) * 100))
      if (i < cumTargets.length - 1) {
        markers.push(offset)
      }
      labelItems.push({
        text: target.toFixed(0) + 'g',
        offset,
        cls: ''
      })
    })

    this.setData({
      progressMarkers: markers,
      progressLabelItems: labelItems,
      progressPercent: 0
    })
    this._updateProgressInfo()
  },

  _updateProgressInfo() {
    if (this._currentStageIndex < 0 || !this._recipe) return
    const cumTargets = recipeUtil.getCumulativeTargets(this._stageTargets)
    const currentTarget = cumTargets[this._currentStageIndex] || 0
    const currentAccum = Math.max(0, this._totalPouredWater || 0)

    this.setData({
      progressStageLabel: '阶段 ' + (this._currentStageIndex + 1) + '/' + this._recipe.stages.length,
      progressTargetLabel: currentAccum.toFixed(0) + ' / ' + currentTarget.toFixed(0) + 'g'
    })
  },

  _updateProgressBar(weight) {
    if (this._currentStageIndex < 0 || !this._recipe) return

    const totalWater = this._stageTargets.reduce((sum, v) => sum + (Number(v) || 0), 0) || 1
    const percent = Math.min(100, (Math.max(0, weight) / totalWater) * 100)

    const cumTargets = recipeUtil.getCumulativeTargets(this._stageTargets)
    const labelItems = cumTargets.map((target, i) => {
      const offset = Math.max(0, Math.min(100, (target / totalWater) * 100))
      let cls = ''
      if (i < this._currentStageIndex || this._stageCompletedFlags[i]) {
        cls = 'completed'
      } else if (i === this._currentStageIndex) {
        cls = 'active'
      }
      return { text: target.toFixed(0) + 'g', offset, cls }
    })

    this.setData({
      progressPercent: percent,
      progressLabelItems: labelItems
    })
    this._updateProgressInfo()
  },

  _checkStageCompletion(weight) {
    if (this._currentStageIndex < 0 || this._currentStageIndex >= this._recipe.stages.length) return

    const stage = this._recipe.stages[this._currentStageIndex]
    const prevAccum = this._currentStageIndex > 0 ?
      this._stageTargets.slice(0, this._currentStageIndex).reduce((sum, v) => sum + v, 0) : 0
    const currentStageWater = weight - prevAccum
    const stageTarget = this._stageTargets[this._currentStageIndex] || 0
    const safeWater = Math.max(0, currentStageWater)
    this._stageWaterAccum[this._currentStageIndex] = Math.min(safeWater, stageTarget)

    const stopWindow = Math.max(0, Math.min(Number(stage.stopEarly) || 0, 1))
    const stopAt = Math.max(0, stageTarget - stopWindow)
    if (!this._stageStopNotified[this._currentStageIndex] && safeWater >= stopAt && safeWater < stageTarget) {
      this._stageStopNotified[this._currentStageIndex] = true
      audio.beepShort()
      audio.speak('停')
    }

    if (!this._stageCompletedFlags[this._currentStageIndex] && safeWater >= stageTarget) {
      this._stageCompletedFlags[this._currentStageIndex] = true
      this._updateProgressBar(weight)
      this._updateStateUI()

      if (this._currentStageIndex < this._recipe.stages.length - 1) {
        this._currentStageIndex++
        this._stageWaterAccum[this._currentStageIndex] = 0
        this._updateProgressBar(weight)
        this._updateStateUI()
      } else {
        this.setData({ progressPercent: 100 })
      }
    }
  },

  // ==================== 操作 ====================
  async onMainAction() {
    switch (this._state) {
      case STATES.ADD_POWDER:
        this._coffeeWeight = this._currentWeight
        if (this._coffeeWeight < 2) {
          wx.showToast({ title: '请先加入咖啡粉', icon: 'none' })
          return
        }
        this._stageTargets = recipeUtil.computeStageTargets(this._recipe, this._coffeeWeight)
        if (!this._stageTargets.length || this._stageTargets.some(t => !(t > 0))) {
          wx.showToast({ title: '方案参数无效', icon: 'none' })
          return
        }
        this._setState(STATES.CONFIGURED)
        await ble.sendTare()
        this._currentWeight = 0
        this.setData({ brewWeight: '0.0' })
        await this._delay(500)
        this._startCountdown()
        break

      case STATES.BREWING:
        if (!this._stageCompletedFlags.every(Boolean)) {
          wx.showModal({
            title: '提示',
            content: '尚未完成全部注水阶段，确定结束吗？',
            success: (res) => {
              if (res.confirm) this._finalizeBrew()
            }
          })
          return
        }
        this._finalizeBrew()
        break

      case STATES.END:
        this._resetBrew()
        wx.navigateBack()
        break
    }
  },

  onTareAction() {
    if (this._state === STATES.ADD_POWDER) {
      this._resetBrew()
      wx.navigateBack()
      return
    }
    if (this._state === STATES.END) {
      this._resetBrew()
      this._initBrew()
    }
  },

  // ==================== 冲煮流程 ====================
  _startCountdown() {
    this._countdown = 3
    this._setState(STATES.COUNTDOWN)
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
        audio.speak('开始')
        this._startBrew()
      }
    }, 1000)
  },

  _startBrew() {
    this._currentStageIndex = 0
    this._stageCompletedFlags = new Array(this._recipe.stages.length).fill(false)
    this._stageWaterAccum = new Array(this._recipe.stages.length).fill(0)
    this._stageStopNotified = new Array(this._recipe.stages.length).fill(false)
    this._brewUiFrozen = false
    this._maxRecordedWeight = 0
    this._lowWeightCount = 0
    this._currentWeight = 0
    this._totalPouredWater = 0

    this._renderProgressBar()
    this._isRecording = true
    this._recordStartTime = Date.now()
    this._weightData = []

    this._recordInterval = setInterval(() => {
      this._updateTimer()
      this._drawChart()
    }, 100)

    this._setState(STATES.BREWING)
  },

  _stopRecord() {
    this._isRecording = false
    if (this._recordInterval) {
      clearInterval(this._recordInterval)
      this._recordInterval = null
    }
  },

  _finalizeBrew() {
    this._finalWaterWeight = Math.max(this._finalWaterWeight, this._totalPouredWater, this._maxRecordedWeight, 0)
    this._stopRecord()
    audio.stopFlowBeep()
    audio.speak('冲煮结束')
    this._renderCompletedSummary()
    this._brewUiFrozen = true
    this._saveHistory()
    this._setState(STATES.END)
  },

  _renderCompletedSummary() {
    const durationText = this.data.timer || '00:00'
    const stages = this._stageTargets.map((target, i) => {
      const actual = (this._stageWaterAccum[i] || 0).toFixed(0)
      const targetText = (target || 0).toFixed(0)
      return actual + ' / ' + targetText + 'g'
    })

    this.setData({
      completedPowder: this._coffeeWeight.toFixed(1) + 'g',
      completedTime: durationText,
      completedWater: this._finalWaterWeight.toFixed(0) + 'g',
      completedStages: stages
    })
  },

  _saveHistory() {
    const fw = Math.max(this._finalWaterWeight, this._maxRecordedWeight, this._currentWeight, 0)
    historyUtil.addRecord({
      id: Date.now(),
      date: new Date().toISOString(),
      recipe: this._recipe ? this._recipe.name : '',
      coffeeWeight: this._coffeeWeight,
      maxWeight: fw,
      duration: this._weightData.length > 0 ? this._weightData[this._weightData.length - 1].time : 0,
      data: this._weightData.slice()
    })
  },

  _resetBrew() {
    this._stopRecord()
    audio.stopFlowBeep()
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval)
      this._countdownInterval = null
    }
    this._countdown = 0
    this._weightData = []
    this._smoothFlow = 0
    this._lastWeight = 0
    this._lastTime = 0
    this._maxRecordedWeight = 0
    this._lowWeightCount = 0
    this._finalWaterWeight = 0
    this._currentStageIndex = -1
    this._stageCompletedFlags = []
    this._stageWaterAccum = []
    this._stageTargets = []
    this._stageStopNotified = []
    this._totalPouredWater = 0
    this._brewUiFrozen = false
    this._coffeeWeight = 0
    this._lastFlowStatus = null
  },

  _cleanup() {
    this._resetBrew()
  },

  _updateTimer() {
    const elapsed = Math.floor((Date.now() - this._recordStartTime) / 1000)
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    this.setData({
      timer: m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0')
    })
  },

  // ==================== 曲线 ====================
  _drawChart() {
    const ctx = this._chartCtx
    if (!ctx) return

    const w = this._chartWidth
    const h = this._chartHeight

    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = '#444'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'center'

    const maxTime = this._weightData.length > 0 ? Math.max(...this._weightData.map(d => d.time), 180) : 180
    for (let t = 0; t <= maxTime; t += 30) {
      const x = (t / maxTime) * w
      ctx.fillText(this._formatTime(t), x, h - 2)
    }

    if (this._weightData.length < 2) return

    const weights = this._weightData.map(d => d.weight)
    const maxW = Math.max(...weights, 100)
    const minW = Math.min(...weights, 0)
    const rangeW = maxW - minW + 20

    ctx.strokeStyle = '#4ade80'
    ctx.lineWidth = 2
    ctx.beginPath()
    this._weightData.forEach((d, i) => {
      const x = (d.time / maxTime) * w
      const y = h - ((d.weight - minW + 10) / rangeW) * (h - 16) * 0.9 - 14
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  },

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    if (m > 0) return m + "'" + s.toString().padStart(2, '0')
    return s + 's'
  },

  // ==================== 导航 ====================
  goBack() {
    if (this._state === STATES.BREWING || this._state === STATES.COUNTDOWN) {
      wx.showModal({
        title: '提示',
        content: '冲煮进行中，确定退出吗？',
        success: (res) => {
          if (res.confirm) {
            this._resetBrew()
            wx.navigateBack()
          }
        }
      })
      return
    }
    this._resetBrew()
    wx.navigateBack()
  },

  goRecipe() {
    wx.navigateTo({ url: '/pages/recipe/recipe' })
  },

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms))
  }
})
