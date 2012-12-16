var assert = require('assert')
  , express = require('express')
  , path = require('path')
  , temp = require('temp')
  , fs = require('fs')
  , cors = require('connect-xcors')()
  , sse = require('connect-sse')()
  , Jobs = require('./jobs')
  , Settings = require('./settings')

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
    fs.unlink(file.path, fn$);
  }
  function fn$(err){
    if (err) {
      console.error("Unable to delete temp file:", err.stack);
    }
  }
}

function create(options){
  var app = express();
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
  app.post('/', [bodyParser, cors], function(req, resp){
    var templateId, user_template, ref$, template;
    templateId = req.body.templateId;
    user_template = settings.json.templates[templateId];
    if (user_template) {
      template = {}
      import$(template, user_template)
      template.id = templateId
      createWithTemplate(req, resp, templateId, template);
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
    var job;
    resp.setMaxListeners(0);
    function jobsOn(event, cb){
      jobs.on(event, cb);
      resp.on('close', function(){
        jobs.removeListener(event, cb);
      });
    }
    job = jobStatus(req.params.id);
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
    var json_settings;
    json_settings = JSON.stringify(settings.json, null, 2);
    resp.render('settings', {
      settings: json_settings,
      saved: false,
      error: null
    });
  });
  app.post('/admin/settings', [auth, bodyParser], function(req, resp){
    var json_settings, parsed_settings, ex;
    deleteReqTempFiles(req);
    json_settings = JSON.stringify(settings.json, null, 2);
    try {
      parsed_settings = JSON.parse(req.body.settings);
    } catch (e$) {
      ex = e$;
      resp.render('settings', {
        settings: json_settings,
        saved: false,
        error: "Invalid JSON"
      });
      return;
    }
    settings.set(parsed_settings);
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
    var id, ref$, job;
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
    jobs.completed_job_lifespan = 1000 * settings.json.completed_job_lifespan;
  }
  function createWithTemplate(req, resp, templateId, template){
    var res$, name, ref$, file, files, i$, len$, f, temp_files, context, job;
    res$ = [];
    for (name in req.files) {
      file = req.files[name];
      res$.push(file);
    }
    files = res$;
    res$ = [];
    for (i$ = 0, len$ = files.length; i$ < len$; ++i$) {
      f = files[i$];
      res$.push(f.path);
    }
    temp_files = res$;
    context = req.body
    context.makeTemp = makeTemp
    if (temp_files.length === 1) {
      context.tempPath = temp_files[0];
    } else if (temp_files.length > 1) {
      context.tempPathList = temp_files;
    }
    job = jobs.create(context, template, deleteTempFiles);
    resp.json(job);
    function makeTemp(opts){
      var x;
      x = temp.path(opts);
      temp_files.push(x);
      return x;
    }
    function deleteTempFiles(){
      var i$, ref$, len$, temp_file;
      for (i$ = 0, len$ = (ref$ = temp_files).length; i$ < len$; ++i$) {
        temp_file = ref$[i$];
        fs.unlink(temp_file, fn$);
      }
      function fn$(err){
        if (err) {
          console.error("Unable to delete temp file:", err.stack);
        }
      }
    }
  }
  function jobStatus(job_id, cb){
    return jobs.table[job_id] || {
      id: job_id,
      state: 'complete',
      error: 'JobNotFound',
      message: "The job does not exist."
    };
  }
}
function import$(obj, src){
  var own = {}.hasOwnProperty;
  for (var key in src) if (own.call(src, key)) obj[key] = src[key];
  return obj;
}
