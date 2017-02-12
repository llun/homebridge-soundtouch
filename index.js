var soundtouch = require('soundtouch');
var inspect = require('util').inspect;
var inherits = require('util').inherits;
var Service, Characteristic;

const MIN_PRESET = 1;
const MAX_PRESET = 6;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    'homebridge-soundtouch',
    'SoundTouch',
    SoundTouchAccessory
  );
};

//
// SoundTouch Accessory
//

function SoundTouchAccessory(log, config) {
  this.log = log;
  this.config = config;
  this.name = config['name'];
  this.room = config['room'];

  if (!this.room) {
    throw new Error("You must provide a config value for 'room'.");
  }

  this.service = new Service.Speaker(this.name);
  this.service
    .getCharacteristic(Characteristic.Mute)
    .on('get', this._getMute.bind(this))
    .on('set', this._setMute.bind(this));
  this.service
    .getCharacteristic(Characteristic.Volume)
    .on('get', this._getVolume.bind(this))
    .on('set', this._setVolume.bind(this));
  for (let i = MIN_PRESET; i <= MAX_PRESET; i++) {
    this.service
      .addCharacteristic(makePresetCharacteristic(i))
      .on('get', this._getPreset.bind(this, i))
      .on('set', this._setPreset.bind(this, i));
  }
  this.service
    .addCharacteristic(makeAUXCharacteristic())
    .on('get', this._getAUX.bind(this))
    .on('set', this._setAUX.bind(this));

  // begin searching for a SoundTouch device with the given name
  this.search();
}

SoundTouchAccessory.prototype.search = function() {
  var accessory = this;
  accessory.soundtouch = soundtouch;

  accessory.soundtouch.search(
    function(device) {
      if (accessory.room != device.name) {
        accessory.log(
          "Ignoring device because the room name '%s' does not match the desired name '%s'.",
          device.name,
          accessory.room
        );
        return;
      }

      accessory.log('Found Bose SoundTouch device: %s', device.name);
      accessory.device = device;

      //we found the device, so stop looking
      soundtouch.stopSearching();
    },
    function(device) {
      accessory.log('Bose SoundTouch device goes offline: %s', device.name);
    }
  );
};

SoundTouchAccessory.prototype.getInformationService = function() {
  var informationService = new Service.AccessoryInformation();
  informationService
    .setCharacteristic(Characteristic.Name, this.name)
    .setCharacteristic(Characteristic.Manufacturer, 'Bose SoundTouch')
    .setCharacteristic(Characteristic.Model, '1.0.0')
    .setCharacteristic(Characteristic.SerialNumber, this.room);
  return informationService;
};

SoundTouchAccessory.prototype.getServices = function() {
  return [this.service, this.getInformationService()];
};

SoundTouchAccessory.prototype._getMute = function(callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;

  this.device.isAlive(function(isOn) {
    accessory.log('Check if is playing: %s', isOn);
    callback(null, !isOn);
  });
};

SoundTouchAccessory.prototype._setMute = function(mute, callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;

  if (!mute) {
    this.device.powerOn(function(isTurnedOn) {
      accessory.log(isTurnedOn ? 'Unmute' : 'Was already unmute');
      accessory.device.play(function(json) {
        accessory.log('Playing...');
        callback(null);
      });
    });
  } else {
    this.device.powerOff(function() {
      accessory.log('Mute...');
      callback(null);
    });
  }
};

SoundTouchAccessory.prototype._getVolume = function(callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;

  this.device.getVolume(function(json) {
    var volume = json.volume.actualvolume;
    accessory.log('Current volume: %s', volume);
    callback(null, volume * 1);
  });
};

SoundTouchAccessory.prototype._setVolume = function(volume, callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;

  this.device.setVolume(volume, function() {
    accessory.log('Setting volume to %s', volume);
    callback(null);
  });
};

SoundTouchAccessory.prototype._getPreset = function(preset, callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;
  Promise.all([
    new Promise(resolve => accessory.device.getPresets(resolve)),
    new Promise(resolve => accessory.device.getNowPlaying(resolve))
  ]).then(data => {
    const presets = data[0].presets;
    const nowPlaying = data[1].nowPlaying;
    const currentPreset = presets.preset[preset];

    if (!currentPreset) return callback(null, false);

    const currentPresetItem = currentPreset.ContentItem;
    const nowPlayingItem = nowPlaying.ContentItem;
    if (
      currentPresetItem.source === nowPlayingItem.source &&
        currentPresetItem.sourceAccount === nowPlayingItem.sourceAccount &&
        currentPresetItem.location === nowPlayingItem.location
    ) {
      return callback(null, true);
    }

    return callback(null, false);
  });
};

SoundTouchAccessory.prototype._setPreset = function(preset, value, callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;
  const presets = [];
  for (let index = MIN_PRESET; index <= MAX_PRESET; index++) {
    presets.push(index);
  }

  new Promise(resolve => accessory.device.pressKey(`PRESET_${preset}`, resolve))
    .then(data =>
      Promise.all(
        presets
          .filter(item => item !== preset)
          .map(
            item =>
              new Promise(resolve =>
                this.service
                  .getCharacteristic(`Preset${item}`)
                  .updateValue(false, resolve))
          )
          .concat([
            new Promise(resolve =>
              this.service.getCharacteristic('AUX').updateValue(false, resolve))
          ])
      ))
    .then(data => {
      callback(null);
    })
    .catch(error => {
      accessory.log(error);
      callback(error);
    });
};

SoundTouchAccessory.prototype._getAUX = function(callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;
  new Promise(resolve =>
    accessory.device.getNowPlaying(resolve)).then(nowPlaying => {
    if (nowPlaying.nowPlaying.ContentItem.source === 'AUX')
      return callback(null, true);
    return callback(null, false);
  });
};

SoundTouchAccessory.prototype._setAUX = function(value, callback) {
  if (!this.device) {
    this.log.warn(
      'Ignoring request; SoundTouch device has not yet been discovered.'
    );
    callback(new Error('SoundTouch has not been discovered yet.'));
    return;
  }

  var accessory = this;
  const presets = [];
  for (let index = MIN_PRESET; index <= MAX_PRESET; index++) {
    presets.push(index);
  }
  new Promise(resolve => accessory.device.pressKey('AUX_INPUT', resolve))
    .then(data =>
      Promise.all(
        presets.map(
          item =>
            new Promise(resolve =>
              this.service
                .getCharacteristic(`Preset${item}`)
                .updateValue(false, resolve))
        )
      ))
    .then(data => {
      callback(null);
    });
};

function makePresetCharacteristic(number) {
  const characteristic = function() {
    Characteristic.call(
      this,
      `Preset${number}`,
      `00000074-${number}000-1000-8000-0026BB765291`
    );
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [
        Characteristic.Perms.READ,
        Characteristic.Perms.WRITE,
        Characteristic.Perms.NOTIFY
      ]
    });
    this.value = this.getDefaultValue();
  };
  inherits(characteristic, Characteristic);
  characteristic.UUID = `00000074-${number}000-1000-8000-0026BB765291`;
  return characteristic;
}

function makeAUXCharacteristic() {
  const characteristic = function() {
    Characteristic.call(this, 'AUX', '00000074-0100-1000-8000-0026BB765291');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [
        Characteristic.Perms.READ,
        Characteristic.Perms.WRITE,
        Characteristic.Perms.NOTIFY
      ]
    });
    this.value = this.getDefaultValue();
  };
  inherits(characteristic, Characteristic);
  characteristic.UUID = '00000074-0100-1000-8000-0026BB765291';
  return characteristic;
}
