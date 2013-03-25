var assert = require('assert')
  , express = require('express')
  , path = require('path')
  , temp = require('temp')
  , fs = require('fs')
  , cors = require('connect-xcors')({
      headers: ['X-Requested-With', 'X-HTTP-Method-Override', 'Content-Type', 'Accept', 'Authorization']
    })
  , sse = require('connect-sse')()
  , Jobs = require('./jobs')
  , Settings = require('./settings')
  , extend = require('./extend')

var bodyParser = express.bodyParser({
  keepExtensions: true
});

module.exports = create;

function errorMiddleware(err, req, res, next){
  console.error(err.stack);
  next(err);
}

function noCacheMiddleware(req, res, next){
  res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0');
  next();
}

function deleteReqTempFiles(req){
  var name, file;
  for (name in req.files) {
    file = req.files[name];
    fs.unlink(file.path, logIfError);
  }
  function logIfError(err){
    if (err) {
      console.error("Unable to delete temp file:", err.stack);
    }
  }
}

function create(options){
  var app = options.app || express();
  var settings = new Settings(options.settingsFile);
  settings.load(function(err){
    if (err && err.code === 'ENOENT') {
      console.warn("no settings.json file. Wrote default settings to " + settings.file);
      settings.save();
    } else if (err) {
      console.error("Unable to open settings file. Using default settings. ", err.stack);
    }
    app.emit('settingsLoad');
  });
  var jobs = new Jobs();
  settings.on('update', setCompletedJobLifespan);
  setCompletedJobLifespan();
  var auth = express.basicAuth(function(user, pass){
    return user === settings.json.auth.username && pass === settings.json.auth.password;
  });
  jobs.on('complete', function(){
    app.emit('queueChange', jobs.table);
  });
  jobs.on('delete', function(){
    app.emit('queueChange', jobs.table);
  });
  app.queueIsEmpty = function(){
    return jobs.incompleteCount() === 0;
  };
  app.registerTask = function(name, module) {
    jobs.registerTask(name, module);
  };
  app.configure(function(){
    app.set('views', path.join(__dirname, '../views'));
    app.set('view engine', 'ejs');
    app.use(cors);
    app.use(noCacheMiddleware);
    app.use(app.router);
    app.use(express.static(path.join(__dirname, '../public')));
    app.use(errorMiddleware);
  });
  app.configure('dev', function(){
    app.use(express.errorHandler());
  });
  app.get('/status', function(req, resp){
    resp.json({
      success: true
    });
  });
  app.post('/', [bodyParser], function(req, resp){
    var templateId = req.body.templateId;
    var userTemplate = settings.json.templates[templateId];
    var template;
    if (userTemplate) {
      template = {}
      extend(template, userTemplate)
      template.id = templateId
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
  app.get('/poll/:id', function(req, resp){
    resp.json(jobStatus(req.params.id));
  });
  app.get('/status/:id', [sse], function(req, resp){
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
    var jsonSettings = JSON.stringify(settings.json, null, 2);
    resp.render('settings', {
      settings: jsonSettings,
      saved: false,
      error: null
    });
  });
  app.post('/admin/settings', [auth, bodyParser], function(req, resp){
    deleteReqTempFiles(req);
    var jsonSettings = JSON.stringify(settings.json, null, 2);
    var parsedSettings;
    try {
      parsedSettings = JSON.parse(req.body.settings);
    } catch (err) {
      resp.render('settings', {
        settings: jsonSettings,
        saved: false,
        error: "Invalid JSON"
      });
      return;
    }
    settings.set(parsedSettings);
    settings.save(function(err){
      resp.render('settings', {
        settings: JSON.stringify(settings.json, null, 2),
        saved: true,
        error: err != null ? err.stack : void 8
      });
    });
  });
  app.get('/admin/status', auth, function(req, resp){
    resp.render('status', {
      jobs: jobs.table
    });
  });
  app.get('/admin/status/events', [auth, sse], function(req, resp){
    resp.setMaxListeners(0);
    resp.json({
      name: 'dump',
      jobs: jobs.table
    });
    var id, job;
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
      jobsOn("update." + job.id, function(_job){
        job = _job;
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
  function setCompletedJobLifespan(){
    jobs.completedJobLifespan = 1000 * settings.json.completedJobLifespan;
  }
  function createWithTemplate(req, resp, template){
    var files = [], tempFiles = [], name, file;
    for (name in req.files) {
      file = req.files[name];
      files.push(file);
      tempFiles.push(file.path);
    }
    var context = req.body;
    context.makeTemp = makeTemp;
    if (tempFiles.length === 1) {
      context.tempPath = tempFiles[0];
      context.originalFileName = files[0].name;
      context.originalFileSize = files[0].size;
    } else if (tempFiles.length > 1) {
      context.tempPathList = tempFiles;
      context.originalFileNameList = files.map(function(file) { return file.name; });
      context.originalFileSizeList = files.map(function(file) { return file.size; });
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
        fs.unlink(tempFile, logIfError);
      });
      function logIfError(err) {
        if (err) {
          console.error("Unable to delete temp file:", err.stack);
        }
      }
    }
  }
  function jobStatus(jobId, cb){
    return jobs.table[jobId] || {
      id: jobId,
      state: 'complete',
      error: 'JobNotFound',
      message: "The job does not exist."
    };
  }
}
