/* eslint strict: "off" */
'use strict';

const os = require('os');
const EventEmitter = require('events')
  .EventEmitter;
const util = require('util');
const RID = require('./rid');
const querystring = require('querystring');
const uuid = require('uuid');
const parseURL = require('url');
const parseDuration = require('parse-duration');
const request = require('request');
const LongPoll = require('./long-poll');
const crypto = require('crypto');

// How often a new connection attempt should be done.
// With a starting delay of 500ms that exponentially increases, this is about 5
// minutes.
const RETRIES = 5;

// URL used in all nomal requests for incoming data
const NORMAL_RECONNECT_URL = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&RID=rpc&SID=%s&CI=0&AID=%d&constssionid=%s&TYPE=xmlhttp&zx=%s';

// URL used in the first request for incoming data
const FIRST_CONNECTION_URL = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&RID=%d&zx=%s';

// URL to get messages after a SID error
const CONNECTION_AFTER_SID_ERROR = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&OSID=%s&OAID=%d&VER=8&RID=%d&zx=%s';

// URL used to send messages
const SEND_MESSAGE_URL = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&SID=%s&RID=%d&AID=%d&gsessionid=%s&zx=%s';

class YouTubeDialApp extends EventEmitter {

  constructor() {
    super();

    this.rid = new RID();
    this.uuid = this.getUUID();
    this.loungeToken = '';
    this.sid = '';
    this.gsessionId = '';
    this.aid = 0;
    this.pairingCode = '';
    this.screens = {};
    this.screenId = '';
    this.systemName = 'YouTube';
    this.outgoingMessageQueue = [];

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
      console.log(`Incomming Message Error: ${err.message}`);
      if (this.incoming.getErrorCount() > RETRIES) {
        console.log('Error: Too many retries quiting appliaction');
        this.quit();
      }
    });

    this.outgoing.on('error', (err) => {
      console.log(`Outgoing Message Error: ${err.message}`);
      if (this.outgoing.getErrorCount() > RETRIES) {
        console.log('Error: Too many retries quiting appliaction');
        this.quit();
      }
    });
  }

  parseBody(rawBody) {
    let messages = [];
    let raw = rawBody;

    while (raw.length) {
      const lineEnd = raw.indexOf('\n');
      const dataSize = +raw.toString('ascii', 0, lineEnd);
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
        console.log(e.message);
      }
      raw = raw.slice(dataSize, raw.length);
    }
    return messages;
  }

  processIncomingResponse(err, responseData, next) {
    if (err) {
      return;
    }
    let data = responseData;
    const res = data.res;
    if (!res) {
      return;
    }
    if (res.status === '400 Unknown SID') {
      console.log(`Error: ${res.status}. Reset SID and Reconnecting.`);
      this.sid = '';
      this.incoming.reset();
      next();
      return;
    }
    if (res.status === '410 Gone') {
      console.log('Error: 410 Gone');
      this.sid = '';
      this.incoming.reset();
      this.loadLoungeToken(() => {
        next();
        return;
      });
    }
    if (res.statusCode === 502) {
      console.log('Error: Server Error Code 502');
      next();
      return;
    }
    if (res.statusCode !== 200) {
      console.log(`Error: Server Error Code ${res.statusCode}`);
      this.quit();
      return;
    }

    if (data.count === 0) {
      this.aid = -1;
    }

    if (!this.isRunning()) {
      console.log('App not running. Ignoring message.');
      return;
    }
    this.handleRawMessage(res.body);
    next();
    return;
  }

  handleRawMessage(body) {
    for (const message of this.parseBody(body)) {
      switch (message.command) {
        case 'noop':
          // ignore
          break;
        case 'c':
          if (message.args.length === 0) {
            console.log('no arguments for "c" command');
            break;
          }
          this.sid = message.args;
          break;
        case 'S':
          if (message.args.length === 0) {
            console.log('no arguments for "S" command');
            break;
          }
          this.gsessionId = message.args;
          break;
        default:
          this.handleIncomingMessage(message);
      }
    }
  }

  handleIncomingMessage({
    index,
    command,
    args,
  }) {
    // Check if the current message index is what we expect, which is
    // the index of the last processed message + 1
    if (index !== this.aid + 1) {
      if (index <= this.aid) {
        console.log(`Old command: ${index} ${command}`);
        return false;
      }

      console.log(`Missing messages, recieved: ${index} expecting: ${this.aid}`);
    }

    // Update message index
    this.aid = index;

    let position = 0;
    this.emit(command, args);
    switch (command) {
      case 'remoteConnected':
        console.log(`Remote Connected: ${args.name}`);
        break;

      case 'remoteDisconnected':
        console.log(`Remote disconnected: ${args.name}`);
        break;

      case 'loungeStatus':
        // pass
        break;

      case 'getVolume':
        console.log('Get Volume');
        break;

      case 'setVolume':
        console.log(`Set volume: ${args.volume} delta: ${args.delta}`);
        break;

      case 'getPlaylist':
        break;

      case 'setPlaylist':
        console.log(`Set Playlist: ${args.eventDetails.eventType}: ${args.videoIds}`);
        console.log(`Current Index: ${args.currentIndex}`);
        break;

      case 'updatePlaylist':
        console.log(`Update Playlist: ${args.eventDetails.eventType}: ${args.videoIds}`);
        console.log(`Current Index: ${args.currentIndex}`);
        this.sendMessage({
          command: 'confirmPlaylistUpdate',
          args: {
            updated: true,
          },
        });
        break;

      case 'setVideo':
        position = parseDuration.parse(`${args.currentTime}s`);
        console.log(`Set video: ${args.videoId} at: ${position}`);
        break;

      case 'getNowPlaying':
        break;

      case 'getSubtitlesTrack':
        break;

      case 'pause':
        console.log('Pause');
        break;

      case 'play':
        console.log('Play');
        break;

      case 'seekTo':
        position = parseDuration.parse(`${args.newTime}s`);
        console.log(`New video position: ${position}`);
        break;

      case 'stopVideo':
        console.log('Stop Video: ' + JSON.stringify(args, null, 2));
        break;

      case 'onUserActivity':
        break;

      default:
        console.log(`Unknown Command ${command}`);
        break;
    }
    return true;
  }

  // Will be called before a long polled request is made to the server
  incomingBeforeRequest(count, next) {
    const options = {};

    if (count === 0) {
      options.method = 'POST';
      options.postData = {
        count: '0',
      };
      if (this.sid === '') {
        // First Connection
        options.url = util.format(FIRST_CONNECTION_URL,
          this.uuid,
          querystring.escape(this.systemName),
          this.loungeToken,
          this.rid.next(),
          this.rid.zx()
        );
      } else {
        // connection after a 400 Unknown SID error
        options.url = util.format(CONNECTION_AFTER_SID_ERROR,
          this.uuid,
          querystring.escape(this.systemName),
          this.loungeToken,
          this.sid, this.aid,
          this.rid.next(),
          this.rid.zx()
        );
      }
    } else {
      // Normal connection
      options.method = 'GET';
      options.url = util.format(NORMAL_RECONNECT_URL,
        this.uuid,
        querystring.escape(this.systemName),
        this.loungeToken,
        this.sid, this.aid,
        this.gsessionId,
        this.rid.next(),
        this.rid.zx()
      );
    }
    next(null, options);
  }

  outgoingBeforeRequest(count, next) {
    console.log(`Outgoing request ${count}`);

    const numberOfMessages = this.outgoingMessageQueue.lenght;
    const options = {
      postData: {
        form: {
          count: numberOfMessages,
          ofs: 0,
        },
      },
    };

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

    options.url = util.format(SEND_MESSAGE_URL,
      this.uuid,
      querystring.escape(this.systemName),
      this.loungeToken,
      this.sid,
      this.rid.next(),
      this.aid,
      this.gsessionId,
      this.rid.zx()
    );
    options.method = 'POST';
    this.outgoingMessageQueue = [];
    next(null, options);
  }

  // response in the outgoing channel
  processOutgoingResponse(err, data, next) {
    if (err) {
      return next(err);
    }
    const res = data.res;
    if (!res) {
      return next(new Error('No response found'));
    }

    if (res.statusCode !== 200) {
      console.log(`Error: Server Error Code ${res.statusCode}: ${res.statusMessage}`);
      next();
      return next(new Error(`Error: Server Error Code ${res.statusCode}: ${res.statusMessage}`));
    }
    this.handleRawMessage(res.body);
    return next(null);
  }

  // Quit App
  quit() {
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
    this.rid = new RID();
    this.uuid = uuid.v4()
      .toString();

    const q = parseURL.parse(url, true)
      .query;

    this.running = true;
    this.pairingCode = q.pairingCode;

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
        return next(errLoungToken);
      }

      this.registerScreen((errRegisterScreen) => {
        if (errRegisterScreen) {
          return next(errRegisterScreen);
        }
        //this.setPlayState(this.video, 0, position, '');
        this.incoming.request(this.processIncomingResponse.bind(this));
        this.outgoing.request(this.processOutgoingResponse.bind(this));
        return next(null);
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
      this.r.post('https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch',
        postData, (errPost, res, body) => {
          if (errPost) {
            return next(errPost);
          }
          let obj = null;
          try {
            obj = JSON.parse(body);
          } catch (e) {
            this.quit();
            console.log(`Quit App. JSON Error: ${e.message}`);
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
          return next(null, this.screens);
        });
    });
  }

  getScreenId(next) {
    this.r.get('https://www.youtube.com/api/lounge/pairing/generate_screen_id',
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
        return next(null, this.screenId);
      });
    return this;
  }

  connect() {
    this.loadLoungeToken((err) => {
      if (err) {
        throw err;
      }
      this.bind();
    });
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

    console.log('Registering screen...');
    this.r.post('https://www.youtube.com/api/lounge/pairing/register_pairing_code',
      postData, (err, res, body) => {
        if (err) {
          console.log('Error: could not register pairing code');
          return next(err);
        }
        console.log('Screen registered.');
        return next(null, res, body);
      });
    return this;
  }

  // App name
  FriendlyName() {
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
  }
}

module.exports = YouTubeDialApp;
