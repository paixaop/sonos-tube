'use strict';
var os = require('os');
var util = require('util');
var RID = require('./rid');
var querystring = require('querystring');
var uuid = require('uuid');
var parseURL = require('url');
var parseDuration = require('parse-duration');
var request = require('request');
var LongPoll = require('./long-poll');

// How often a new connection attempt should be done.
// With a starting delay of 500ms that exponentially increases, this is about 5
// minutes.
var RETRIES = 25;

var NORMAL_RECONNECT_URL = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&RID=rpc&SID=%s&CI=0&AID=%d&gsessionid=%s&TYPE=xmlhttp&zx=%s';
var FIRST_CONNECTION_URL = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&VER=8&RID=%d&zx=%s';
var CONNECTION_AFTER_SID_ERROR = 'https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=%s&name=%s&loungeIdToken=%s&OSID=%s&OAID=%d&VER=8&RID=%d&zx=%s';

// Initial retry timeout in milliseconds. This timeout increases exponentially.

var RETRY_TIMEOUT = 500;

module.exports = function YouTubeDialApp() {
    var self = this;

    self.rid = 0;
    self.uuid = self.getUUID();
    self.loungeToken = '';
    self.sid = '';
    self.gsessionId = '';
    self.aid = 0;
    self.pairingCode = '';
    self.screens = {};
    self.screenId = '';
    self.systemName = 'YouTube';
    self.outgoingMessageQueue = [];

    self.r = request.defaults({
        jar: true
    });

    self.incoming = new LongPoll({
        request: self.incomingRequest
    });

    self.outgoing = new LongPoll({
        request: self.incomingRequest,
    });

    self.incoming.on('error', function(err) {
        console.log('Incomming Message Error: ' + err.message);
        if (self.incoming.getRetries() > RETRIES) {
            console.log('Error: Too many retries quiting appliaction');
            self.quit();
        }
    });

    self.outgoing.on('error', function(err) {
        console.log('Outgoing Message Error: ' + err.message);
        if (self.incoming.getErrorCount() > RETRIES) {
            console.log('Error: Too many retries quiting appliaction');
            self.quit();
        }
    });

    self.incomingData = function(data, next) {
        var res = data.res;
        if (!res) {
            return;
        }
        if (res.status === '400 Unknown SID') {
            console.log('Error: ' + res.status + '. Reset SID and Reconnecting.');
            self.sid = '';
            self.incoming.reset();
            return next();
        }
        if (res.status === '410 Gone') {
            console.log('Error: 410 Gone');
            self.sid = '';
            self.incoming.reset();
            self.loadLoungeToken(function(err, screens) {
                return next();
            });
        }
        if (res.statusCode === 502) {
            console.log('Error: Server Error Code 502');
            return next();
        }
        if (res.statusCode !== 200) {
            console.log('Error: Server Error Code ' + res.statusCode);
            self.quit();
            return;
        }

        if (data.count === 0) {
            self.aid = -1;
        }

        self.handleIncomingMessage(data, next);
    };


    // Will be called before a long polled request is made to the server
    sefl.incomingRequest = function(count, next) {
        var options = {};

        if (count === 0) {
            options.method = 'POST';
            options.postData = {
                count: "0"
            };
            if (self.sid === '') {
                // First Connection
                options.url = util.format(FIRST_CONNECTION_URL,
                    self.uuid,
                    querystring.escape(self.systemName),
                    self.loungeToken,
                    self.rid.Next(),
                    self.rid.zx()
                );
            } else {
                // connection after a 400 Unknown SID error
                options.url = util.format(CONNECTION_AFTER_SID_ERROR,
                    self.uuid,
                    querystring.escape(self.systemName),
                    self.loungeToken,
                    self.sid, aid,
                    self.rid.Next(),
                    self.rid.zx()
                );
            }
        } else {
            options.method = 'GET';
        }
    };

    self.outgoingRequest = function(count, next) {
        console.log('Outgoing request ' + count);

        var numberOfMessages = self.outgoingMessageQueue.lenght;
        var options = {};
        var count = 0;

        while (1) {
            options.count = numberOfMessages;
            options.ofs = count;

            for (var i = 0; i < numberOfMessages; i++) {
                var req = "req" + i + '_';
                options[req + '_sc'] = self.outgoingMessageQueue[i].command;

            }

            next(null, {
                skipRequest: true
            });
        }
    };

    self.outgoingData = function(data, next) {
        console.log('Outgoing message response' + data);
        next();
    };

    // Start App
    self.start = function(postData) {
        var q = querystring.parse(postData);
        self.running = true;
        self.pairingCode = p.pairingCode;
        return self;
    };

    // Quit App
    self.quit = function() {
        if (!self.running) {
            return;
        }
        self.running = false;
        // TODO Close streams
        return self;
    };

    // Is App Running
    self.Running = function() {

    };

    self.init = function(url, stateChange) {
        self.rid = new RID();
        self.uuid = uuid.v4().toString();

        var q = parseURL.parse(url, true).query;

        if (!q.pairingCode) {
            throw new Error('YouTube App needs a pairing code to initialize');
        }
        self.pairingCode = q.paringCode;

        if (q.v) {
            self.video = q.v;
            var position = 0;
            if (q.t) {
                position = parseDuration(q.t);
            }

        }

        self.loadLoungeToken(function(err, screens) {
            self.registerScreen(function(err) {
                if (err) {
                    throw err;
                }
                self.setPlayState(self.video, 0, position, '');
                self.incoming.request(self.incomingData);
                self.outgoing.request(self.outgoingData);
            })
        });
    };

    self.loadLoungeToken = function(next) {
        self.getScreenId(function(screenId) {
            var postData = {
                form: {
                    screen_ids: [screenId]
                }
            };
            self.r.post('https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch',
                postData,
                function(err, res, body) {
                    if (err) {
                        return next(err);
                    }
                    try {
                        var res = JSON.parse(body);
                        if (!res) {
                            self.quit();
                            return next(new Error('loadLoungeToken: unable to parse response body'));
                        }
                        self.screens = res[0];

                        if (!self.screens.loungeToken) {
                            self.quit();
                            return next(new Error('loadLoungeToken: loungToken not found'));
                        }
                        self.loungeToken = self.screens.loungeToken;
                        return next(null, self.screens);
                    } catch (err) {
                        next(err);
                    }

                });
        });
    };

    self.getScreenId = function(next) {
        r.get('https://www.youtube.com/api/lounge/pairing/generate_screen_id', function(err, red, body) {
            if (err) {
                return next(err);
            }

            if (!body) {
                self.quit();
                return next(new Error('getScreenId recieved an empty response. ScreenId not set'));
            }
            self.screenId = body;
            return next(null, self.screenId);
        });
    };

    self.connect = function() {
        self.loadLoungeToken(function(err, screens) {
            self.bind();
        });
    };

    self.registerScreen = function(next) {
        if (!self.screenId || !seld.pairingCode) {
            return next(new Error('Need screenId and pairingCode to register screen'));
        }
        var postData = {
            form: {
                access_type: 'permanent',
                pairing_code: self.pairingCode,
                screen_id: self.screen_id
            }
        };
        console.log('Registering screen...');
        r.post('https://www.youtube.com/api/lounge/pairing/register_pairing_code', postData, function(err, res, body) {
            if (err) {
                console.log('Error: could not register pairing code');
                return next(err);
            }
            return next(null);
        });
    };

    // App name
    self.FriendlyName = function() {
        return self.systemName;
    };

    self.setName = function(name) {
        if (name) {
            self.systemName = name;
        }
        return self;
    };

    self.sendMessages = function() {

    }

    self.uuid5 = function(data) {
        var out = crypto.createHash('sha1').update(data).digest();

        out[8] = out[8] & 0x3f | 0xa0; // set variant
        out[6] = out[6] & 0x0f | 0x50; // set version

        var hex = out.toString('hex', 0, 16);

        return [
            hex.substring(0, 8),
            hex.substring(8, 12),
            hex.substring(12, 16),
            hex.substring(16, 20),
            hex.substring(20, 32)
        ].join('-');
    };

    self.getUUID = function() {
        var interfaces = os.networkInterfaces();
        for (i in interfaces) {
            if (interfaces[i].mac !== '00:00:00:00:00:00') {
                return self.uuid5(interfaces[i].mac + '-' + i);
            }
        }

        throw new Error('Could not find an interface with a MAC address');

    };
};