'use strict';
const dial = require('peer-dial');
const EventEmitter = require('events')
  .EventEmitter;
const express = require('express');
const expressWinston = require('express-winston');
const winston = require('winston');
const StreamQueue = require('./streamqueue');
const http = require('http');
const https = require('https');
const icecast = require('icecast-stack');
const ip = require('ip');
const lame = require('lame');
const util = require('util');
const stream = require('stream');
// const TubeStream = require('./tube-stream');
const ytStream = require('./ytstream');
const Sonos = require('sonos')
  .Sonos;
const url = require('url');
const youtube = require('youtube-api');

// 16-bit signed samples
const SAMPLE_SIZE = 16;
const CHANNELS = 2;
const SAMPLE_RATE = 44100;

// If we're getting raw PCM data as expected, calculate the number of bytes
// that need to be read for `1 Second` of audio data.
const BLOCK_ALIGN = SAMPLE_SIZE / 8 * CHANNELS;
const BYTES_PER_SECOND = SAMPLE_RATE * BLOCK_ALIGN;

const DESCRIPTION = 'SonosTube - www.github.com/paixaop/sonos-tube';
const URL = 'https://github.com/paixaop/sonos-tube';

const PassThrough = stream.PassThrough || require('readable-stream')
  .PassThrough;

const YouTubeApp = require('./youtube-dial-app/youtube-dial-app');

var SonosTube = function(device, port) {
  var self = this;

  EventEmitter.call(self);

  self.listenPort = port || Math.floor(Math.random() * 50000) + 10000;
  self.maxQueueLength = 50;
  self.device = device;

  self.app = express();
  self.app.disable('x-powered-by');

  self.prevMetadata = 0;
  self.acceptsMetadata = 0;
  self.isPipped = false;

  // YouTube video Id
  self.videoId = null;
  self.videoInfo = {};

  self.nextVideo = null;

  // List of connected clients
  self.clients = {};

  self.youtubeApp = new YouTubeApp();

  // Configure the DIAL YouTube app
  self.dialApps = {
    'YouTube': {
      name: 'YouTube',
      state: 'stopped',
      allowStop: true,
      pid: null,
      launch: function(launchData) {
        const launchURL = `http://www.youtube.com/watch?${launchData}`;
        self.youtubeApp.start(launchURL, function(err) {
          if (err) {
            throw err;
          }
          self.inputStream.empty();
          self.newSong(launchURL);
        });

      },
      stop: function() {
        let sonos = new Sonos(self.device.ip);
        self.youtubeApp.stop();
        sonos.stop();
      },
    },
  };

  self.youtubeApp.on('getNowPlaying', () => {
    self.youtubeApp.sendMessage({
      command: 'nowPlaying',
      args: {
        videoId: self.videoId,
        currentTime: 0,
        state: 1,
        currentIndex: 1,
        listId: '',
      },
    });
  });

  // self.setStreams = function() {
  // Streams
  self.inputStream = new StreamQueue();
  self.throttleStream = PassThrough(); // new Throttle(BYTES_PER_SECOND);

  self.throttleStream.on('data', function(chunk) {
    self.encoder.write(chunk);
  });

  // LAME Audio Encoder
  self.encoderReady = false;
  self.encoder = new lame.Encoder({
    channels: CHANNELS,
    bitDepth: SAMPLE_SIZE,
    sampleRate: SAMPLE_RATE,
  });

  self.encoder.on('data', function(chunk) {
    self.writeToAllClients(chunk);
  });

  self.inputStream.on('empty', function() {
    console.log('InputStream empty loading next song');
    if (self.nextVideoId) {
      var uri = 'http://www.youtube.com/watch?v=' + self.nextVideoId;
      self.queue(ytStream(uri, {
          info: self.updateMetadata,
          format: self.getFormat,
        })
        .pipe(new lame.Decoder()));
    } else {
      console.log('No next video');
    }
  });

  self.inputStream.on('next-stream', function() {
    // console.log('starting next song from queue');
  });
  // };

  self.getFormat = function(format) {
    self.videoFormat = format;
  };

  self.updateMetadata = function(metadata) {
    if (!metadata) return;

    console.log('Metadata Title: ' + metadata.title);
    var currentTrack = metadata.title;
    self.setMetadata(currentTrack);
    self.videoInfo = metadata;
    if (metadata.relatedIds) {
      self.relatedIds = metadata.relatedIds;
      self.nextVideoId = metadata.relatedIds[0];
    }
  };

  self.phantom = function(url) {
    var sitepage = null;
    var phInstance = null;
    phantom.create()
      .then(instance => {
        phInstance = instance;
        return instance.createPage();
      })
      .then(page => {
        sitepage = page;
        page.on('onResourceRequested', function(requestData, networkRequest) {

          console.log(requestData.url);


        });
        page.on('onResourceError', function(error) {
          console.log('BLOCKED:' + error.url);
        });
        return page.open(url);
      })
      .then(status => {
        console.log(status);
        return sitepage.property('content');
      })
      .then(content => {
        console.log('page loaded');
        // sitepage.close();
        // phInstance.exit();
      })
      .catch(error => {
        console.log(error);
        phInstance.exit();
      });
  };

  self.newSong = function(uri) {
    console.log('New song: ' + uri ? uri : 'no url!');
    if (!uri) return;

    var q = url.parse(uri, true)
      .query;

    self.videoId = q.v;

    // Next Videos
    // https://www.googleapis.com/youtubei/v1/next?AIzaSyDmVkC4o-Is_o1PdKlqsl7F3Sm5zIL7hcE

    // var ytstream = new TubeStream(uri);
    try {
      self.queue(ytStream(uri, {
          info: self.updateMetadata,
          format: self.getFormat,
        })
        .pipe(new lame.Decoder()));

      var sonos = new Sonos(self.device.ip);

      sonos.play({
          uri: util.format('x-rincon-mp3radio://%s:%d/listen.m3u', ip.address(), self.listenPort),
          metadata: self.generateSonosMetadata({
            clientName: self.device.name,
            author: self.videoInfo.author,
          }),
        },
        function(err, playing) {
          if (err) {
            console.log('Could not play song on Sonos: ' +
              self.device.name + '@' + self.device.ip +
              ' - ' + err.message);
          }
        });
    } catch (err) {
      console.log(err.message);
    }
  };

  self.getRelatedVideo = function(id, next) {
    youtube.authenticate({
      type: 'key',
      key: 'AIzaSyDmVkC4o-Is_o1PdKlqsl7F3Sm5zIL7hcE',
    });

    // logger.debug('getChannelInfo(' + channelId + ')');
    youtube.search.list({
      part: 'snippet',
      type: 'video',
      relatedToVideoId: id,
    }, function(err, result) {
      if (err) {
        return next(err);
      }

      if (result && result.items && result.items[0]) {
        return next(null, {
          videoId: result.items[0].id.videoId,
          title: result.items[0].snippet.title,
          description: result.items[0].snippet.description,
          thumbnail: result.items[0].snippet.thumbnails.default.url,
          type: 'video',
        });
      }
      return next(null, null);
    });
  };


  self.generateSonosMetadata = function(opts) {
    if (!opts) return;

    opts.genre = opts.genre || 'Music';
    opts.radio = opts.radio || 'SonosTube';

    return `<?xml version="1.0"?>
<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"
xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"
xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
<item id="R:0/0/49" parentID="R:0/0" restricted="true">
<dc:title>${opts.clientName}</dc:title>
<upnp:creator>${opts.author}</upnp:creator>
<dc:relation>${URL}</dc:relation>
<upnp:radioBand>Internet</upnp:radioBand>
<upnp:radioCallSign>SonosTube</upnp:radioCallSign>
<upnp:radioStationID></upnp:radioStationID>
<upnp:genre>${opts.genre}</upnp:genre>
<upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON65031_</desc>
</item>
</DIDL-Lite>`;
  };

  self.on('need-song', function(req, res) {

  });

  self.dialServer = new dial.Server({
    expressApp: self.app,
    port: self.listenPort,
    prefix: '/dial',
    corsAllowOrigins: '*',
    manufacturer: 'Sonos',
    modelName: 'Sonos',
    friendlyName: self.device.name + ' (SonosTube)',
    delegate: {
      getApp: function(appName) {
        let app = self.dialApps[appName];
        return app;
      },
      launchApp: function(appName, lauchData, callback) {
        console.log('Got request to launch', appName, ' with launch data: ', lauchData);
        let app = self.dialApps[appName];
        let pid = null;
        if (self.dialApps[appName]) {
          self.dialApps[appName].pid = 'run';
          self.dialApps[appName].state = 'starting';
          self.dialApps[appName].launch(lauchData);
          self.dialApps[appName].state = 'running';
        }
        callback(app.pid);
      },
      stopApp: function(appName, pid, callback) {
        console.log('Got request to stop', appName, ' with pid: ', pid);
        self.dialApps[appName];
        if (self.dialApps[appName] && self.dialApps[appName].pid == pid) {
          self.dialApps[appName].pid = null;
          self.dialApps[appName].state = 'stopped';
          callback(true);
        } else {
          callback(false);
        }
      },
    },
  });

  // stream playlist (points to other endpoint)
  self.rediretToplaylistEndpoint = function(req, res) {
    var addr = ip.address();

    res.status(200);
    res.set('Content-Type', 'audio/x-mpegurl');
    res.send('http://' + addr + ':' + self.listenPort + '/SonosTube');
  };

  self.app.get('/', function(req, res) {
    res.send('Sonos Audio Server<br><a href="http://' + ip.address() + ':' + self.listenPort + '/SonosTube">Listen</a>');
  });

  self.app.get('/control', function(req, res, next) {
    console.log('Control URL called');
  });

  self.app.get('/event', function(req, res, next) {
    console.log('Event URL called');
  });

  self.app.get('/scpd', function(req, res, next) {
    console.log('SCPD URL called');
  });

  self.app.get('/listen.m3u', self.rediretToplaylistEndpoint);

  // Audio endpoint
  self.app.get('/SonosTube', function(req, res, next) {
    self.emit('listen', req, res);

    var acceptsMetadata = req.headers['icy-metadata'] === '1';

    if (!self.isPipped) {
      console.log('Piping input stream');
      self.emit('need-song');
      self.inputStream.pipe(self.throttleStream);
      self.isPipped = true;
    }

    // generate response header
    var headers = {
      'Content-Type': 'audio/mpeg',
      'Connection': 'close',
    };

    if (acceptsMetadata) {
      console.log('Client accepts metadata!');
      headers['icy-metaint'] = 8192;
      // headers['ice-audio-info'] = 'ice-samplerate=' + SAMPLE_RATE + ';ice-bitrate=192;ice-channels=' + CHANNELS;
      headers['icy-br'] = '192, 192';
      headers['icy-description'] = DESCRIPTION;
      headers['icy-name'] = 'SonosTube';
      headers['icy-pub'] = '1';
      headers['icy-url'] = URL;
    }

    self.prevMetadata = 0;
    res.writeHead(200, headers);

    req.on('error', function(err) {
      if (err.code === 'ECONNRESET') {
        console.log('Timeout occurs');
        // specific error treatment
      }
      console.log('error: ' + err.message);
      // other error treatment
    });

    req.connection.on('error', function(err) {
      console.log('error in connection ' + err.message);
    });

    req.connection.on('close', function() {
      self.emit('silent', req, res);
      self.removeClient(req);
    });

    self.addClient(req, res, acceptsMetadata);
  });



  self.addClient = function(req, res, acceptsMetadata) {
    var client = req.connection.remoteAddress + ':' + req.connection.remotePort;
    if (!self.clients[client]) {
      console.log('Add new client: ' + client);
      self.clients[client] = {};

      if (acceptsMetadata) {
        res = new icecast.IcecastWriteStack(res, 8192);
        res.queueMetadata(self.metadata || '');
      }

      self.clients[client].res = res;
      self.clients[client].acceptsMetadata = acceptsMetadata;
    }
  };

  self.removeClient = function(req) {
    var client = req.connection.remoteAddress + ':' + req.connection.remotePort;
    if (self.clients[client]) {
      console.log('Removing client: ' + client);
      if (self.clients[client].res) {
        self.clients[client].res.end();
      }
      delete self.clients[client];
    }
  };

  self.writeToAllClients = function(chunk) {
    for (var client in self.clients) {
      var res = self.clients[client].res;
      if (self.clients[client].acceptsMetadata && self.prevMetadata !== self.metadata) {
        res.queueMetadata(self.metadata || self.opts.name);
        self.prevMetadata = self.metadata;
      }
      res.write(chunk);
    }
  };

  self.start = function(callback) {
    // express-winston logger makes sense BEFORE the router.
    self.app.use(expressWinston.logger({
      transports: [
        new winston.transports.File({
          json: true,
          filename: 'access.log',
        }),
      ],
    }));

    // express-winston errorLogger makes sense AFTER the router.
    self.app.use(expressWinston.errorLogger({
      transports: [
        new winston.transports.File({
          json: true,
          filename: 'error.log',
        }),
      ],
      meta: true,
    }));
    self.server = http.createServer(self.app)
      .listen(self.listenPort, function(err) {
        if (err) {
          console.log('Error: ' + err.message);
          throw err;
        }

        console.log(util.format('SonosTube Server: %s:%d => %s (@ %s:%d, %s)',
          ip.address(), self.listenPort,
          self.device.name,
          self.device.ip, self.device.port,
          self.device.group));

        self.dialServer.start();
        // self.setStreams();

        self.server.on('connection', function(socket) {
          // Set connection to KeppAlive so we don't timeout on the clients
          socket.setTimeout(0);
        });

        if (callback && typeof callback === 'function') {
          callback(self.listenPort);
        }
      });
  };

  self.setInputStream = function(inputStream) {
    self.inputStream.unpipe();
    self.inputStream = inputStream;
    self.inputStream.pipe(self.throttleStream);
    self.isPipped = true;
  };

  self.setMetadata = function(metadata) {
    self.metadata = metadata;
  };

  self.queue = function(stream) {
    if (self.getQueueLength() > self.maxQueueLength) {
      self.emit('full-queue');
      return;
    }
    self.inputStream.queue(stream);
  };

  self.getQueueLength = function() {
    return self.inputStream.length;
  };

  self.stop = function() {
    try {
      self.inputStream.done();
      self.server.close();
      self.encoderReady = false;
      self.dialServer.stop();
    } catch (err) {

    }
  };
};

util.inherits(SonosTube, EventEmitter);
module.exports = SonosTube;
