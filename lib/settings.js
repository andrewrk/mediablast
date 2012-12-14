var assert, path, EventEmitter, fs, SETTINGS_VERSION, Settings;
assert = require('assert');
path = require('path');
EventEmitter = require('events').EventEmitter;
fs = require('fs');
SETTINGS_VERSION = 12;
module.exports = Settings = (function(superclass){
  Settings.displayName = 'Settings';
  var prototype = extend$(Settings, superclass).prototype, constructor = Settings;
  function Settings(file){
    this.file = file;
    this.json = {
      version: SETTINGS_VERSION,
      completed_job_lifespan: 1 * 30 * 60,
      templates: {},
      auth: {
        username: 'admin',
        password: '3pTkHwHV'
      }
    };
  }
  prototype.load = function(cb){
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
      assert.strictEqual(json.version, SETTINGS_VERSION, "settings version is " + json.version + " but should be " + SETTINGS_VERSION);
      this$.set(json);
      cb();
    });
  };
  prototype.set = function(json){
    this.json = json;
    this.emit('update');
  };
  prototype.save = function(cb){
    fs.writeFile(this.file, JSON.stringify(this.json, null, 2), cb);
  };
  return Settings;
}(EventEmitter));
function extend$(sub, sup){
  function fun(){} fun.prototype = (sub.superclass = sup).prototype;
  (sub.prototype = new fun).constructor = sub;
  if (typeof sup.extended == 'function') sup.extended(sub);
  return sub;
}
