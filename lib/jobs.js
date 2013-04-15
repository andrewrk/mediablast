var EventEmitter = require('events').EventEmitter
  , makeUuid = require('node-uuid')
  , Plan = require('plan')
  , assert = require('assert')
  , createRedisClient = require('./lazy_redis_client')
  , util = require('util')
  , extend = require('./extend')
  , fs = require('fs')
  , path = require('path')
  , crypto = require('crypto')
  , RedisScript = require('./redis_script')
  , flushOldJobsScript = RedisScript.load(path.join(__dirname, "flush_old_jobs.lua"))
  , SWEEP_INTERVAL_REDIS = 1000 * 60 * 10 // ten minutes
  , SWEEP_INTERVAL_MEMORY = 1000 // one second

module.exports = Jobs;

util.inherits(Jobs, EventEmitter);
function Jobs(options) {
  var self = this;

  EventEmitter.call(self);

  options = options || {};

  self.sweepIntervalMs = options.sweepInterval;
  if (options.redis) {
    var dbClient = createRedisClient(options.redis);
    var eventClient = createRedisClient(options.redis);
    self.state = new RedisState(self, dbClient, eventClient);
  } else {
    self.state = new MemoryState(self);
  }
  self.state.setCompletedJobLifespan(5 * 60 * 1000);
  self.table = self.state.table;

  self.tasks = {};
  self.setMaxListeners(0);
}

Jobs.prototype.setCompletedJobLifespan = function(value) {
  this.state.setCompletedJobLifespan(value);
};

Jobs.prototype.registerTask = function(name, module) {
  this.tasks[name] = module;
};

Jobs.prototype.incompleteCount = function(){
  var count = 0, id, job;
  for (id in this.table) {
    job = this.table[id];
    if (!job.endDate) {
      count += 1;
    }
  }
  return count;
};

Jobs.prototype.create = function(context, template, doneCallback){
  var self = this;
  var job = {
    id: makeUuid(),
    progress: 0,
    state: 'processing',
    error: null,
    message: null,
    startDate: new Date(),
    endDate: null,
    info: {}
  };
  if (context.originalFileName) job.originalFileName = context.originalFileName;
  if (context.originalFileNameList) job.originalFileNameList = context.originalFileNameList;
  if (context.originalFileSize) job.originalFileSize = context.originalFileSize;
  if (context.originalFileSizeList) job.originalFileSizeList = context.originalFileSizeList;
  context.callbackData = job;
  self.state.addJob(job, function(err) {
    if (err) {
      console.error("unable to add job:", err.stack);
      job.state = 'complete';
      job.error = 'InternalError';
      job.message = "Internal error creating job.";
      doneCallback();
      return job;
    }
    assert.ok(template.id);
    var plan = new Plan(template.id);
    var taskInstances = {};
    var templateScopeOptions = template.options || {};
    var taskName, taskConfig, nonlocalOptions, taskScopeOptions;
    var optionsToUse, taskDefinition, task;
    for (taskName in template.tasks) {
      taskConfig = template.tasks[taskName];
      nonlocalOptions = templateScopeOptions[taskConfig.task] || {};
      taskScopeOptions = taskConfig.options || {};
      optionsToUse = extend(extend({}, nonlocalOptions), taskScopeOptions);
      taskDefinition = self.tasks[taskConfig.task];
      if (! taskDefinition) {
        job.state = 'complete';
        job.error = 'InvalidTask';
        job.message = "invalid task name: " + taskConfig.task;
        doneCallback();
        return job;
      }
      task = Plan.createTask(taskDefinition, taskName, optionsToUse);
      task.exports.task = taskConfig.task;
      taskInstances[taskName] = task;
      job.info[taskName] = task.exports;
      plan.addTask(task);
    }
    var targetTask, i, depName, depTask;
    for (taskName in template.tasks) {
      taskConfig = template.tasks[taskName];
      targetTask = taskInstances[taskName];
      if (! taskConfig.dependencies) continue;
      for (i = 0; i < taskConfig.dependencies.length; ++i) {
        depName = taskConfig.dependencies[i];
        depTask = taskInstances[depName];
        if (! depTask) {
          job.state = 'complete';
          job.error = 'InvalidTemplate';
          job.message = "invalid dependency name: " + depName;
          doneCallback();
          return job;
        }
        plan.addDependency(targetTask, depTask);
      }
    }
    plan.on('progress', function(amountDone, amountTotal){
      job.progress = amountDone / amountTotal;
      emitUpdate();
    });
    plan.on('error', function(err, task){
      console.error("Task", task.name, "error", err.stack, "\n");
      job.error = 'ProcessingError';
      job.message = "Error processing job.";
    });
    plan.on('end', function(){
      onDone();
    });
    plan.start(context);
    self.emit('new', job);
    
  });
  return job;
  function onDone(){
    job.progress = 1;
    job.state = 'complete';
    job.endDate = new Date();
    emitUpdate();
    emitComplete();
    doneCallback();
  }
  function emitUpdate(){
    self.emit("update." + job.id, job);
  }
  function emitComplete(){
    self.emit('complete');
    self.emit("complete." + job.id);
  }
  return emitComplete;
};

function MemoryState(parent) {
  var self = this;
  self.parent = parent;
  self.table = {};
  // this should be set immediately after instantiation
  self.completedJobLifespan = null;
  self.sweepInterval = setInterval(sweep, self.parent.sweepIntervalMs || SWEEP_INTERVAL_MEMORY);
  function sweep(){
    var markedForDeletion = [];
    var now = new Date();
    var id, job, msSinceEnd;
    for (id in self.table) {
      job = self.table[id];
      if (!job.endDate) {
        continue;
      }
      msSinceEnd = now.getTime() - job.endDate.getTime();
      if (msSinceEnd > self.completedJobLifespan) {
        markedForDeletion.push(id);
      }
    }
    markedForDeletion.forEach(deleteJob);
  }
  function deleteJob(id){
    delete self.table[id];
    self.parent.emit('delete');
    self.parent.emit("delete." + id);
  }
}

MemoryState.prototype.setCompletedJobLifespan = function(value) {
  this.completedJobLifespan = value;
}

MemoryState.prototype.addJob = function(job, cb) {
  this.table[job.id] = job;
  process.nextTick(cb);
}

function RedisState(parent, dbClient, eventClient) {
  var self = this;
  self.parent = parent;
  self.dbClient = dbClient;
  self.eventClient = eventClient;
  self.table = {};

  self.eventClient.on('message', onMessage);
  self.eventClient.subscribe("mediablast.delete;");
  self.sweepInterval = setInterval(sweep, self.parent.sweepIntervalMs || SWEEP_INTERVAL_REDIS);

  var handlers = {
    "mediablast.delete;": deleteJob,
    "mediablast.create;": createJob,
  };

  function sweep() {
    var cutoff = new Date();
    cutoff.setTime(cutoff.getTime() - self.completedJobLifespan);
    flushOldJobsScript.exec(self.dbClient, 0,
        "-inf", cutoff.getTime(), function(err)
    {
      if (err) {
        console.error("error deleting old jobs", err.stack);
      }
    });
  }

  function onMessage(channel, message) {
    var handler = handlers[channel];
    if (handler) handler(message);
  }

  function deleteJob(id){
    delete self.table[id];
    self.parent.emit('delete');
    self.parent.emit("delete." + id);
  }

  function createJob(payload) {
    var job = JSON.parse(payload);
    self.table[job.id] = job;
  }
}

RedisState.prototype.setCompletedJobLifespan = function(value) {
  this.completedJobLifespan = value;
}

RedisState.prototype.addJob = function(job, cb) {
  var timestamp = (new Date()).getTime();
  this.table[job.id] = job;
  var key = "mediablast.job." + job.id + ";";
  var setKey = "mediablast.jobs;";
  var multi = this.dbClient.multi();
  var payload = JSON.stringify(job);
  multi.set(key, payload);
  multi.zadd(setKey, timestamp, job.id);
  multi.publish("mediablast.create;", payload);
  multi.exec(cb);
}

function sha1(str) {
  var hash = crypto.createHash('sha1');
  hash.update(str, 'utf8');
  return hash.digest('hex');
}
