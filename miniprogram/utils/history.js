/**
 * 冲煮历史记录管理
 */

const STORAGE_KEY = 'brewHistory'
const MAX_RECORDS = 30

function load() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY)
    if (saved) {
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved
      if (Array.isArray(parsed)) return parsed
    }
  } catch (e) {}
  return []
}

function save(history) {
  try {
    wx.setStorageSync(STORAGE_KEY, JSON.stringify(history))
  } catch (e) {
    console.error('Save history failed:', e)
  }
}

function addRecord(record) {
  const history = load()
  history.unshift(record)
  if (history.length > MAX_RECORDS) history.pop()
  save(history)
  return history
}

function deleteRecord(index) {
  const history = load()
  if (index >= 0 && index < history.length) {
    history.splice(index, 1)
    save(history)
  }
  return history
}

function clearAll() {
  save([])
  return []
}

function getRecord(index) {
  const history = load()
  return (index >= 0 && index < history.length) ? history[index] : null
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m + ':' + s.toString().padStart(2, '0')
}

function formatHistoryTime(dateStr) {
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 172800000) return '昨天'
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes().toString().padStart(2, '0')
}

module.exports = {
  load,
  save,
  addRecord,
  deleteRecord,
  clearAll,
  getRecord,
  formatDuration,
  formatHistoryTime
}
