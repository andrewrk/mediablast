(function(){
  $('#file').on('change', function(event){
    var xhr, fd;
    xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', onProgress, false);
    xhr.addEventListener('load', onSuccess, false);
    xhr.open('POST', '/');
    fd = new FormData();
    fd.append('templateId', $('#template-id').val());
    fd.append('s3Url', $('#s3-url').val());
    fd.append('callbackUrl', $('#callback-url').val());
    fd.append('file', event.target.files[0]);
    xhr.send(fd);
  });
  $('#template-id').on('keyup', function(event){
    var opts;
    if (event.which === 13) {
      opts = {
        type: 'POST',
        url: '/',
        data: {
          templateId: $('#template-id').val(),
          s3Url: $('#s3-url').val(),
          callbackUrl: $('#callback-url').val()
        }
      };
      $.ajax(opts).done(onResponse);
    }
  });

  function onProgress(event) {
    var percentComplete;
    if (event.lengthComputable) {
      percentComplete = Math.round(event.loaded / event.total * 100);
      console.log("percent", percentComplete);
    }
  }

  function onResponse(resp) {
    var source = new EventSource("/status/" + resp.id);
    $('#connection-status').text("event source connecting");
    source.addEventListener('message', onMessage, false);
    source.addEventListener('error', onError, false);
    function onMessage(e) {
      var obj;
      $('#connection-status').text("event source open");
      $('#job-status').text(e.data);
      obj = JSON.parse(e.data);
      if (obj.state === 'complete') {
        $('#connection-status').text("event source closed");
        source.close();
      }
    }
    function onError(e) {
      $('#connection-status').text("event source error");
    }
  }

  function onSuccess(event) {
    return onResponse(JSON.parse(event.target.responseText));
  }
}).call(this);
