var assert = require('assert')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter
  , fs = require('fs')
  , util = require('util')

module.exports = Settings;

function Settings(file) {
  EventEmitter.call(this);
  this.file = file;
  this.json = {
    completedJobLifespan: 1 * 30 * 60,
    templates: {},
    auth: {
      username: 'admin',
      password: '3pTkHwHV',
    }
  };
}

util.inherits(Settings, EventEmitter);

Settings.prototype.load = function(cb) {
  var self = this;
  fs.readFile(self.file, 'utf8', function(err, data){
    if (err) {
      return cb(err);
    }
    var json;
    try {
      json = JSON.parse(data);
    } catch (err) {
      return cb(err);
    }
    self.set(json);
    cb();
  });
};

Settings.prototype.set = function(json) {
  this.json = json;
  this.emit('update');
};

Settings.prototype.save = function(cb) {
  fs.writeFile(this.file, JSON.stringify(this.json, null, 2), cb);
};
