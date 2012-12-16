(function(){
  var main;
  main = angular.module('main', []);
  function pad(num){
    return (num < 10 ? "0" : "") + num;
  }
  function timeDisplay(sec){
    var min, hr;
    min = sec / 60;
    hr = min / 60;
    if (hr >= 1) {
      hr = Math.floor(hr);
      min = Math.floor(min - hr * 60);
      sec = Math.floor(sec - (hr * 60 + min) * 60);
      return hr + ":" + pad(min) + ":" + pad(sec);
    } else {
      min = Math.floor(min);
      sec = Math.floor(sec - min * 60);
      return min + ":" + pad(sec);
    }
  }
  function age(startDate, endDate){
    var seconds;
    endDate == null && (endDate = new Date());
    seconds = (endDate - startDate) / 1000;
    return timeDisplay(seconds);
  }
  main.filter('age', function(){
    return age;
  });
  main.filter('percent', function(){
    return function(n){
      return Math.floor(parseFloat(n, 10) * 100) + "%";
    };
  });
  main.filter('duration', function(){
    return function(n){
      return timeDisplay(parseFloat(n, 10));
    };
  });
  main.controller('MainCtrl', ['$scope'].concat(function($scope){
    var jobs_by_cat, jobs_by_id, source;
    $scope.jobs_by_cat_list = {
      processing: [],
      complete: []
    };
    jobs_by_cat = {};
    jobs_by_id = {};
    $scope.jobDuration = function(job){
      var end;
      end = job.endDate || new Date();
      return age(job.startDate, end);
    };
    $scope.progress = function(results){
      var amountDone, amountTotal;
      amountDone = results.amountDone, amountTotal = results.amountTotal;
      if (amountTotal != null) {
        return amountDone / amountTotal;
      } else {
        return 0;
      }
    };
    function convertStringsToDates(job){
      job.startDate != null && (job.startDate = new Date(job.startDate));
      job.endDate != null && (job.endDate = new Date(job.endDate));
    }
    function updateJobPosCache(){
      var state, ref$, state_jobs, i, len$, job;
      for (state in ref$ = $scope.jobs_by_cat_list) {
        state_jobs = ref$[state];
        for (i = 0, len$ = state_jobs.length; i < len$; ++i) {
          job = state_jobs[i];
          job.pos = i;
        }
      }
    }
    function insertJobIntoCat(job){
      var key$;
      (jobs_by_cat[key$ = job.state] || (jobs_by_cat[key$] = {}))[job.id] = job;
      $scope.jobs_by_cat_list[job.state].unshift(job);
      updateJobPosCache();
    }
    function newJob(job){
      convertStringsToDates(job);
      jobs_by_id[job.id] = job;
      insertJobIntoCat(job);
    }
    function updateJob(job){
      var old_job, key$;
      convertStringsToDates(job);
      old_job = jobs_by_id[job.id];
      if (old_job.state === job.state) {
        import$(old_job, job);
      } else {
        delete (jobs_by_cat[key$ = old_job.state] || (jobs_by_cat[key$] = {}))[old_job.id];
        $scope.jobs_by_cat_list[old_job.state].splice(old_job.pos, 1);
        insertJobIntoCat(import$(old_job, job));
      }
    }
    function deleteJob(job){
      var key$;
      delete (jobs_by_cat[key$ = job.state] || (jobs_by_cat[key$] = {}))[job.id];
      $scope.jobs_by_cat_list[job.state].splice(job.pos, 1);
      delete jobs_by_id[job.id];
      updateJobPosCache();
    }
    function onMessage(e){
      var msg, id, ref$, job;
      $scope.status = "connected";
      msg = JSON.parse(e.data);
      switch (msg.name) {
      case 'dump':
        for (id in ref$ = msg.jobs) {
          job = ref$[id];
          newJob(job);
        }
        break;
      case 'new':
        newJob(msg.job);
        break;
      case 'update':
        updateJob(msg.job);
        break;
      case 'complete':
        updateJob(msg.job);
        break;
      case 'delete':
        deleteJob(msg.job);
      }
      $scope.$apply();
    }
    function onError(e){
      $scope.status = "connection error";
      $scope.$apply();
    }
    source = new EventSource("/admin/status/events");
    $scope.status = "connecting";
    source.addEventListener('message', onMessage, false);
    source.addEventListener('error', onError, false);
    setInterval(function(){
      $scope.$apply();
    }, 1000);
  }));
  main.directive('jobTable', function(){
    return {
      templateUrl: '/views/job-table.html',
      scope: true,
      link: function(scope, element, attrs){
        scope.state = attrs.jobTable;
        scope.state_jobs = scope.jobs_by_cat_list[scope.state];
      }
    };
  });
  main.run();
  function import$(obj, src){
    var own = {}.hasOwnProperty;
    for (var key in src) if (own.call(src, key)) obj[key] = src[key];
    return obj;
  }
}).call(this);
