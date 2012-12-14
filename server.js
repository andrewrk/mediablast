var mediablast = require('./lib/app')
  , http = require('http');

var env = {
  HOST: process.env.HOST || '0.0.0.0',
  PORT: parseInt(process.env.PORT || '14007', 10),
};
console.log("Using environment:", env);

app = mediablast.create();

app.registerTask('audio.transcode', require('plan-transcode'));
app.registerTask('audio.waveform', require('plan-waveform'));
app.registerTask('image.thumbnail', require('plan-thumbnail'));
app.registerTask('s3.upload', require('plan-s3-upload'));
app.registerTask('s3.download', require('plan-s3-download'));
app.registerTask('meta.callback', require('plan-callback'));

http.createServer(app);
http.listen(env.PORT, env.HOST, function() {
  console.log("Listening at http://" + env.HOST + ":" + env.PORT);
});
