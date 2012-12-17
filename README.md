# mediablast
Generic processing server built on [node-plan](https://github.com/superjoe30/node-plan).

## Quick Start

See a [working example of a mediablast server](https://gist.github.com/4312843)

### Server Code

```js
var http = require('http');
var mediablast = require('mediablast');

var app = mediablast({
  settingsFile: 'settings.json'
});

app.registerTask('s3.store', require('node-plan-s3-upload'));
app.registerTask('s3.retrieve', require('node-plan-s3-download'));
app.registerTask('audio.waveform', require('node-plan-waveform'));
app.registerTask('audio.transcode', require('node-plan-transcode'));
app.registerTask('meta.callback', require('node-plan-callback'));

var server = http.createServer(app);
server.listen(function() {
  console.log("mediablast server online");
});
```

### HTTP Client Usage

#### Admin

Currently mediablast only supports one user. By default this user name is
`admin` and the password is `3pTkHwHV`. You should change this before you
deploy.

For better user account management, see
[#1](https://github.com/superjoe30/mediablast/issues/1).

#### Submitting a Job

To submit a job, make a `POST` request to `/`. The tasks you have registered
dictate what parameters to send with this request. Usually you will want
this request to be a multipart file upload.

The request will look something like:

```json
{
  "templateId": "6373af69-367e-48f4-8734-f30cee4f7541"
}
```

The response will look like:

```json
{
  "id": "20fff6bc-fa45-44c2-a92b-7df597fdb8b1",
  // range: [0, 1]
  "progress": 1,
  // one of ['processing', 'complete']
  "state": "complete",
  // error identifier. If this is truthy, the job completed with an error.
  "error": null,
  "startDate": "2012-08-27T13:41:17.253Z",
  "endDate": "2012-08-27T13:41:22.006Z",
  "exports": {
    "example-1": {
      // Each task has its own documentation which describes how its `exports`
      // object is constructed.
    },
    "example-2": {
      ...
    },
  }
}
```

Once you have the job id, you can use either the push notification status
endpoint or the polling endpoint.

#### Push Notification Status Endpoint

`GET /status/:jobId` is an EventSource URL which provides push notifications
for job status and progress updates. Each message is a JSON encoding of the
job. Once the job state is `complete`, no more events will be sent and the
client should close the EventSource.

#### Polling Status Endpoint

`GET /poll/:jobId` returns a pure JSON response instead of Server Sent Events.

#### Ping Endpoint

`GET /status` will always return `{"success": true}`. You may use this endpoint
to determine whether the server is online and responding to requests.

### Admin Interface

#### Monitoring Jobs

Hit `/admin/status` with your browser to monitor all jobs in the system.

#### Editing Settings and Templates

Hit `/admin/settings` with your browser to edit settings and templates.

#### Testing a Template

Hit `/admin/test` with your browser to test a template.
