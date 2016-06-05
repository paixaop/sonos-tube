'use strict';
var request = require('request');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var LongPoll = function(opts) {
    var self = this;
    EventEmitter.call(self);

    self.pollInterval = opts.pollInterval || 1000;
    self.cookies = opts.cookies || true;
    self.url = opts.url || '';
    self.reqCallBack = opts.request;

    // Count the number of requests made to the server
    self.count = 0;

    self.errorCount = 0;

    // All requests use Cookies
    self.r = request.defaults({
        jar: true
    });

    self.setRequestCallback = function(url) {
        self.url = url;
    };

    self.setPostData = function(postData) {
        self.postData = {
            form: postData
        };
    };

    self.setPollInterval = function(interval) {
        self.pollInterval = interval;
    };

    self.getCount = function() {
        return self.count;
    };

    self.request = function(callback) {
        self.reqCallBack(self.count, function(err, options) {
            if (err) {
                return self.emit('error', err);
            }

            if (!options.skipRequest) {
                var response = options;

                response.count = self.count;
                switch (options.method.toUpperCase()) {
                    case 'GET':
                        self.r.get(options.url, function(err, res, body) {
                            if (err) {
                                self.errorCount++;
                                self.emit('error', err);
                                return;
                            }

                            self.errorCount = 0;
                            response.res = res;
                            response.body = body;
                            callback(response, function() {
                                self.pollTimer = setTimeout(self.request, self.pollInterval);
                            });
                        });
                        break;

                    case 'POST':
                        self.r.post(options.url, options.postData, function(err, res, body) {
                            if (err) {
                                self.errorCount++;
                                self.emit('error', err);
                                return;
                            }

                            self.errorCount = 0;
                            response.res = res;
                            response.body = body;
                            callback(response, function() {
                                self.pollTimer = setTimeout(self.request, self.pollInterval);
                            });
                        });
                        break;

                    default:
                        self.emit('error', new Error('Unsupported method: ' + method));
                        break;
                }
                self.count += 1;
            }
        });
    };

    self.getCount = function() {
        return self.count;
    };

    self.getErrorCount = function() {
        return self.errorCount;
    };

    self.reset = function() {
        self.count = 0;
        self.errorCount = 0;
    };

    self.stop = function() {
        clearTimeout(self.pollTimer);
    }

    self.start = function(method) {
        self.request();
    }

};

util.inherits(LongPoll, EventEmitter);
module.exports = LongPoll;