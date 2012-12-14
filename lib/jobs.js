var EventEmitter, makeUuid, Plan, assert, tasks, Jobs;
EventEmitter = require('events').EventEmitter;
makeUuid = require('node-uuid').v4;
Plan = require('plan');
assert = require('assert');
tasks = {
  'audio.transcode': require('plan-transcode'),
  'audio.waveform': require('plan-waveform'),
  'image.thumbnail': require('plan-thumbnail'),
  's3.upload': require('plan-s3-upload'),
  's3.download': require('plan-s3-download'),
  'meta.callback': require('plan-callback')
};
module.exports = Jobs = (function(superclass){
  Jobs.displayName = 'Jobs';
  var prototype = extend$(Jobs, superclass).prototype, constructor = Jobs;
  function Jobs(){
    var this$ = this;
    this.setMaxListeners(0);
    this.table = {};
    this.completed_job_lifespan = 5 * 60 * 1000;
    this.sweep_interval = setInterval(sweep, 1000);
    function sweep(){
      var marked_for_deletion, now, id, ref$, job, ms_since_end, i$, len$;
      marked_for_deletion = [];
      now = new Date();
      for (id in ref$ = this$.table) {
        job = ref$[id];
        if (!job.endDate) {
          continue;
        }
        ms_since_end = now.getTime() - job.endDate.getTime();
        if (ms_since_end > this$.completed_job_lifespan) {
          marked_for_deletion.push(id);
        }
      }
      for (i$ = 0, len$ = marked_for_deletion.length; i$ < len$; ++i$) {
        id = marked_for_deletion[i$];
        deleteJob(id);
      }
    }
    function deleteJob(id){
      delete this$.table[id];
      this$.emit('delete');
      this$.emit("delete." + id);
    }
  }
  prototype.incompleteCount = function(){
    var count, id, ref$, job;
    count = 0;
    for (id in ref$ = this.table) {
      job = ref$[id];
      if (!job.endDate) {
        count += 1;
      }
    }
    return count;
  };
  prototype.create = function(context, template, doneCallback){
    var job, plan, task_instances, template_scope_options, task_name, ref$, task_config, nonlocal_options, task_scope_options, options_to_use, task_definition, task, target_task, i$, ref1$, len$, dep_name, dep_task, this$ = this;
    job = {
      id: makeUuid(),
      progress: 0,
      state: 'processing',
      error: null,
      message: null,
      startDate: new Date(),
      endDate: null,
      info: {}
    };
    context.callbackData = job;
    this.table[job.id] = job;
    assert.ok(template.id);
    plan = new Plan(template.id);
    task_instances = {};
    template_scope_options = template.options || {};
    for (task_name in ref$ = template.tasks) {
      task_config = ref$[task_name];
      nonlocal_options = template_scope_options[task_config.task] || {};
      task_scope_options = task_config.options || {};
      options_to_use = import$(import$({}, nonlocal_options), task_scope_options);
      task_definition = tasks[task_config.task];
      if (task_definition == null) {
        job.state = 'complete';
        job.error = 'InvalidTask';
        job.message = "invalid task name: " + task_config.task;
        doneCallback();
        return job;
      }
      task = Plan.createTask(task_definition, task_name, options_to_use);
      task.exports.task = task_config.task;
      task_instances[task_name] = task;
      job.info[task_name] = task.exports;
      plan.addTask(task);
    }
    for (task_name in ref$ = template.tasks) {
      task_config = ref$[task_name];
      target_task = task_instances[task_name];
      if (task_config.dependencies) {
        for (i$ = 0, len$ = (ref1$ = task_config.dependencies).length; i$ < len$; ++i$) {
          dep_name = ref1$[i$];
          dep_task = task_instances[dep_name];
          if (dep_task == null) {
            job.state = 'complete';
            job.error = 'InvalidTemplate';
            job.message = "invalid dependency name: " + dep_name;
            doneCallback();
            return job;
          }
          plan.addDependency(target_task, dep_task);
        }
      }
    }
    plan.on('progress', function(amount_done, amount_total){
      job.progress = amount_done / amount_total;
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
    this.emit('new', job);
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
      this$.emit("update." + job.id, job);
    }
    function emitComplete(){
      this$.emit('complete');
      this$.emit("complete." + job.id);
    }
    return emitComplete;
  };
  return Jobs;
}(EventEmitter));
function extend$(sub, sup){
  function fun(){} fun.prototype = (sub.superclass = sup).prototype;
  (sub.prototype = new fun).constructor = sub;
  if (typeof sup.extended == 'function') sup.extended(sub);
  return sub;
}
function import$(obj, src){
  var own = {}.hasOwnProperty;
  for (var key in src) if (own.call(src, key)) obj[key] = src[key];
  return obj;
}