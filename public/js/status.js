(function(){
  var main = angular.module('main', []);

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
    $scope.jobsByCatList = {
      processing: [],
      complete: []
    };
    var jobsByCat = {};
    var jobsById = {};
    $scope.jobDuration = function(job){
      var end;
      end = job.endDate || new Date();
      return age(job.startDate, end);
    };
    $scope.progress = function(results){
      var amountDone = results.amountDone
      var amountTotal = results.amountTotal;
      if (amountTotal != null) {
        return amountDone / amountTotal;
      } else {
        return 0;
      }
    };
    function convertStringsToDates(job){
      if (job.startDate) job.startDate = new Date(job.startDate);
      if (job.endDate) job.endDate = new Date(job.endDate);
    }
    function updateJobPosCache(){
      var state, stateJobs, i, job;
      for (state in $scope.jobsByCatList) {
        stateJobs = $scope.jobsByCatList[state];
        for (i = 0; i < stateJobs.length; ++i) {
          job = stateJobs[i];
          job.pos = i;
        }
      }
    }
    function insertJobIntoCat(job){
      (jobsByCat[job.state] || (jobsByCat[job.state] = {}))[job.id] = job;
      $scope.jobsByCatList[job.state].unshift(job);
      updateJobPosCache();
    }
    function newJob(job){
      convertStringsToDates(job);
      jobsById[job.id] = job;
      insertJobIntoCat(job);
    }
    function updateJob(job){
      convertStringsToDates(job);
      var oldJob = jobsById[job.id];
      if (oldJob.state === job.state) {
        extend(oldJob, job);
      } else {
        delete (jobsByCat[oldJob.state] || (jobsByCat[oldJob.state] = {}))[oldJob.id];
        $scope.jobsByCatList[oldJob.state].splice(oldJob.pos, 1);
        insertJobIntoCat(extend(oldJob, job));
      }
    }
    function deleteJob(job){
      delete (jobsByCat[job.state] || (jobsByCat[job.state] = {}))[job.id];
      $scope.jobsByCatList[job.state].splice(job.pos, 1);
      delete jobsById[job.id];
      updateJobPosCache();
    }
    function onMessage(e){
      var msg, id, job;
      $scope.status = "connected";
      msg = JSON.parse(e.data);
      switch (msg.name) {
      case 'dump':
        for (id in msg.jobs) {
          job = msg.jobs[id];
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
    var source = new EventSource("/admin/status/events");
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
        scope.stateJobs = scope.jobsByCatList[scope.state];
      }
    };
  });

  main.run();

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
    endDate = endDate || new Date();
    seconds = (endDate - startDate) / 1000;
    return timeDisplay(seconds);
  }

  function extend(obj, src){
    var own = {}.hasOwnProperty;
    for (var key in src) if (own.call(src, key)) obj[key] = src[key];
    return obj;
  }
}).call(this);
