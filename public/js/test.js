(function(){
  var onProgress, onResponse, onSuccess;
  onProgress = function(event){
    var percent_complete;
    if (event.lengthComputable) {
      percent_complete = Math.round(event.loaded / event.total * 100);
      console.log("percent", percent_complete);
    }
  };
  onResponse = function(resp){
    var source, onMessage, onError;
    source = new EventSource("/status/" + resp.id);
    $('#status2').text("event source connecting");
    onMessage = function(e){
      var obj;
      $('#status2').text("event source open");
      $('#status').text(e.data);
      obj = JSON.parse(e.data);
      if (obj.state === 'complete') {
        $('#status2').text("event source closed");
        source.close();
      }
    };
    onError = function(e){
      $('#status2').text("event source error");
    };
    source.addEventListener('message', onMessage, false);
    source.addEventListener('error', onError, false);
  };
  onSuccess = function(event){
    return onResponse(JSON.parse(event.target.responseText));
  };
  $('#template').on('change', function(event){
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
}).call(this);
