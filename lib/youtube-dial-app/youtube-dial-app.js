/* eslint strict: "off" */
'use strict';

const EventEmitter = require('events')
  .EventEmitter;
const querystring = require('querystring');
const uuid = require('uuid');
const parseDuration = require('parse-duration');
const request = require('request');
const randomstring = require('randomstring');
const LongPoll = require('./long-poll');
const fs = require('fs');

class YouTubeDialApp extends EventEmitter {

  constructor({
    debug = true,
    name = 'YouTube TV',
    apiURL = 'https://www.youtube.com/api/lounge',
    device = 'LOUNGE_SCREEN',
    ver = 8,
    app = 'lb-v4',
    zxSize = 12,
    minRID = 10000,
    maxRID = 80000,
    theme = 'cl',
    proxy = '',
  } = {}) {
    super();

    this.rid = this.rid();
    this.uuid = uuid.v4()
      .toString();
    this.loungeIdToken = '';
    this.sid = '';
    this.gsessionId = '';
    this.aid = 0;
    this.pairingCode = '';
    this.screens = {};
    this.screenId = '';
    this.systemName = name;
    this.outgoingMessageQueue = [];
    this.osid = '';
    this.oaid = '';
    this.apiURL = apiURL;
    this.device = device;
    this.ver = ver;
    this.app = app;
    this.zxSize = zxSize;
    this.minRID = minRID;
    this.maxRID = maxRID;
    this.theme = theme;

    this.debug = debug;
    //request.debug = true;

    this.cookieJar = request.jar();
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const requestDefaults = {
      jar: this.cookieJar,
      proxy,
      tunnel: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/601.6.17 (KHTML, like Gecko) Version/9.1.1 Safari/601.6.17',
        referer: 'https://www.youtube.com/tv?theme=cl',
      },
      /*
      agentOptions: {
        ca: fs.readFileSync('/Users/pedro/.mitmproxy/mitmproxy-ca-cert.pem'),
        rejectUnauthorized: false,
        //strictSSL: false,
      },*/
    };

    this.r = request.defaults(requestDefaults);
    this.incoming = new LongPoll({
      beforeRequest: this.incomingBeforeRequest.bind(this),
      cookieJar: this.cookieJar,
      requestDefaults,
    });

    this.outgoing = new LongPoll({
      beforeRequest: this.outgoingBeforeRequest.bind(this),
      cookieJar: this.cookieJar,
      proxy,
    });

    this.start('pairingCode=cd96184e-3b78-4a54-b605-4d86c70aaee4&v=0GGt-zGdfeg&t=85.9&theme=cl');
  }

  rid() {
    return Math.floor(Math.random() * this.maxRID) + this.minRID;
  }

  zx() {
    return randomstring.generate(this.zxSize)
      .toLowerCase();
  }

  url(qsParam) {
    const qs = qsParam;

    qs.device = this.device;
    qs.id = this.uuid;
    if (this.loungeIdToken) {
      qs.loungeIdToken = this.loungeIdToken;
    }
    qs.VER = this.ver;
    qs.app = this.app;
    qs.theme = this.theme;

    /*
    Object.keys(qsParam)
      .forEach((v) => {
        qs[v] = qsParam[v];
      });*/

    return `${this.apiURL}/bc/bind?${querystring.stringify(qs)}`;
  }

  parseBody(rawBody) {
    const messages = [];
    let raw = rawBody;

    while (raw.length) {
      const lineEnd = raw.indexOf('\n');
      const dataSize = +raw.substr(0, lineEnd);
      raw = raw.slice(lineEnd + 1, raw.length);
      const data = raw.slice(0, dataSize)
        .toString();
      let parsedData = null;
      try {
        parsedData = JSON.parse(data, (k, v) => {
          if (typeof v === 'string' && v.indexOf('\"') !== -1) {
            return JSON.parse(v);
          }
          return v;
        });
        for (const m of parsedData) {
          messages.push({
            index: m[0],
            command: m[1][0],
            args: m[1][1],
          });
        }
      } catch (e) {
        this.log(`parseBody JSON Error: ${e.message}`);
      }
      raw = raw.slice(dataSize, raw.length);
    }
    return messages;
  }

  processResponse(err, responseData, next) {
    if (err) {
      this.log(`Error in request (processResponse): ${err.message}`);
      return;
    }
    const data = responseData;
    const res = data.res;
    if (!res) {
      return;
    }
    if (res.statusMessage === '400 Unknown SID') {
      this.log(`Error: ${res.statusMessage}. Reset SID and Reconnecting.`);
      this.osid = this.sid;
      this.oaid = this.aid;
      this.sid = null;
      next();
      return;
    }
    if (res.statusMessage === '410 Gone') {
      this.log('Error: 410 Gone');
      this.sid = '';
      this.loadLoungeToken(() => {
        next();
        return;
      });
    }
    if (res.statusCode === 401) {
      this.log(`Error: ${res.statusMessage}`);
      this.sid = null;
      return;
    }
    if (res.statusCode === 502) {
      this.log(`Error: ${res.statusMessage}`);
      next();
      return;
    }
    if (res.statusCode !== 200) {
      this.log(`Server Error: ${res.statusMessage}.`);
      //this.quit();
      next();
      return;
    }

    if (data.count === 0) {
      this.aid = -1;
    }

    if (!this.isRunning()) {
      this.log('App not running. Ignoring message.');
      return;
    }
    this.handleRawMessage(res.body);
    next();
    return;
  }

  handleRawMessage(body) {
    this.log(`-> Raw msg: ${body.substr(0, 70)}`);
    for (const message of this.parseBody(body)) {
      switch (message.command) {
        case 'noop':
          // ignore
          break;
        case 'c':
          if (message.args.length === 0) {
            this.log('no arguments for "c" command');
            break;
          }
          this.sid = message.args;
          this.osid = null;

          this.log(`-> c: sid= ${message.args}`);
          break;
        case 'S':
          if (message.args.length === 0) {
            this.log('no arguments for "S" command');
            break;
          }
          this.gsessionId = message.args;
          this.log(`-> S: gessionId= ${message.args}`);
          break;
        default:
          // Check if the current message index is what we expect, which is
          // the index of the last processed message + 1
          if (message.index !== this.aid + 1) {
            if (message.index <= this.aid) {
              this.log(`Old command: ${message.index} ${message.command}`);
              return;
            }

            this.log(`Missing messages, recieved: ${message.index} expecting: ${this.aid}`);
          }

          // Update message index and handle message
          this.aid = message.index;
          this.emit(message.command, message.args);
          this.handleMessage(message);
      }
    }
  }

  handleMessage({
    index,
    command,
    args,
  }) {
    let position = 0;
    this.emit(command, args);
    switch (command) {
      case 'remoteConnected':
        this.log(`-> remoteConnected: ${args.name}`);
        break;

      case 'remoteDisconnected':
        this.log(`-> remoteDisconnected: ${args.name}`);
        break;

      case 'loungeScreenConnected':
        break;
      case 'loungeScreenDisconnected':
        break;

      case 'gracefulDisconnect':
        break;

      case 'loungeStatus':
        // pass
        this.log('-> loungeStatus');
        break;

      case 'getVolume':
        this.log('-> getVolume');
        break;

      case 'setVolume':
        this.log(`-> setVolume: ${args.volume} delta: ${args.delta}`);
        break;

      case 'getPlaylist':
        this.log('-> getPlaylist');
        break;

      case 'setPlaylist':
        this.log(`-> setPlaylist: ${JSON.stringify(args, null, 2)}`);
        this.log(`   Current Index: ${args.currentIndex}`);
        break;

      case 'updatePlaylist':
        this.log(`-> updatePlaylist: ${args.eventDetails.eventType}: ${args.videoIds}`);
        this.log(`   Current Index: ${args.currentIndex}`);
        this.sendMessage({
          command: 'confirmPlaylistUpdate',
          args: {
            updated: true,
          },
        });
        break;

      case 'setVideo':
        position = parseDuration.parse(`${args.currentTime}s`);
        this.log(`-> setVideo: ${args.videoId} at: ${position}`);
        break;

      case 'getNowPlaying':
        this.log('-> getNowPlaying');
        break;

      case 'getSubtitlesTrack':
        this.log('-> getSubtitlesTrack');
        break;

      case 'playlistModified':
        this.log('-> playlistModified');
        break;

      case 'pause':
        this.log('-> pause');
        break;

      case 'play':
        this.log('-> play');
        break;

      case 'seekTo':
        this.log('-> seekTo');
        position = parseDuration.parse(`${args.newTime}s`);
        this.log(`New video position: ${position}`);
        break;

      case 'stopVideo':
        this.log('-> stopVideo:');
        this.log(`   ${JSON.stringify(args, null, 2)}`);
        break;

      case 'onUserActivity':
        this.log('-> onUserActivity');
        this.log(`   ${JSON.stringify(args, null, 2)}`);
        break;

      case 'forceDisconnect':
        this.log(`-> forceDisconnect: ${args.reason}`);
        break;

      default:
        this.log(`Unknown Command ${command}`);
        break;
    }
    return true;
  }

  // Will be called before a long polled request is made to the server
  incomingBeforeRequest() {
    const options = {};

    if (this.sid) {
      // Normal connection
      this.log('[In] Normal Request');
      options.method = 'GET';
      options.url = this.url({
        RID: 'rpc',
        SID: this.sid,
        CI: 0,
        AID: this.aid,
        constssionid: this.gsessionId,
        TYPE: 'xmlhttp',
        zx: this.zx(),
      });
    } else {
      options.skipRequest = true;
    }
    return options;
  }

  outgoingBeforeRequest() {
    const options = {
      method: 'POST',
      postData: {
        form: {
          count: 0,
        },
      },
    };

    if (!this.sid || !this.gsessionId) {
      /* https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&
         id=...&name=YouTube%20TV&
         app=lb-v4&theme=cl&capabilities&mdx-version=2&
         loungeIdToken=...&
         VER=8&v=2&RID=25648&CVER=1&zx=u83r60vkflgn&t=1 */

      this.log('No SID and gsessionId let\'s try to get it');
      options.postData.form = {
        count: 0,
      };

      if (!this.osid) {
        this.log('[Out] Previous SID not found, request new SID');
        options.url = this.url({
          RID: this.rid(),
          zx: this.zx(),
        });
      } else {
        // connection after a 400 Unknown SID error
        this.log('[Out] Request new SID after SID Error');
        options.url = this.url({
          RID: this.rid(),
          OSID: this.sid,
          OAID: this.aid,
          zx: this.zx(),
        });
      }
      return options;
    }

    const numberOfMessages = this.outgoingMessageQueue.length;
    if (numberOfMessages) {
      options.postData.form.count = numberOfMessages;
      options.postData.form.ofs = 0;
    }

    this.log(`[Out] # messages: ${numberOfMessages}`);
    for (let i = 0; i < numberOfMessages; i++) {
      const req = `req${i}_`;
      const message = this.outgoingMessageQueue[i];

      // Get message command
      options.postData.form[`${req}_sc`] = message.command;

      // Get all command arguments
      for (let k = 0; k < message.args; k++) {
        options.postData.form[`${req}${k}`] = message.args[k];
      }
    }
    this.outgoingMessageQueue = [];

    options.url = this.url({
      SID: this.sid,
      RID: this.rid(),
      AID: this.aid,
      gsessionid: this.gsessionId,
      zx: this.zx(),
      theme: this.theme,
    });

    this.log('[Out] Message:');
    this.log(`    ${JSON.stringify(options.postData.form, null, 2)}`);
    return options;
  }

  // Quit App
  quit() {
    this.log('App Quit');
    if (!this.running) {
      return this;
    }
    this.running = false;
    // TODO Close streams
    return this;
  }

  // Is App Running
  isRunning() {
    return this.running;
  }

  getURLs(urlsArray, next) {
    const url = urlsArray.splice(0, 1)[0];
    if (!url) {
      return next();
    }
    this.r.get(url, (err, res, body) => {
      if (err) {
        throw err;
      }
      console.log(`=> [${body}]`);
      return this.getURLs(urlsArray, next);
    });
  }

  start(launchData, next) {
    this.log('App Starting...');
    const q = querystring.parse(launchData);

    this.running = true;
    this.pairingCode = q.pairingCode;

    if (q.theme) {
      this.theme = q.theme;
    }

    if (!q.pairingCode) {
      return next(new Error('YouTube App needs a pairing code to initialize'));
    }

    this.log(`DIAL pairing code ${this.pairingCode}`);

    let position = 0;
    if (q.v) {
      this.video = q.v;
      if (q.t) {
        position = parseDuration(q.t);
      }
    }

    // The first request sends the pairing code to YouTube and
    // YouTube sets the cookies for all further requests
    this.r.get(`https://www.youtube.com/tv?${launchData}`, (errGet) => {
      this.log(`TV: [https://www.youtube.com/tv?${launchData}]`);
      this.logCookies();
      if (errGet) {
        next(errGet);
        return;
      }

      // Now that we have the Session Cookies
      // Get the screen ID
      this.getScreenId((errScreenId) => {
        if (errScreenId) {
          next(errScreenId);
          return;
        }

        // Get the Lounge Id Token for the screen
        this.getLoungeIdToken((errLoungeIdToken) => {
          if (errLoungeIdToken) {
            next(errLoungeIdToken);
            return;
          }

          // Open communication channel and get sessions IDs
          this.log('[Out] Long Poll connections starting...');
          this.outgoing.request.bind(this.outgoing)(this.processResponse.bind(this));

          this.registerScreen((errRegisterScreen) => {
            if (errRegisterScreen) {
              next(errRegisterScreen);
              return;
            }

            // Communication channel is up. Ready to start video playback
            this.log(`Emit play-video: video: ${this.video},index: 0 , pos:${position}}`);
            this.emit('play-video', {
              video: this.video,
              index: 0,
              t: q.t,
              pos: position,
            });

            this.log('[In] Long Poll connections starting...');
            this.incoming.request.bind(this.incoming)(this.processResponse.bind(this));

            this.log('[In, Out] Long Poll connections started');
            this.log('App Started');
            next(null);
          });
        });
      });
    });
    return this;
  }

  getLoungeIdToken(next) {
    if (!this.screenId) {
      return next(new Error('Screen ID is required before calling getLoungeIdToken'));
    }
    const postData = {
      form: {
        screen_ids: this.screenId,
      },
    };
    const url = `${this.apiURL}/pairing/get_lounge_token_batch`;
    this.r.post(url, postData, (errPost, res, body) => {
      this.log(`Get Lounge Token: ${url}`);
      if (errPost) {
        this.log(`Error: getLoungeIdToken(): ${errPost.message}`);
        return next(errPost);
      }
      this.logCookies();
      let obj = null;
      try {
        obj = JSON.parse(body);
      } catch (e) {
        this.quit();
        this.log(`Quit App. JSON Error: ${e.message}`);
        return next(e);
      }
      if (!obj) {
        this.quit();
        return next(new Error('loadLoungeToken: unable to parse response body'));
      }
      this.screens = obj.screens[0];

      if (!this.screens.loungeToken) {
        this.quit();
        return next(new Error('loadLoungeToken: loungToken not found'));
      }
      this.loungeIdToken = this.screens.loungeToken;
      this.log(`loungeIdToken: [${this.loungeIdToken}]`);
      return next(null, this.screens);
    });
    return this;
  }

  getScreenId(next) {
    this.log(`Get Screen ID: ${this.apiURL}/pairing/generate_screen_id`);
    this.r.get(`${this.apiURL}/pairing/generate_screen_id`,
      (err, req, body) => {
        if (err) {
          return next(err);
        }
        this.logCookies();
        if (!body) {
          this.quit();
          next(new Error('getScreenId recieved an empty response. ScreenId not set'));
          return this;
        }
        this.screenId = body;
        this.log(`Screen Id: [${this.screenId}]`);
        return next(null, this.screenId);
      });
    return this;
  }

  registerScreen(next) {
    if (!this.screenId || !this.pairingCode) {
      return next(new Error('Need screenId and pairingCode to register screen'));
    }
    const postData = {
      form: {
        access_type: 'permanent',
        pairing_code: this.pairingCode,
        screen_id: this.screenId,
        screen_name: 'YouTube TV',
        app: 'lb-v4',
      },
    };

    this.log('Registering screen...');
    this.r.post(`${this.apiURL}/pairing/register_pairing_code`,
      postData, (err, res, body) => {
        if (err) {
          this.log('Error: could not register pairing code');
          return next(err);
        }
        this.log('Screen registered.');
        return next(null, res, body);
      });
    return this;
  }

  // App name
  getName() {
    return this.systemName;
  }

  setName(name) {
    if (name) {
      this.systemName = name;
    }
    return this;
  }

  sendMessage(message) {
    this.outgoingMessageQueue.push(message);
    return this;
  }

  logCookies() {
    this.log(`Cookies: ${this.cookieJar.getCookieString('https://www.youtube.com')}`);
  }

  log(message) {
    if (this.debug) {
      console.log(message);
    }
  }
}

module.exports = YouTubeDialApp;
