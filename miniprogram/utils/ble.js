/**
 * BLE 蓝牙管理器 - 泰摩电子秤通信模块
 * 使用微信小程序 BLE API 实现
 */

const SERVICE_UUID = '0000FFF0-0000-1000-8000-00805F9B34FB'
const DATA_CHAR_UUID = '0000FFF1-0000-1000-8000-00805F9B34FB'
const CTRL_CHAR_UUID = '0000FFF2-0000-1000-8000-00805F9B34FB'
const TARE_CMD = new Uint8Array([0xA5, 0x5A, 0x03, 0x0D, 0x00, 0x02, 0x00, 0x00, 0x00, 0x71])

// 给 wx API 包一层超时保护，防止回调式 API 挂起导致 WAService timeout
function wxCall(api, params, timeoutMs) {
  timeoutMs = timeoutMs || 8000
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        reject(new Error('timeout'))
      }
    }, timeoutMs)
    wx[api](Object.assign({}, params, {
      success: (res) => {
        if (!done) { done = true; clearTimeout(timer); resolve(res) }
      },
      fail: (err) => {
        if (!done) { done = true; clearTimeout(timer); reject(err) }
      }
    }))
  })
}

class BLEManager {
  constructor() {
    this.deviceId = ''
    this.deviceName = ''
    this.connected = false
    this.connecting = false
    this._serviceId = ''
    this._dataCharId = ''
    this._ctrlCharId = ''
    this._onWeightCallbacks = []
    this._onConnectCallbacks = []
    this._onDisconnectCallbacks = []
    this._discoveryStarted = false
  }

  onWeight(cb) {
    if (cb && typeof cb === 'function') this._onWeightCallbacks.push(cb)
  }

  offWeight(cb) {
    this._onWeightCallbacks = this._onWeightCallbacks.filter(c => c !== cb)
  }

  onConnect(cb) {
    if (cb && typeof cb === 'function') this._onConnectCallbacks.push(cb)
  }

  offConnect(cb) {
    this._onConnectCallbacks = this._onConnectCallbacks.filter(c => c !== cb)
  }

  onDisconnect(cb) {
    if (cb && typeof cb === 'function') this._onDisconnectCallbacks.push(cb)
  }

  offDisconnect(cb) {
    this._onDisconnectCallbacks = this._onDisconnectCallbacks.filter(c => c !== cb)
  }

  _notifyWeight(weight) {
    this._onWeightCallbacks.forEach(cb => {
      try { cb(weight) } catch (e) { console.error('Weight callback error:', e) }
    })
  }

  _notifyConnect() {
    this._onConnectCallbacks.forEach(cb => {
      try { cb({ deviceId: this.deviceId, deviceName: this.deviceName }) } catch (e) {}
    })
  }

  _notifyDisconnect() {
    this._onDisconnectCallbacks.forEach(cb => {
      try { cb() } catch (e) {}
    })
  }

  async connect() {
    if (this.connecting) return
    if (this.connected) {
      await this.disconnect()
      return
    }
    this.connecting = true

    try {
      // 1. 初始化蓝牙适配器
      await this._openAdapter()

      // 2. 搜索设备
      const device = await this._startDiscovery()
      this.deviceId = device.deviceId
      this.deviceName = device.name || device.localName || 'TIMEMORE'

      // 3. 停止搜索
      this._stopDiscovery()

      // 4. 连接设备（超时 12s）
      await this._createConnection(this.deviceId)

      // 5. 获取服务和特征值
      await this._discoverServices()

      // 6. 启用通知（超时 8s）
      await this._enableNotify()

      // 7. 监听数据
      this._listenData()

      // 8. 监听断连
      this._listenDisconnect()

      this.connected = true
      this.connecting = false
      this._notifyConnect()

    } catch (e) {
      console.error('BLE connect error:', e)
      this.connecting = false
      this._cleanup()
      // 将错误转换为可读消息
      const msg = e && (e.message || e.errMsg || '连接失败')
      throw new Error(
        msg.indexOf('timeout') !== -1 ? '连接超时，请重试' :
        msg.indexOf('10001') !== -1 ? '请打开手机蓝牙' :
        msg.indexOf('10006') !== -1 ? '连接已断开，请重试' :
        msg.indexOf('未找到') !== -1 ? msg :
        '连接失败：' + msg
      )
    }
  }

  async disconnect() {
    if (!this.connected && !this.connecting) return
    this._cleanup()
  }

  async sendTare() {
    if (!this.connected || !this._ctrlCharId) return
    try {
      await wxCall('writeBLECharacteristicValue', {
        deviceId: this.deviceId,
        serviceId: this._serviceId,
        characteristicId: this._ctrlCharId,
        value: TARE_CMD.buffer
      }, 3000)
    } catch (e) {
      console.error('Tare failed:', e)
    }
  }

  // ---- 内部方法 ----

  _openAdapter() {
    return new Promise((resolve, reject) => {
      wx.openBluetoothAdapter({
        success: resolve,
        fail: (err) => {
          if (err.errCode === 10001 || (err.errMsg && err.errMsg.indexOf('10001') !== -1)) {
            reject(new Error('请打开手机蓝牙'))
          } else {
            reject(err)
          }
        }
      })
    })
  }

  _startDiscovery() {
    return new Promise((resolve, reject) => {
      let found = false

      const cleanup = () => {
        this._stopDiscovery()
        try { wx.offBluetoothDeviceFound() } catch (e) {}
      }

      const timer = setTimeout(() => {
        if (!found) {
          found = true
          cleanup()
          reject(new Error('未找到泰摩设备，请确认秤已开机且在附近'))
        }
      }, 15000)

      wx.onBluetoothDeviceFound((res) => {
        const devices = res.devices || []
        for (const d of devices) {
          const name = (d.name || d.localName || '').toUpperCase()
          if (name.indexOf('TIMEMORE') !== -1 || name.indexOf('DOT') !== -1) {
            if (!found) {
              found = true
              clearTimeout(timer)
              cleanup()
              resolve(d)
            }
            return
          }
        }
      })

      wx.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: false,
        success: () => {
          this._discoveryStarted = true
        },
        fail: (err) => {
          clearTimeout(timer)
          try { wx.offBluetoothDeviceFound() } catch (e) {}
          reject(err)
        }
      })
    })
  }

  _stopDiscovery() {
    if (this._discoveryStarted) {
      this._discoveryStarted = false
      // 使用 callback 方式避免 Promise 挂起
      wx.stopBluetoothDevicesDiscovery({ success: () => {}, fail: () => {} })
    }
  }

  _createConnection(deviceId) {
    // 使用 wxCall 统一超时保护，12s
    return wxCall('createBLEConnection', { deviceId }, 12000)
  }

  async _discoverServices() {
    // 等待连接稳定（部分机型/固件需要更长等待）
    await this._delay(800)

    const servicesRes = await wxCall('getBLEDeviceServices', {
      deviceId: this.deviceId
    }, 8000)

    const targetService = servicesRes.services.find(s =>
      s.uuid.toUpperCase() === SERVICE_UUID.toUpperCase()
    )
    if (!targetService) {
      // 尝试匹配短 UUID（部分设备上报不同格式）
      const fallback = servicesRes.services.find(s =>
        s.uuid.toUpperCase().indexOf('FFF0') !== -1
      )
      if (!fallback) throw new Error('未找到目标服务 (FFF0)')
      this._serviceId = fallback.uuid
    } else {
      this._serviceId = targetService.uuid
    }

    await this._delay(300)

    const charsRes = await wxCall('getBLEDeviceCharacteristics', {
      deviceId: this.deviceId,
      serviceId: this._serviceId
    }, 8000)

    for (const c of charsRes.characteristics) {
      const uuid = c.uuid.toUpperCase()
      if (uuid === DATA_CHAR_UUID.toUpperCase() || uuid.indexOf('FFF1') !== -1) {
        this._dataCharId = this._dataCharId || c.uuid
      } else if (uuid === CTRL_CHAR_UUID.toUpperCase() || uuid.indexOf('FFF2') !== -1) {
        this._ctrlCharId = this._ctrlCharId || c.uuid
      }
    }

    if (!this._dataCharId) throw new Error('未找到数据特征值 (FFF1)')
    if (!this._ctrlCharId) throw new Error('未找到控制特征值 (FFF2)')
  }

  _enableNotify() {
    return wxCall('notifyBLECharacteristicValueChange', {
      deviceId: this.deviceId,
      serviceId: this._serviceId,
      characteristicId: this._dataCharId,
      state: true
    }, 8000)
  }

  _listenData() {
    wx.onBLECharacteristicValueChange((res) => {
      const resUuid = (res.characteristicId || '').toUpperCase()
      if (resUuid !== DATA_CHAR_UUID.toUpperCase() && resUuid.indexOf('FFF1') === -1) return

      const data = new Uint8Array(res.value)
      if (data[0] === 0xA5 && data[1] === 0x5A && data.length >= 10) {
        const raw = (data[8] << 8) | data[9]
        const weight = raw > 30000 ? (raw - 65536) * 0.1 : raw * 0.1
        this._notifyWeight(weight)
      }
    })
  }

  _listenDisconnect() {
    wx.onBLEConnectionStateChange((res) => {
      if (res.deviceId === this.deviceId && !res.connected) {
        const wasConnected = this.connected
        this._cleanup()
        if (wasConnected) this._notifyDisconnect()
      }
    })
  }

  _cleanup() {
    const prevDeviceId = this.deviceId
    this.connected = false
    this.connecting = false
    this._serviceId = ''
    this._dataCharId = ''
    this._ctrlCharId = ''
    this.deviceId = ''
    this._stopDiscovery()

    // 使用 callback 方式，不 await，避免异步操作挂起
    if (prevDeviceId) {
      wx.closeBLEConnection({ deviceId: prevDeviceId, success: () => {}, fail: () => {} })
    }
    wx.closeBluetoothAdapter({ success: () => {}, fail: () => {} })
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms))
  }
}

module.exports = new BLEManager()
