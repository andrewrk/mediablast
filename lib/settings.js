var assert = require('assert')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter
  , fs = require('fs')
  , util = require('util')

function Settings(file) {
  EventEmitter.call(this);
  this.file = file;
  this.json = {
    completed_job_lifespan: 1 * 30 * 60,
    templates: {},
    auth: {
      username: 'admin',
      password: '3pTkHwHV',
    }
  };
}

util.inherits(Settings, EventEmitter);

Settings.prototype.load = function(cb) {
  var this$ = this;
  fs.readFile(this.file, 'utf8', function(err, data){
    var json;
    if (err) {
      return cb(err);
    }
    try {
      json = JSON.parse(data);
    } catch (e$) {
      err = e$;
      return cb(err);
    }
    this$.set(json);
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
