var path, assert, fs, Batch, http, https, Settings, createApp, env, settings;
path = require('path');
assert = require('assert');
fs = require('fs');
Batch = require('batch');
http = require('http');
https = require('https');
Settings = require('./settings');
createApp = require('./app').create;
env = {
  PORT: process.env.PORT || 13116,
  HOST: process.env.HOST || 'localhost',
  NODE_ENV: process.env.NODE_ENV = process.env.NODE_ENV || 'dev',
  SSL_PORT: process.env.SSL_PORT || 13117,
  SSL_KEY: process.env.SSL_KEY || path.join(__dirname, "../deploy/site-cookbooks/self_signed_cert/files/default/ca.key"),
  SSL_CERT: process.env.SSL_CERT || path.join(__dirname, "../deploy/site-cookbooks/self_signed_cert/files/default/ca.crt")
};
settings = new Settings(path.join(__dirname, "../settings.json"));
settings.load(function(err){
  var app, batch;
  if ((err != null ? err.code : void 8) === 'ENOENT') {
    console.warn("no settings.json file. Wrote default settings to " + settings.file);
    settings.save();
  } else if (err) {
    console.error("Unable to open settings file:", err.stack);
    return;
  }
  app = createApp(settings);
  function startHttp(cb){
    var http_server;
    http_server = http.createServer(app);
    http_server.listen(parseInt(env.PORT, 10), env.HOST, function(){
      console.info(env.NODE_ENV + " server listening at http://" + env.HOST + ":" + env.PORT + "/ as user " + process.getuid());
      cb();
    });
  }
  function startHttps(cb){
    var key, cert, https_server;
    key = fs.readFileSync(env.SSL_KEY);
    cert = fs.readFileSync(env.SSL_CERT);
    https_server = https.createServer({
      key: key,
      cert: cert
    }, app);
    https_server.listen(parseInt(env.SSL_PORT, 10), env.HOST, function(){
      console.info(env.NODE_ENV + " server listening at https://" + env.HOST + ":" + env.SSL_PORT + "/ as user " + process.getuid());
      cb();
    });
  }
  installShutdownHook();
  batch = new Batch();
  if (!process.env.DISABLE_HTTP) {
    batch.push(startHttp);
  }
  if (!process.env.DISABLE_HTTPS) {
    batch.push(startHttps);
  }
  batch.end(function(err){
    assert.ifError(err);
    process.send('online');
  });
  function installShutdownHook(){
    var shutting_down;
    shutting_down = false;
    process.on('message', function(msg){
      if (msg === 'shutdown') {
        shutting_down = true;
        checkShutdown();
      }
    });
    app.onQueueChange = checkShutdown;
    function checkShutdown(){
      if (shutting_down && app.queueIsEmpty()) {
        process.exit(0);
      }
    }
  }
});