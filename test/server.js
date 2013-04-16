var mediablast = require('../lib/app')
  , http = require('http')
  , path = require('path')

var env = {
  NODE_ENV: process.env.NODE_ENV = process.env.NODE_ENV || 'dev',
  HOST: process.env.HOST || '0.0.0.0',
  PORT: parseInt(process.env.PORT || '14007', 10),
};
console.info("Using environment:", env);

var app = mediablast({
  settingsFile: path.join(__dirname, "settings.json")
  //redis: {
  //  host: "localhost",
  //  port: 6379
  //},
});

// so that we can test the admin interface
app.registerTask('audio.transcode', require('plan-transcode'));
app.registerTask('audio.waveform', require('plan-waveform'));
app.registerTask('image.thumbnail', require('plan-thumbnail'));
app.registerTask('s3.upload', require('plan-s3-upload'));
app.registerTask('s3.download', require('plan-s3-download'));
app.registerTask('meta.callback', require('plan-callback'));

var server = http.createServer(app);
var listening = false;
server.listen(env.PORT, env.HOST, function() {
  console.info("Listening at http://" + env.HOST + ":" + env.PORT);
  listening = true;
  checkOnline();
});
var settingsLoaded = false;
app.once('settingsLoad', function() {
  settingsLoaded = true;
  checkOnline();
});

function checkOnline() {
  if (settingsLoaded && listening) {
    if (process.send) process.send('online');
  }
}

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
