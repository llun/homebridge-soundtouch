const soundtouch = require('soundtouch')
const _ = require('lodash')
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
      .addCharacteristic(Characteristic.On)
      .on('get', callback => this.guard(this.isOn, callback))
      .on('set', (on, callback) => this.guard(this.setOn, callback, on))
    this.service
      .addCharacteristic(this.createAUXCharacteristic())
      .on('set', (value, callback) => this.guard(this.setAUX, callback, value))
    _.range(6).forEach(index => {
      this.service
        .addCharacteristic(this.createPresetCharacteristic(index))
        .on('set', (value, callback) => this.guard(this.setPreset, callback, index))
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

    if (value) fn(value, callback)
    else fn(callback)
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

  isOn (callback) {
    this.device.isAlive(isOn => {
      this.log(`Check if is playing: ${isOn}`)
      callback(null, isOn)
    })
  }

  setOn (value, callback) {
    if (value) {
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

  setPreset (value, callback) {
    this.device.pressKey(`PRESET_${value}`, () => { callback(null) })
  }

  setAUX (value, callback) {
    this.device.pressKey('AUX_INPUT', () => { callback(null) })
  }

  createPresetCharacteristic (number) {
    const characteristic = function () {
      Characteristic.call(
        this,
        `Preset${number}`,
        `00000074-${number}000-1000-8000-0026BB765291`
      )
      this.setProps({
        perms: [Characteristic.Perms.WRITE]
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
        perms: [Characteristic.Perms.WRITE]
      })
      this.value = this.getDefaultValue()
    }
    inherits(characteristic, Characteristic)
    characteristic.UUID = '00000074-0100-1000-8000-0026BB765291'
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
