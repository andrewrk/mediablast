var assert = require('assert')
  , express = require('express')
  , path = require('path')
  , extend = require('node.extend')
  , temp = require('temp')
  , fs = require('fs')
  , EventEmitter = require('events').EventEmitter
  , cors = require('connect-xcors')()
  , sse = require('connect-sse')()
  , redis = require('redis')
  , Batch = require('batch')
  , Jobs = require('./jobs')
  , Settings = require('./settings')

exports.create = create;

function errorMiddleware(err, req, res, next){
  console.error(err.stack);
  next(err);
}

var bodyParser = express.bodyParser({
  keepExtensions: true
});

function deleteReqTempFiles(req){
  var name, file;
  for (name in req.files) {
    file = req.files[name];
    fs.unlink(file.path, onError);
  }
  function onError(err){
    if (err) console.error("Unable to delete temp file:", err.stack);
  }
}

function create(env, callback){
  var batch;
  batch = new Batch();
  batch.push(createRedisClient);
  batch.push(createRedisClient);
  batch.push(createRedisClient);
  batch.push(createRedisClient);
  batch.end(function(err, clients){
    if (err) return callback(err);
    var settingsIo = clients[0]
      , settingsPubSub = clients[1]
      , jobsIo = clients[2]
      , jobsPubSub = clients[3];
    loadSettings();
    function loadSettings(){
      var settings;
      settings = new Settings(settingsIo, settingsPubSub);
      settings.on('update', callCreateApp);
      settings.on('error', onError);
      function onError(err){
        console.error("Unable to get settings from redis:", err);
        callCreateApp();
      }
      function callCreateApp(){
        settings.removeEventListener('error', onError);
        settings.removeEventListener('update', callCreateApp);
        callback(null, createApp(jobsIo, jobsPubSub, settings));
      }
    }
  });
  function createRedisClient(cb){
    var redisClient = redis.createClient(env.REDIS_PORT, env.REDIS_HOST);
    redisClient.select(env.REDIS_DB, function(err){
      if (err) return cb(err);
      if (env.REDIS_PASSWORD) {
        redisClient.auth(env.REDIS_PASSWORD, function(err){
          if (err) return cb(err);
          cb(null, redisClient);
        });
      } else {
        cb(null, redisClient);
      }
    });
  }
}
function createApp(redisIo, redisPubSub, settings){
  var jobs, app;
  jobs = new Jobs(redisIo, redisPubSub);
  jobs.on('complete', function(){
    if (jobs.incompleteCount() === 0) app.emit('jobQueueEmpty');
  });
  settings.on('update', function(){
    jobs.completedJobLifespan = settings.json.completedJobLifespan;
  });
  var auth = express.basicAuth(function(user, pass){
    return user === settings.json.auth.username && pass === settings.json.auth.password;
  });
  app = express();
  app.jobQueueIsEmpty = function() {
    return jobs.incompleteCount() === 0;
  };
  app.configure(function(){
    app.set('views', path.join(__dirname, '../src/server/views'));
    app.set('view engine', 'ejs');
    app.use(app.router);
    app.use(express['static'](path.join(__dirname, '../public')));
    app.use(express['static'](path.join(__dirname, '../src/public')));
    app.use(errorMiddleware);
  });
  app.configure('dev', function(){
    app.use(express.errorHandler());
  });
  app.post('/', [bodyParser, cors], function(req, resp){
    var templateId = req.body.templateId;
    var userTemplate = settings.json.templates[templateId];
    if (userTemplate) {
      var template = extend({}, userTemplate, {id: templateId})
      createWithTemplate(req, resp, template);
    } else {
      deleteReqTempFiles(req);
      resp.json({
        state: 'complete',
        error: 'InvalidTemplateId',
        message: "You must supply a valid templateId to upload."
      });
    }
  });
  app.get('/poll/:id', cors, function(req, resp){
    resp.json(jobStatus(req.params.id));
  });
  app.get('/status/:id', [sse, cors], function(req, resp){
    resp.setMaxListeners(0);
    function jobsOn(event, cb){
      jobs.on(event, cb);
      resp.on('close', function(){
        jobs.removeListener(event, cb);
      });
    }
    var job = jobStatus(req.params.id);
    resp.json(job);
    jobsOn("update." + job.id, function(it){
      resp.json(it);
    });
  });
  app.get('/admin', auth, function(req, resp){
    resp.render('index');
  });
  app.get('/admin/test', auth, function(req, resp){
    resp.render('test');
  });
  app.get('/admin/settings', auth, function(req, resp){
    var jsonSettings = JSON.stringify(settings, null, 2);
    resp.render('settings', {
      settings: jsonSettings,
      saved: false,
      error: null
    });
  });
  app.post('/admin/settings', [auth, bodyParser], function(req, resp){
    var jsonSettings, parsedSettings, ex;
    deleteReqTempFiles(req);
    jsonSettings = JSON.stringify(settings, null, 2);
    try {
      parsedSettings = JSON.parse(req.body.settings);
    } catch (ex) {
      resp.render('settings', {
        settings: jsonSettings,
        saved: false,
        error: "Invalid JSON"
      });
      return;
    }
    settings.set(parsedSettings);
  });
  app.get('/admin/status', auth, function(req, resp){
    resp.render('status', {
      jobs: jobs.table
    });
  });
  app.get('/admin/status/events', [auth, sse], function(req, resp){
    var id, job;
    resp.setMaxListeners(0);
    resp.json({
      name: 'dump',
      jobs: jobs.table
    });
    for (id in jobs.table) {
      job = jobs.table[id];
      listenToJobEvents(job);
    }
    jobsOn('new', function(job){
      resp.json({
        name: 'new',
        job: job
      });
      listenToJobEvents(job);
    });
    jobsOn('error', function(error){
      resp.json({
        name: 'error',
        error: error
      });
    });
    function jobsOn(event, cb){
      jobs.on(event, cb);
      resp.on('close', function(){
        jobs.removeListener(event, cb);
      });
    }
    function listenToJobEvents(job){
      jobsOn("update." + job.id, function(updatedJob){
        job = updatedJob;
        resp.json({
          name: 'update',
          job: job
        });
      });
      jobsOn("complete." + job.id, function(){
        resp.json({
          name: 'complete',
          job: job
        });
      });
      jobsOn("delete." + job.id, function(){
        resp.json({
          name: 'delete',
          job: job
        });
      });
    }
  });
  return app;

  function jobStatus(jobId){
    return jobs.table[jobId] || {
      id: jobId,
      state: 'complete',
      error: 'JobNotFound',
      message: "The job does not exist."
    };
  }

  function createWithTemplate(req, resp, templateId, template){
    var files = []
      , tempFiles = []
      , file
      , name;
    for (name in req.files) {
      file = req.files[name];
      files.push(file);
      tempFiles.push(file.path);
    }
    var context = req.body;
    context.makeTemp = makeTemp;
    if (tempFiles.length === 1) {
      context.tempPath = tempFiles[0];
    } else if (tempFiles.length > 1) {
      context.tempPathList = tempFiles;
    }
    var job = jobs.create(context, template, deleteTempFiles);
    resp.json(job);
    function makeTemp(opts){
      var x = temp.path(opts);
      tempFiles.push(x);
      return x;
    }
    function deleteTempFiles(){
      tempFiles.forEach(function(tempFile) {
        fs.unlink(tempFile, onError);
      });
      function onError(err){
        if (err) console.error("Unable to delete temp file:", err.stack);
      }
    }
  }
}
