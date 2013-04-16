var assert = require('assert');
var createClient = require('../lib/lazy_redis_client');
var Script = require('../lib/redis_script');

var redisClient = createClient({
  port: 6379,
  host: 'localhost',
});
var s = new Script("return 10");
s.exec(redisClient, 0, function(err, result) {
  assert.ifError(err);
  assert.strictEqual(result, 10);
  redisClient.quit();
});
