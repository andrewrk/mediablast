var EventEmitter = require('events').EventEmitter
  , util = require('util')
  , makeUuid = require('node-uuid')
  , Plan = require('./plan')
  , tasks = require('requireindex')(path.resolve(__dirname, './tasks'));

module.exports = Jobs;

function Jobs(redis_io, redis_pubsub){
  EventEmitter.call(this);

  var handlers, this$ = this;
  this.redis_io = redis_io;
  this.redis_pubsub = redis_pubsub;
  this.setMaxListeners(0);
  this.table = {};
  this.completed_job_lifespan = 30 * 60;
  this.redis_io.on('error', function(err){
    console.error("redis error (jobs io):", err);
  });
  this.redis_pubsub.on('error', function(err){
    console.error("redis error (jobs pubsub):", err);
  });
  subscribe();
  function subscribe(){
    var pattern;
    this$.redis_pubsub.on('pmessage', onGotMessage);
    this$.redis_pubsub.psubscribe((function(){
      var results$ = [];
      for (pattern in handlers) {
        results$.push(pattern);
      }
      return results$;
    }()));
    this$.redis_io.smembers("jobs", onGotJobIds);
  }
  function onGotJobIds(err, ids){
    var multi, i$, len$, id;
    if (err) {
      return this$.emit('error', err);
    }
    multi = this$.redis_io.multi();
    for (i$ = 0, len$ = ids.length; i$ < len$; ++i$) {
      id = ids[i$];
      multi.hgetall("jobs." + id);
    }
    multi.exec(function(err, jobs_list){
      var args, i, to$, job, id;
      if (err) {
        return this$.emit('error', err);
      }
      args = ['jobs'];
      assert.strictEqual(ids.length, jobs_list.length);
      for (i = 0, to$ = ids.length; i < to$; ++i) {
        job = jobs_list[i];
        id = ids[i];
        if (job != null) {
          assert.strictEqual(id, job.id);
          this$.table[job.id] = job;
        } else {
          this$.redis_pubsub.publish("delete." + id, id);
          args.push(id);
        }
      }
      if (args.length > 1) {
        this$.redis_io.srem(args);
      }
    });
  }
  handlers = {
    "jobs.new": onNew,
    "jobs.delete.*": onDelete,
    "jobs.update.*": onUpdate,
    "jobs.complete.*": onComplete
  };
  function onNew(job){
    this$.table[job.id] = job;
    this$.emit('new', job);
  }
  function onDelete(id){
    delete this$.table[id];
    this$.emit("delete." + id, id);
  }
  function onUpdate(job){
    this$.table[job.id] = job;
    this$.emit("update." + job.id, job);
  }
  function onComplete(job){
    this$.emit("complete." + job.id, job);
    this$.emit("complete");
  }
  function onGotMessage(pattern, channel, message){
    var json;
    json = JSON.parse(message);
    handlers[pattern](json);
  }
}

util.inherits(Jobs, EventEmitter);

Jobs.prototype.incompleteCount = function() {
  var count, id, ref$, job;
  count = 0;
  for (id in ref$ = this.table) {
    job = ref$[id];
    if (!job.end_date) {
      count += 1;
    }
  }
  return count;
};

Jobs.protoytp

module.exports = Jobs = (function(superclass){
  prototype.create = function(context, template, doneCallback){
    var job, plan, task_instances, template_scope_settings, task_name, task_config, task_scope_settings, settings_to_use, task, target_task, i$, ref$, len$, dep_name, dep_task, this$ = this;
    job = {
      id: makeUuid(),
      progress: 0,
      state: 'processing',
      error: null,
      message: null,
      queue_date: new Date(),
      start_date: new Date(),
      end_date: null,
      info: {}
    };
    context.job = job;
    this.table[job.id] = job;
    plan = new Plan(template.id);
    task_instances = {};
    template_scope_settings = template.settings || {};
    for (task_name in template) {
      task_config = template[task_name];
      task_scope_settings = task_config.settings || {};
      settings_to_use = import$(import$({}, template_scope_settings), task_scope_settings);
      task = new tasks[task_config.task](task_name, settings_to_use);
      task.info.task = task_config.task;
      task_instances[task_name] = task;
      job.info[task_name] = task.info;
      plan.addTask(task);
    }
    for (task_name in template) {
      task_config = template[task_name];
      target_task = task_instances[task_name];
      if (task_config.dependencies) {
        for (i$ = 0, len$ = (ref$ = task_config.dependencies).length; i$ < len$; ++i$) {
          dep_name = ref$[i$];
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
    plan.on('update', function(){
      emitUpdate();
    });
    plan.on('error', function(err){
      onDone(err);
    });
    plan.on('end', function(){
      onDone();
    });
    plan.start(context);
    this.redis_pubsub.publish('new', JSON.stringify(job));
    return job;
    function onDone(err){
      if (err) {
        console.error("Error processing job:", err.stack);
        job.error = 'ProcessingError';
        job.message = "Error processing job.";
      }
      job.progress = 1;
      job.state = 'complete';
      job.end_date = new Date();
      emitUpdate();
      emitComplete();
      this$.redis_io.expire("job." + job.id, this$.completed_job_lifespan);
      doneCallback();
    }
    function emitUpdate(){
      this$.redis_pubsub.publish("update." + job.id, JSON.stringify(job));
    }
    function emitComplete(){
      this$.redis_pubsub.publish("complete." + job.id, JSON.stringify(job));
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
