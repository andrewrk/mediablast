module.exports = createRedisClient;

function createRedisClient(o) {
  var redis = require('redis');
  var client = redis.createClient(o.port, o.host);
  if (o.password) client.auth(o.password);
  if (o.db) {
    var db = parseInt(o.db, 10);
    client.select(db);
  }
  return client;
}
