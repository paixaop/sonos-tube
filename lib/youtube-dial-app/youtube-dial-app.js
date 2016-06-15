/* eslint strict: "off" */
'use strict';

const os = require('os');
const EventEmitter = require('events')
  .EventEmitter;
const querystring = require('querystring');
const uuid = require('uuid');
const parseURL = require('url');
const parseDuration = require('parse-duration');
const request = require('request');
const LongPoll = require('./long-poll');
const crypto = require('crypto');
const randomstring = require('randomstring');

// Number of connection retries
const RETRIES = 5;

// Size of the zx random strings
const ZX_RANDOM_STRING_SIZE = 12;

const API_URL = 'https://www.youtube.com/api/lounge';

class YouTubeDialApp extends EventEmitter {

  constructor() {
    super();

    this.rid = this.newRID();
    this.uuid = this.getUUID();
    this.loungeToken = '';
    this.sid = '';
    this.gsessionId = '';
    this.aid = 0;
    this.pairingCode = '';
    this.screens = {};
    this.screenId = '';
    this.systemName = querystring.escape('YouTube TV');
    this.outgoingMessageQueue = [];
    this.osid = '';
    this.oaid = '';

    this.debug = true;

    this.r = request.defaults({
      jar: true,
    });

    this.incoming = new LongPoll({
      beforeRequest: this.incomingBeforeRequest.bind(this),
    });

    this.outgoing = new LongPoll({
      beforeRequest: this.outgoingBeforeRequest.bind(this),
    });

    this.incoming.on('error', (err) => {
      this.log(`Incomming Message Error: ${err.message}`);
      if (this.incoming.getErrorCount() > RETRIES) {
        this.log('Error: Too many retries quiting appliaction');
        this.quit();
      }
    });

    this.outgoing.on('error', (err) => {
      this.log(`Outgoing Message Error: ${err.message}`);
      if (this.outgoing.getErrorCount() > RETRIES) {
        this.log('Error: Too many retries quiting appliaction');
        this.quit();
      }
    });
  }

  nextRID() {
    this.rid += 1;
    return this.rid;
  }

  newRID() {
    this.rid = Math.floor(Math.random() * 80000) + 10000;
    return this.rid;
  }

  zx() {
    return randomstring.generate(ZX_RANDOM_STRING_SIZE);
  }

  url(qsParam) {
    const qs = qsParam;

    qs.device = 'LOUNGE_SCREEN';
    qs.VER = 8;
    qs.app = 'lb-v4';
    qs.theme = this.theme;

    return `${API_URL}/bc/bind?${querystring.stringify(qs)}`;
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
      this.log(`Error: ${res.status}. Reset SID and Reconnecting.`);
      this.osid = this.sid;
      this.oaid = this.aid;
      this.sid = null;
      this.incoming.reset();
      next();
      return;
    }
    if (res.statusMessage === '410 Gone') {
      this.log('Error: 410 Gone');
      this.sid = '';
      this.incoming.reset();
      this.loadLoungeToken(() => {
        next();
        return;
      });
    }
    if (res.statusCode === 401) {
      this.log('Error: ${res.status}');
      this.sid = null;
    }
    if (res.statusCode === 502) {
      this.log(`Error: ${res.status}`);
      next();
      return;
    }
    if (res.statusCode !== 200) {
      this.log(`Server Error: ${res.statusMessage}.`);
      //this.quit();
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
  incomingBeforeRequest(next) {
    const options = {};

    if (this.sid) {
      // Normal connection
      this.log('[In] Normal Request');
      options.method = 'GET';
      options.url = this.url({
        id: this.uuid,
        name: this.systemName,
        loungeToken: this.loungeToken,
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

  outgoingBeforeRequest(next) {
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
          id: this.uuid,
          name: this.systemName,
          'mdx-version': 2,
          loungeToken: this.loungeToken,
          v: 2,
          RID: this.nextRID(),
          CVER: 1,
          zx: this.zx(),
          t: 1,
        }) + '&capabilities';
      } else {
        // connection after a 400 Unknown SID error
        this.log('[Out] Request new SID after SID Error');
        options.url = this.url({
          id: this.uuid,
          name: this.systemName,
          loungeToken: this.loungeToken,
          RID: this.nextRID(),
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
      id: this.uuid,
      name: this.systemName,
      loungeToken: this.loungeToken,
      SID: this.sid,
      RID: this.nextRID(),
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

  start(url, next) {
    this.log('App Starting...');
    this.rid = this.newRID();
    this.uuid = uuid.v4()
      .toString();

    const q = parseURL.parse(url, true)
      .query;

    this.running = true;
    this.pairingCode = q.pairingCode;

    if (q.theme) {
      this.theme = q.theme;
    }

    if (!q.pairingCode) {
      return next(new Error('YouTube App needs a pairing code to initialize'));
    }
    this.pairingCode = q.pairingCode;
    let position = 0;

    if (q.v) {
      this.video = q.v;
      if (q.t) {
        position = parseDuration(q.t);
      }
    }

    this.loadLoungeToken((errLoungToken) => {
      if (errLoungToken) {
        next(errLoungToken);
        return;
      }

      this.registerScreen((errRegisterScreen) => {
        if (errRegisterScreen) {
          next(errRegisterScreen);
          return;
        }

        this.log(`Emit play-video: video: ${this.video},index: 0 , pos:${position}}`);
        this.emit('play-video', {
          video: this.video,
          index: 0,
          pos: position,
        });
        this.log('[In] Long Poll connections starting...');
        this.incoming.request.bind(this.incoming)(this.processResponse.bind(this));

        this.log('[Out] Long Poll connections starting...');
        this.outgoing.request.bind(this.outgoing)(this.processResponse.bind(this));

        this.log('[In, Out] Long Poll connections started');
        this.log('App Started');
        next(null);
      });
    });
    return this;
  }

  loadLoungeToken(next) {
    this.getScreenId((errScreenId, screenId) => {
      if (errScreenId) {
        return next(errScreenId);
      }
      const postData = {
        form: {
          screen_ids: screenId,
        },
      };
      this.r.post(`${API_URL}/pairing/get_lounge_token_batch`,
        postData, (errPost, res, body) => {
          if (errPost) {
            return next(errPost);
          }
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
          this.loungeToken = this.screens.loungeToken;
          this.log(`loungeToken: ${this.loungeToken}`);
          return next(null, this.screens);
        });
      return null;
    });
    return this;
  }

  getScreenId(next) {
    this.r.get(`${API_URL}/pairing/generate_screen_id`,
      (err, red, body) => {
        if (err) {
          return next(err);
        }

        if (!body) {
          this.quit();
          next(new Error('getScreenId recieved an empty response. ScreenId not set'));
          return this;
        }
        this.screenId = body;
        this.log(`Screen Id: ${this.screenId}`);
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
    this.r.post(`${API_URL}/pairing/register_pairing_code`,
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
    return querystring.unescape(this.systemName);
  }

  setName(name) {
    if (name) {
      this.systemName = querystring.escape(name);
    }
    return this;
  }

  sendMessage(message) {
    this.outgoingMessageQueue.push(message);
    return this;
  }

  uuid5(data) {
    const out = crypto.createHash('sha1')
      .update(data)
      .digest();

    out[8] = out[8] & 0x3f | 0xa0; // set letiant
    out[6] = out[6] & 0x0f | 0x50; // set version

    const hex = out.toString('hex', 0, 16);

    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20, 32),
    ].join('-');
  }

  getUUID() {
    const interfaces = os.networkInterfaces();
    for (const i in interfaces) {
      if (interfaces.hasOwnProperty(i)) {
        if (interfaces[i].mac !== '00:00:00:00:00:00') {
          return this.uuid5(`${interfaces[i].mac}-${i}`);
        }
      }
      throw new Error('Could not find an interface with a MAC address');
    }
    return null;
  }

  log(message) {
    if (this.debug) {
      console.log(message);
    }
  }
}

module.exports = YouTubeDialApp;
