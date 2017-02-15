const soundtouch = require('soundtouch')
const _ = require('lodash')
const co = require('co')
const inherits = require('util').inherits

let Service, Characteristic

class SoundTouchAccessory {
  constructor (log, config) {
    this.log = log
    this.config = config
    this.name = config.name
    this.room = config.room

    if (!this.room) throw new Error('You must provide a  config value for "room".')

    this.service = new Service.Speaker(this.name)
    this.service
      .getCharacteristic(Characteristic.Volume)
      .on('get', callback => this.guard(this.getVolume, callback))
      .on('set', (volume, callback) => this.guard(this.setVolume, callback, volume))
    this.service
      .getCharacteristic(Characteristic.Mute)
      .on('get', callback => this.guard(this.isMute, callback))
      .on('set', (isOn, callback) => this.guard(this.setMute, callback, isOn))
    this.service
      .addCharacteristic(this.createIPCharacteristic())
      .on('get', callback => this.guard(this.getIP, callback))
    this.service
      .addCharacteristic(this.createAUXCharacteristic())
      .on('get', callback => this.guard(this.getAUX, callback))
      .on('set', (value, callback) => this.guard(this.setAUX, callback, value))
    _.range(1, 7).forEach(index => {
      this.service
        .addCharacteristic(this.createPresetCharacteristic(index))
        .on('get', callback => this.guard(this.getPreset, callback))
        .on('set', (value, callback) => this.guard(this.setPreset(index), callback, value))
    })
    this.search()
  }

  getServices () {
    return [this.service, this.getInformationService()]
  }

  getInformationService () {
    var informationService = new Service.AccessoryInformation()
    informationService
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, 'Bose SoundTouch')
      .setCharacteristic(Characteristic.Model, '1.0.0')
      .setCharacteristic(Characteristic.SerialNumber, this.room)
    return informationService
  }

  identify (callback) {
    this.log('Identify request')
    callback()
  }

  guard (fn, callback, value) {
    if (!this.device) {
      this.log.warn('Ignoring request; SoundTouch device has not yet been discovered.')
      callback(new Error('SoundTouch has not been discovered yet.'))
      return
    }

    if (value !== undefined) fn.call(this, value, callback)
    else fn.call(this, callback)
  }

  search () {
    soundtouch.search(device => {
      if (this.room !== device.name) {
        this.log(
          `Ignoring device because the room name ${this.room} does not match the desired name ${device.room}`)
        return
      }

      this.log(`Found Bose SoundTouch device: ${device.name}`)
      this.device = device
      this.getVolume((error, volume) => {
        if (error) return
        this.service.setCharacteristic(Characteristic.Volume, volume)
      })
      soundtouch.stopSearching()
    }, device => {
      this.log(`Bose SoundTouch device goes offline: ${device.name}`)
    })
  }

  getVolume (callback) {
    this.device.getVolume(json => {
      const volume = json.volume.actualvolume
      this.log(`Current volume: ${volume}`)
      callback(null, volume * 1)
    })
  }

  setVolume (volume, callback) {
    this.device.setVolume(volume, () => {
      this.log(`Setting volume to ${volume}`)
      callback(null)
    })
  }

  isMute (callback) {
    this.device.isAlive(isOn => {
      this.log(`Check if is playing: ${isOn}`)
      callback(null, !isOn)
    })
  }

  setMute (mute, callback) {
    if (!mute) {
      this.device.powerOn(isTurnedOn => {
        this.log(isTurnedOn ? 'Power On' : 'Was already powered on')
        this.device.play(json => {
          this.log('Playing...')
          callback(null)
        })
      })
    } else {
      this.device.powerOff(() => {
        this.log('Powering Off...')
        callback(null)
      })
    }
  }

  getIP (callback) {
    callback(null, this.device.device.ip)
  }

  getPreset (callback) {
    // Alway returns null to make the toggle off
    callback(null, false)
  }

  setPreset (index) {
    const accessory = this
    return (value, callback) => {
      co(function* () {
        if (value) {
          yield new Promise(resolve => accessory.device.pressKey(`PRESET_${index}`, resolve))
        }
        setTimeout(() => {
          accessory.service.setCharacteristic(`Preset${index}`, 0)
        }, 400)
      }).then(() => callback(null))
    }
  }

  getAUX (callback) {
    callback(null, false)
  }

  setAUX (value, callback) {
    const accessory = this
    co(function* () {
      if (value) {
        yield new Promise(resolve => accessory.device.pressKey(`AUX_INPUT`, resolve))
      }
      setTimeout(() => {
        accessory.service.setCharacteristic('AUX', 0)
      }, 400)
    }).then(() => callback(null))
  }

  createPresetCharacteristic (number) {
    const characteristic = function () {
      Characteristic.call(
        this,
        `Preset${number}`,
        `00000074-${number}000-1000-8000-0026BB765291`
      )
      this.setProps({
        format: Characteristic.Formats.BOOL,
        perms: [
          Characteristic.Perms.READ,
          Characteristic.Perms.WRITE,
          Characteristic.Perms.NOTIFY
        ]
      })
      this.value = this.getDefaultValue()
    }
    inherits(characteristic, Characteristic)
    characteristic.UUID = `00000074-${number}000-1000-8000-0026BB765291`
    return characteristic
  }

  createAUXCharacteristic () {
    const characteristic = function () {
      Characteristic.call(this, 'AUX', '00000074-0100-1000-8000-0026BB765291')
      this.setProps({
        format: Characteristic.Formats.BOOL,
        perms: [
          Characteristic.Perms.READ,
          Characteristic.Perms.WRITE,
          Characteristic.Perms.NOTIFY
        ]
      })
      this.value = this.getDefaultValue()
    }
    inherits(characteristic, Characteristic)
    characteristic.UUID = '00000074-0100-1000-8000-0026BB765291'
    return characteristic
  }

  createIPCharacteristic () {
    const characteristic = function () {
      Characteristic.call(this, 'IP', '00000074-0200-1000-8000-0026BB765291')
      this.setProps({
        format: Characteristic.Formats.STRING,
        perms: [Characteristic.Perms.READ]
      })
      this.value = this.getDefaultValue()
    }
    inherits(characteristic, Characteristic)
    characteristic.UUID = '00000074-0200-1000-8000-0026BB765291'
    return characteristic
  }
}

module.exports = function (homebridge) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic

  homebridge.registerAccessory(
    'homebridge-soundtouch',
    'SoundTouch',
    SoundTouchAccessory
  )
}
