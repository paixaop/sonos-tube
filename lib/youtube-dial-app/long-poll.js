/* eslint strict: "off" */
'use strict';

const request = require('request');
const EventEmitter = require('events')
  .EventEmitter;
const util = require('util');

class LongPoll extends EventEmitter {

  constructor({
    pollInterval = 1000,
    cookies = true,
    url = ''
  } = {}) {
    // Init the EventEmitter
    super();

    this.pollInterval = pollInterval;
    this.cookies = cookies;
    this.url = url;
    this.reqCallBack = request;

    // Count the number of requests made to the server
    this.count = 0;

    // Count number of errors
    this.errorCount = 0;

    // Set request cookie defaults
    this.r = request.defaults({
      jar: this.cookies,
    });

    this.postData = {};
  }

  setRequestCallback(callback) {
    this.reqCallBack = callback;
    return this;
  }

  setPostData(postData) {
    this.postData = {
      form: postData,
    };
    return this;
  }

  setPollInterval(interval) {
    this.pollInterval = interval;
    return this;
  }

  getCount() {
    return this.count;
  };

  request(callback) {
    this.reqCallBack(this.count, function(errReqCallback, options) {
      if (errReqCallback) {
        return this.emit('error', errReqCallback);
      }

      if (!options.skipRequest) {
        let response = options;

        response.count = this.count;
        response.method = response.method.toUpperCase();
        switch (response.method) {
          case 'GET':
            {
              this.r.get(response.url, (errRGet, res, body) => {
                if (errRGet) {
                  this.errorCount++;
                  return callback(errRGet);
                }

                this.errorCount = 0;
                response.res = res;
                response.body = body;
                return callback(null, response, () => {
                  this.pollTimer = setTimeout(this.request, this.pollInterval);
                });
              });
              break;
            }
          case 'POST':
            {
              this.r.post(response.url, response.postData, (errRPost, res, body) => {
                if (errRPost) {
                  this.errorCount++;
                  this.emit('error', errRPost);
                  return callback(errRPost);
                }

                this.errorCount = 0;
                response.res = res;
                response.body = body;
                return callback(null, response, () => {
                  this.pollTimer = setTimeout(this.request, this.pollInterval);
                });
              });
              break;
            }
          default:
            {
              return callback(new Error(`Unsupported method: ${response.method}`));
            }
        }
        this.count += 1;
      }
    });
    return this;
  }

  getErrorCount() {
    return this.errorCount;
  }

  reset() {
    this.count = 0;
    this.errorCount = 0;
    return this;
  }

  stop() {
    clearTimeout(this.pollTimer);
    return this;
  }

  start() {
    this.request();
    return this;
  }

}

module.exports = LongPoll;
