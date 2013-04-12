exports.file = file;
exports.redis = redis;

var assert = require('assert')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter
  , fs = require('fs')
  , util = require('util')
  , createRedisClient = require('./lazy_redis_client')
  , REDIS_KEY = 'mediablast.settings;'

function file(fullPath) {
  return new FileSettings(fullPath);
}

function redis(options) {
  var dbClient = createRedisClient(options);
  var eventClient = createRedisClient(options);
  return new RedisSettings(dbClient, eventClient);
}

util.inherits(FileSettings, EventEmitter);
function FileSettings(file) {
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


FileSettings.prototype.load = function(cb) {
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

FileSettings.prototype.set = function(json) {
  this.json = json;
  this.emit('update');
};

FileSettings.prototype.save = function(cb) {
  fs.writeFile(this.file, JSON.stringify(this.json, null, 2), cb);
};

function RedisSettings(eventClient, dbClient) {
  EventEmitter.call(this);

  this.eventClient = eventClient;
  this.dbClient = dbClient;
}

util.inherits(RedisSettings, EventEmitter);
function RedisSettings(dbClient, eventClient) {
  EventEmitter.call(this);
  this.dbClient = dbClient;
  this.eventClient = eventClient;
  this.json = {
    completedJobLifespan: 1 * 30 * 60,
    templates: {},
    auth: {
      username: 'admin',
      password: '3pTkHwHV',
    }
  };
  this.eventClient.subscribe("mediablast.settings;");
}

RedisSettings.prototype.load = function(cb) {
  var self = this;
  self.dbClient.get(REDIS_KEY, function(err, data) {
    if (err) return cb(err);
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

RedisSettings.prototype.set = function(json) {
  this.json = json;
  this.emit('update');
};

RedisSettings.prototype.save = function(cb) {
  var self = this;
  var payload = JSON.stringify(self.json);
  self.dbClient.set(REDIS_KEY, payload, cb);
};

