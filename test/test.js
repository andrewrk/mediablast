var mediablast = require('../lib/app')
  , spawn = require('child_process').spawn
  , path = require('path')
  , Batch = require('batch')
  , fs = require('fs')
  , http = require('http')
  , url = require('url')
  , assert = require('assert')
  , querystring = require('querystring')
  , superagent = require('superagent')
  , EventSource = require('eventsource')
  , s3 = require('s3')
  , createRedisClient = require('../lib/lazy_redis_client')

var env = {
  S3_KEY: process.env.S3_KEY,
  S3_SECRET: process.env.S3_SECRET,
  S3_BUCKET: process.env.S3_BUCKET,
};

var redisClient = createRedisClient({
  host: 'localhost',
  port: 6379,
});

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

describe("bootup", function() {
  before(function(done) {
    var exe = spawn("./node_modules/.bin/naught", ["stop"]);
    exe.on('exit', function() { done(); });
  });
  after(function(done) {
    var batch = new Batch();
    batch.push(function(done) { fs.unlink("naught.log", done); });
    batch.push(function(done) { fs.unlink("stderr.log", done); });
    batch.push(function(done) { fs.unlink("stdout.log", done); });
    batch.push(function(done) { fs.unlink("test/settings.json", done); });
    batch.end(done);
  });
  it("boots", function(done) {
    var exe = spawn("./node_modules/.bin/naught", ["start", path.join(__dirname, "server.js")], {
      stdio: 'pipe'
    });
    var stderr = "";
    exe.stderr.setEncoding('utf8');
    exe.stderr.on('data', function(data) {
      stderr += data;
    });
    exe.on('close', function(code) {
      if (code === 0) {
        done();
      } else {
        console.error("naught stderr:", stderr);
        done(new Error("could not boot server"));
      }
    });
  });
  it("responds to status endpoint", function(done) {
    http.get(url.parse("http://localhost:14007/status"), function(resp) {
      assert.strictEqual(resp.statusCode, 200);
      done();
    });
  });
  it("deploys code", function(done) {
    var exe = spawn("./node_modules/.bin/naught", ["deploy"], {
      stdio: 'pipe'
    });
    var stderr = "";
    exe.stderr.setEncoding('utf8');
    exe.stderr.on('data', function(data) {
      stderr += data;
    });
    exe.on('exit', function(code) {
      if (code === 0) {
        done();
      } else {
        console.error("naught stderr:", stderr);
        done(new Error("could not deploy server"));
      }
    });
  });
  it("shuts down", function(done) {
    var exe = spawn("./node_modules/.bin/naught", ["stop"], {
      stdio: 'pipe'
    });
    var stderr = "";
    exe.stderr.setEncoding('utf8');
    exe.stderr.on('data', function(data) {
      stderr += data;
    });
    exe.on('exit', function(code) {
      if (code === 0) {
        done();
      } else {
        console.error("naught stderr:", stderr);
        done(new Error("could not shut down server"));
      }
    });
  });
});
describe("app", function() {
  function createServer(settingsObject, memory, cb) {
    settingsObject = settingsObject || {};
    var defaultSettings = {
      "version": 12,
      "completedJobLifespan": 1800,
      "templates": {},
      "auth": {
        "username": "admin",
        "password": "3pTkHwHV"
      }
    };
    extend(defaultSettings, settingsObject);
    var server = http.createServer();
    var payload = JSON.stringify(defaultSettings);
    if (memory) {
      var settingsFile = path.join(__dirname, "tmp.json");
      fs.writeFile(settingsFile, payload, function(err) {
        if (err) return cb(err)
        next({ settingsFile: settingsFile });
      });
    } else {
      redisClient.set("mediablast.settings;", payload, function(err) {
        next({
          sweepInterval: 1000,
          redis: {
            host: 'localhost',
            port: 6379,
          },
        });
      });
    }
    return server;
    function next(opts) {
      var app = mediablast(opts);
      app.registerTask('audio.transcode', require('plan-transcode'));
      app.registerTask('audio.waveform', require('plan-waveform'));
      app.registerTask('image.thumbnail', require('plan-thumbnail'));
      app.registerTask('s3.upload', require('plan-s3-upload'));
      app.registerTask('s3.download', require('plan-s3-download'));
      app.registerTask('meta.callback', require('plan-callback'));
      app.once('settingsLoad', function() {
        server.on('request', app);
        server.app = app;
        server.listen(cb);
      });
    }
  }
  describe("memory backend", function() {
    it("executes a complicated audio template", function(done) {
      audioTemplateTest(true, done);
    });
    it("executes a complicated image template", function(done) {
      imageTemplateTest(true, done);
    });
    it("removes jobs after a period of time", function(done) {
      testRemovingJobs(true, done);
    });
  });
  describe("redis backend", function() {
    it("executes a complicated audio template", function(done) {
      audioTemplateTest(false, done);
    });
    it("executes a complicated image template", function(done) {
      imageTemplateTest(false, done);
    });
    it("removes jobs after a period of time", function(done) {
      testRemovingJobs(false, done);
    });
  });
  function testRemovingJobs(memory, done) {
    var server = createServer({
      "completedJobLifespan": 0.1,
      "templates": {
        "16b924a9-89d0-41ce-b452-93478b5e60fc": {
          "tasks": {
            "callback": {
              "task": "meta.callback",
            },
          },
        },
      },
    }, memory, function() {
      var cbCount = 0;
      var cbServer = http.createServer(function(req, resp) {
        cbCount += 1;
        resp.statusCode = 200;
        resp.end();
      });
      cbServer.listen(function() {
        var url = "http://localhost:" + server.address().port + "/";
        var req = superagent.post(url);
        req.field('callbackUrl', 'http://localhost:' + cbServer.address().port + '/');
        req.field('templateId', "16b924a9-89d0-41ce-b452-93478b5e60fc");
        req.buffer();
        req.end(function(err, resp) {
          if (err) return done(err);
          assert.equal(resp.body.error, null);
          // this is just a field I added in the createServer
          // function to make testing easier
          var app = server.app;
          app.on('queueChange', function(jobsTable) {
            var count = 0;
            for (var job in jobsTable) {
              count += 1;
            }
            if (count === 0) {
              assert.strictEqual(cbCount, 1);
              cbServer.close();
              done();
            }
          });
        });
      });
    });
  }
  function imageTemplateTest(memory, done) {
    var server = createServer({
      "templates": {
        "16b924a9-89d0-41ce-b452-93478b5e60fc": {
          "options": {
            "s3.upload": {
              "s3Key": env.S3_KEY,
              "s3Secret": env.S3_SECRET,
              "s3Bucket": env.S3_BUCKET,
            }
          },
          "tasks": {
            "original": {
              "task": "s3.upload",
              "options": {
                "url": "/{uuid}/original{ext}",
              },
            },
            "tiny": {
              "task": "image.thumbnail",
              "options": {
                "format": "png",
                "width": 30,
                "height": 30,
                "strip": true,
                "crop": false,
              },
            },
            "tiny_upload": {
              "task": "s3.upload",
              "options": {
                "url": "/{uuid}/tiny{ext}",
              },
              "dependencies": [
                'tiny'
              ],
            },
            "small": {
              "task": "image.thumbnail",
              "options": {
                "format": "png",
                "width": 40,
                "height": 40,
                "strip": true,
                "crop": false,
              },
            },
            "small_upload": {
              "task": "s3.upload",
              "options": {
                "url": "/{uuid}/tiny{ext}",
              },
              "dependencies": [
                'tiny'
              ],
            },
          }
        }
      }
    }, memory, function() {
      var url = "http://localhost:" + server.address().port + "/";
      var req = superagent.post(url);
      req.attach('file', path.join(__dirname, 'calvin-chess.png'));
      req.field('templateId', "16b924a9-89d0-41ce-b452-93478b5e60fc");
      req.buffer();
      req.end(function(err, resp) {
        if (err) return done(err);
        assert.equal(resp.body.error, null);
        assert.strictEqual(resp.body.state, 'processing');
        assert.strictEqual(resp.body.originalFileName, 'calvin-chess.png');
        assert.strictEqual(resp.body.originalFileSize, 126245);
        var progress = resp.body.progress;
        assert.strictEqual(progress, 0);

        var esUrl = "http://localhost:" + server.address().port + "/status/" + resp.body.id;
        var source = new EventSource(esUrl);
        source.addEventListener('message', onMessage, false);
        source.addEventListener('error', onError, false);
        function onError(event) {
          if (source.readyState !== EventSource.CLOSED) {
            done(new Error("event source error: " + event));
          }
        }
        function onMessage(e) {
          var job = JSON.parse(e.data);
          // make sure the progress doesn't go down too much
          assert(job.progress - progress > -0.5,
            "old progress: " + progress + ", new progress: " + job.progress);
          progress = job.progress;
          if (job.state === 'complete') {
            source.close();
            assert.strictEqual(progress, 1);
            assert.strictEqual(job.state, 'complete');
            assert.ok(! job.error, "job status is error");
            done();
          }
        }
      });
    });
  }
  function audioTemplateTest(memory, done) {
    var batch = new Batch();
    var server;
    batch.push(function(cb) {
      server = createServer({
        "templates": {
          "16b924a9-89d0-41ce-b452-93478b5e60fc": {
            "tasks": {
              "fetch": {
                "task": "s3.download",
                "options": {
                  "s3Key": env.S3_KEY,
                  "s3Secret": env.S3_SECRET,
                  "s3Bucket": env.S3_BUCKET,
                },
              },
              "waveform": {
                "task": "audio.waveform",
                "options": {
                  "width": 1800,
                  "height": 200,
                  "colorCenter": "0081daff",
                  "colorOuter": "004678ff",
                  "colorBg": "00000000",
                },
                "dependencies": ["fetch"],
              },
              "waveform_upload": {
                "task": "s3.upload",
                "options": {
                  "url": "/{uuid}/waveform{ext}",
                  "s3Key": env.S3_KEY,
                  "s3Secret": env.S3_SECRET,
                  "s3Bucket": env.S3_BUCKET,
                },
                "dependencies": ["waveform"],
              },
              "preview": {
                "task": "audio.transcode",
                "options": {
                  "bitRate": 192,
                  "sampleRate": 44100,
                  "format": "mp3",
                },
                "dependencies": ["fetch"],
              },
              "preview_upload": {
                "task": "s3.upload",
                "options": {
                  "url": "/{uuid}/preview{ext}",
                  "s3Key": env.S3_KEY,
                  "s3Secret": env.S3_SECRET,
                  "s3Bucket": env.S3_BUCKET,
                },
                "dependencies": ["preview"],
              },
              "callback": {
                "task": "meta.callback",
                "options": {
                  "ignoreDependencyErrors": true,
                },
                "dependencies": [
                  "waveform_upload",
                  "preview_upload",
                ],
              },
            },
          },
        },
      }, memory, cb);
    });
    var cbCount = 0;
    var cbServer;
    batch.push(function(cb) {
      cbServer = http.createServer(function(req, resp) {
        cbCount += 1;
        resp.statusCode = 200;
        resp.end();
      });
      cbServer.listen(cb);
    });
    batch.push(function(cb) {
      var client = s3.createClient({
        "key": env.S3_KEY,
        "secret": env.S3_SECRET,
        "bucket": env.S3_BUCKET,
      });
      var uploader = client.upload(path.join(__dirname, "48000.wav"), "/mediablast-test/48000.wav")
      uploader.on('error', done);
      uploader.on('end', cb);
    });
    batch.end(function(err) {
      if (err) return done(err);
      perform();
    });
    function perform() {
      var url = "http://localhost:" + server.address().port + "/";
      var req = superagent.post(url);
      req.field('callbackUrl', "http://localhost:" + cbServer.address().port + "/");
      req.field('s3Url', "/mediablast-test/48000.wav");
      req.field('templateId', "16b924a9-89d0-41ce-b452-93478b5e60fc");
      req.buffer();
      req.end(function(err, resp) {
        if (err) return done(err);
        assert.equal(resp.body.error, null);
        assert.strictEqual(resp.body.state, 'processing');
        var progress = resp.body.progress;
        assert.strictEqual(progress, 0);

        var esUrl = "http://localhost:" + server.address().port + "/status/" + resp.body.id;
        var source = new EventSource(esUrl);
        source.addEventListener('message', onMessage, false);
        source.addEventListener('error', onError, false);
        function onError(event) {
          if (source.readyState !== EventSource.CLOSED) {
            done(new Error("event source error: " + event));
          }
        }
        function onMessage(e) {
          var job = JSON.parse(e.data);
          // make sure the progress doesn't go down too much
          assert(job.progress - progress > -0.5,
            "old progress: " + progress + ", new progress: " + job.progress);
          progress = job.progress;
          if (job.state === 'complete') {
            source.close();
            assert.strictEqual(progress, 1);
            assert.strictEqual(job.state, 'complete');
            assert.ok(! job.error, "job status is error");
            assert.strictEqual(cbCount, 1);
            done();
          }
        }
      });
    }
  }
  describe("admin", function() {
    describe("memory backend", function() {
      it("fails getting settings with bad password", function(done) {
        testGetSettingsBadPassword(true, done);
      });
      it("displays the get settings page", function(done) {
        testDisplayGetSettingsPage(true, done);
      });
      it("accepts an update to settings", function(done) {
        testUpdateSettings(true, done);
      });
    });
    describe("redis backend", function() {
      it("fails getting settings with bad password", function(done) {
        testGetSettingsBadPassword(false, done);
      });
      it("displays the get settings page", function(done) {
        testDisplayGetSettingsPage(false, done);
      });
      it("accepts an update to settings", function(done) {
        testUpdateSettings(false, done);
      });
    });
    function testUpdateSettings(memory, done) {
      var server = createServer(null, memory, function() {
        if (memory) {
          fs.readFile(path.join(__dirname, "tmp.json"), 'utf8', next);
        } else {
          redisClient.get("mediablast.settings;", next);
        }
        function next(err, settingsJson) {
          if (err) return done(err);
          var settingsObj = JSON.parse(settingsJson);
          var opts = {
            host: 'localhost',
            port: server.address().port,
            method: 'POST',
            path: '/admin/settings',
            auth: 'admin:3pTkHwHV',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            }
          };
          var req = http.request(opts, function(resp) {
            resp.setEncoding('utf8');
            var body = ""
            resp.on('data', function (chunk) {
              body += chunk;
            });
            resp.on('end', function() {
              assert.ok(/Saved/.test(body));
              if (memory) {
                fs.unlink(path.join(__dirname, "tmp.json"), done);
              } else {
                done();
              }
            });
          });
          req.on('error', done);
          req.write(querystring.stringify({
            settings: JSON.stringify(settingsObj).toString('utf8'),
          }));
          req.end();
        }
      });
    }
    function testDisplayGetSettingsPage(memory, done) {
      var server = createServer(null, memory, function() {
        var opts = {
          host: 'localhost',
          port: server.address().port,
          method: 'GET',
          path: '/admin/settings',
          auth: 'admin:3pTkHwHV',
        };
        var req = http.request(opts, function (resp) {
          resp.setEncoding('utf8');
          var body = ""
          resp.on('data', function (chunk) {
            body += chunk;
          });
          resp.on('end', function() {
            assert.ok(/submit/.test(body));
            assert.ok(/textarea/.test(body));
            assert.ok(/&quot;username&quot;:/.test(body));
            done()
          });
        });
        req.on('error', done);
        req.end()
      });
    }
    function testGetSettingsBadPassword(memory, done) {
      var server = createServer(null, memory, function() {
        var opts = {
          host: 'localhost',
          port: server.address().port,
          method: 'GET',
          path: '/admin/settings',
        };
        var req = http.request(opts, function (resp) {
          resp.setEncoding('utf8');
          var body = ""
          resp.on('data', function (chunk) {
            body += chunk;
          });
          resp.on('end', function() {
            assert.ok(/Unauthorized/.test(body));
            done()
          });
        });
        req.on('error', done);
        req.end()
      });
    }
  });
});

var own = {}.hasOwnProperty;
function extend(obj, src){
  for (var key in src) {
    if (own.call(src, key)) obj[key] = src[key];
  }
  return obj;
}
