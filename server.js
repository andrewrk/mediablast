var app = require('./lib/app')
  , http = require('http');

var env = {
  HOST: process.env.HOST || '0.0.0.0',
  PORT: parseInt(process.env.PORT || '14007', 10),
};
console.log("Using environment:", env);

handle = app.create();
http.createServer(handle);
http.listen(env.PORT, env.HOST, function() {
  console.log("Listening at http://" + env.HOST + ":" + env.PORT);
});
