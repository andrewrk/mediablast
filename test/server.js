var mediablast = require('../lib/app')
  , http = require('http')
  , path = require('path')

var env = {
  NODE_ENV: process.env.NODE_ENV = process.env.NODE_ENV || 'dev',
  HOST: process.env.HOST || '0.0.0.0',
  PORT: parseInt(process.env.PORT || '14007', 10),
};
console.log("Using environment:", env);

var app = mediablast({
  settingsFile: path.join(__dirname, "settings.json")
});

var server = http.createServer(app);
server.listen(env.PORT, env.HOST, function() {
  console.log("Listening at http://" + env.HOST + ":" + env.PORT);
  if (process.send) process.send('online');
});

installShutdownHook();

function installShutdownHook() {
  var shuttingDown = false;
  process.on('message', function(msg) {
    if (msg === 'shutdown') {
      shuttingDown = true;
      checkShutdown();
    }
  });
  app.on('queueChange', checkShutdown);
  function checkShutdown() {
    if (shuttingDown && app.queueIsEmpty()) {
      process.exit(0);
    }
  }
}
