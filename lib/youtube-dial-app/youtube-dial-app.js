/* eslint strict: "off" */
'use strict';

const os = require('os');
const util = require('util');
const RID = require('./rid');
const querystring = require('querystring');
const uuid = require('uuid');
const parseURL = require('url');
const parseDuration = require('parse-duration');
const request = require('request');
const LongPoll = require('./long-poll');

// How often a new connection attempt should be done.
// With a starting delay of 500ms that exponentially increases, this is about 5
// minutes.
const RETRIES = 5;

// URL used in all nomal requests for incoming data
const NORMAL_RECONNECT_URL = 'https://www.youtube.com/api/lounge/bc/bind?constice=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&RID=rpc&SID=%s&CI=0&AID=%d&constssionid=%s&TYPE=xmlhttp&zx=%s';

// URL used in the first request for incoming data
const FIRST_CONNECTION_URL = 'https://www.youtube.com/api/lounge/bc/bind?constice=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&RID=%d&zx=%s';

// URL to get messages after a SID error
const CONNECTION_AFTER_SID_ERROR = 'https://www.youtube.com/api/lounge/bc/bind?constice=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&OSID=%s&OAID=%d&VER=8&RID=%d&zx=%s';

// URL used to send messages
const SEND_MESSAGE_URL = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&SID=%s&RID=%d&AID=%d&gsessionid=%s&zx=%s';

class YouTubeDialApp {

  constructor() {
    this.rid = 0;
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
      request: this.incomingRequest,
    });

    this.outgoing = new LongPoll({
      request: this.incomingRequest,
    });

    this.incoming.on('error', (err) => {
      console.log(`Incomming Message Error: ${err.message}`);
      if (this.incoming.getRetries() > RETRIES) {
        console.log('Error: Too many retries quiting appliaction');
        this.quit();
      }
    });

    this.outgoing.on('error', (err) => {
      console.log(`Outgoing Message Error: ${err.message}`);
      if (this.incoming.getErrorCount() > RETRIES) {
        console.log('Error: Too many retries quiting appliaction');
        this.quit();
      }
    });
  }

  incomingData(data, next) {
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

    this.handleIncomingMessage(data, next);
    return;
  }

  // Will be called before a long polled request is made to the server
  incomingRequest(count, next) {
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

  outgoingRequest(count, next) {
    console.log(`Outgoing request ${count}`);

    const numberOfMessages = this.outgoingMessageQueue.lenght;
    const options = {
      postData: {
        form: {
          count: numberOfMessages,
          ofs: count,
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

    next(null, options);
  }

  outgoingData(data, next) {
    console.log('Outgoing message response' + data);
    this.outgoingCount += this.outgoingMessageQueue.length;
    this.outgoingMessageQueue = [];
    next();
  }

  // Start App
  start(postData) {
    let q = querystring.parse(postData);
    this.running = true;
    this.pairingCode = p.pairingCode;
    return self;
  }

  // Quit App
  quit() {
    if (!this.running) {
      return;
    }
    this.running = false;
    // TODO Close streams
    return self;
  }

  // Is App Running
  Running() {

  };

  init(url, stateChange) {
    this.rid = new RID();
    this.uuid = uuid.v4()
      .toString();

    let q = parseURL.parse(url, true)
      .query;

    if (!q.pairingCode) {
      throw new Error('YouTube App needs a pairing code to initialize');
    }
    this.pairingCode = q.paringCode;

    if (q.v) {
      this.video = q.v;
      let position = 0;
      if (q.t) {
        position = parseDuration(q.t);
      }

    }

    this.loadLoungeToken((err, screens) => {
      this.registerScreen((err) => {
        if (err) {
          throw err;
        }
        this.setPlayState(this.video, 0, position, '');
        this.incoming.request(this.incomingData);
        this.outgoing.request(this.outgoingData);
      })
    });
  }

  loadLoungeToken(next) {
    this.getScreenId((screenId) => {
      const postData = {
        form: {
          screen_ids: [screenId],
        },
      };
      this.r.post('https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch',
        postData, (err, res, body) => {
          if (err) {
            return next(err);
          }
          try {
            let res = JSON.parse(body);
            if (!res) {
              this.quit();
              return next(new Error('loadLoungeToken: unable to parse response body'));
            }
            this.screens = res[0];

            if (!this.screens.loungeToken) {
              this.quit();
              return next(new Error('loadLoungeToken: loungToken not found'));
            }
            this.loungeToken = this.screens.loungeToken;
            return next(null, this.screens);
          } catch (err) {
            return next(err);
          }
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
        screen_id: this.screen_id,
      },
    };

    console.log('Registering screen...');
    this.r.post('https://www.youtube.com/api/lounge/pairing/register_pairing_code',
      postData, (err, res, body) => {
        if (err) {
          console.log('Error: could not register pairing code');
          return next(err);
        }
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
    return self;
  }

  sendMessages() {

  }

  uuid5(data) {
    let out = crypto.createHash('sha1')
      .update(data)
      .digest();

    out[8] = out[8] & 0x3f | 0xa0; // set letiant
    out[6] = out[6] & 0x0f | 0x50; // set version

    let hex = out.toString('hex', 0, 16);

    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20, 32)
    ].join('-');
  };

  getUUID() {
    let interfaces = os.networkInterfaces();
    for (i in interfaces) {
      if (interfaces[i].mac !== '00:00:00:00:00:00') {
        return this.uuid5(interfaces[i].mac + '-' + i);
      }
    }

    throw new Error('Could not find an interface with a MAC address');

  }
};

module.exports = YouTubeDialApp;
