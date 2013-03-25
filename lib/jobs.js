var EventEmitter = require('events').EventEmitter
  , makeUuid = require('node-uuid')
  , Plan = require('plan')
  , assert = require('assert')
  , util = require('util')
  , extend = require('./extend')

module.exports = Jobs;

function Jobs() {
  var self = this;

  EventEmitter.call(self);

  self.tasks = {};
  self.setMaxListeners(0);
  self.table = {};
  self.completedJobLifespan = 5 * 60 * 1000;
  self.sweepInterval = setInterval(sweep, 1000);
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
    self.emit('delete');
    self.emit("delete." + id);
  }
}

util.inherits(Jobs, EventEmitter);

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
  self.table[job.id] = job;
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
