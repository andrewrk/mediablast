var crypto = require('crypto')
  , slice = Array.prototype.slice
  , fs = require('fs')
  , path = require('path')

module.exports = Script;
Script.load = load;

// sync - should be called at setup time only
function load(file) {
  var body = fs.readFileSync(file, { encoding: 'utf8' });
  return new Script(body);
}

function Script(body) {
  this.body = body;
  var hash = crypto.createHash('sha1');
  hash.update(body);
  this.sha1 = hash.digest('hex');
}

Script.prototype.exec = function(redisClient) {
  var self = this;
  var evalArgs = slice.call(arguments, 1);
  var cb = evalArgs.pop();
  var args = [self.sha1].concat(evalArgs).concat(onEvalShaDone);
  redisClient.evalsha.apply(redisClient, args);

  function onEvalShaDone(err, results) {
    if (err && /^Error: NOSCRIPT/.test(err.message)) {
      tryEvalInstead();
    } else {
      tryEvalInstead();
      cb(err, results);
    }
  }

  function tryEvalInstead() {
    var args = [self.body].concat(evalArgs).concat(cb);
    redisClient.eval.apply(redisClient, args);
    redisClient.script("load", self.body);
  }
};
