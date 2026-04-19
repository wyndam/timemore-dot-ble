/**
 * 音频反馈模块
 * 使用打包在 /audio/ 目录的静态 WAV 文件 + InnerAudioContext 播放
 * 同时保留振动作为兜底
 */

const SHORT_SRC = '/audio/s.wav'  // 880Hz 80ms
const LONG_SRC  = '/audio/l.wav'  // 440Hz 350ms

function _play(src) {
  try {
    const ctx = wx.createInnerAudioContext()
    ctx.obeyMuteSwitch = false
    ctx.src = src
    ctx.onEnded(() => ctx.destroy())
    ctx.onError(() => ctx.destroy())
    ctx.play()
  } catch (e) {}
}

function beepShort() {
  _play(SHORT_SRC)
  wx.vibrateShort({ type: 'light' }).catch(() => {})
}

function beepLong() {
  _play(LONG_SRC)
  wx.vibrateLong().catch(() => {})
}

function speak(text) {
  switch (text) {
    case '3':
    case '2':
    case '1':
      _play(SHORT_SRC)
      wx.vibrateShort({ type: 'medium' }).catch(() => {})
      break
    case '开始':
      _play(LONG_SRC)
      wx.vibrateLong().catch(() => {})
      break
    case '停':
      _play(SHORT_SRC)
      wx.vibrateShort({ type: 'heavy' }).catch(() => {})
      break
    case '冲煮结束':
    case '完成':
      _play(LONG_SRC)
      setTimeout(() => _play(LONG_SRC), 430)
      wx.vibrateLong().catch(() => {})
      break
    default:
      _play(SHORT_SRC)
      wx.vibrateShort({ type: 'light' }).catch(() => {})
  }
}

// 流速提醒
let _flowBeepTimer = null
let _currentBeepType = null

function startFlowBeep(interval, type) {
  stopFlowBeep()
  _currentBeepType = type
  const doBeep = () => _play(SHORT_SRC)
  doBeep()
  _flowBeepTimer = setInterval(doBeep, interval)
}

function stopFlowBeep() {
  if (_flowBeepTimer) {
    clearInterval(_flowBeepTimer)
    _flowBeepTimer = null
  }
  _currentBeepType = null
}

function getCurrentBeepType() {
  return _currentBeepType
}

module.exports = {
  beepShort,
  beepLong,
  speak,
  startFlowBeep,
  stopFlowBeep,
  getCurrentBeepType
}


