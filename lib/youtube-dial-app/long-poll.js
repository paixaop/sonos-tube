/* eslint strict: "off" */
'use strict';

const request = require('request');
const EventEmitter = require('events')
  .EventEmitter;

class LongPoll extends EventEmitter {

  constructor({
    pollInterval = 1000,
    cookies = true,
    url = '',
    beforeRequest = null,
  } = {}) {
    // Init the EventEmitter
    super();

    this.pollInterval = pollInterval;
    this.cookies = cookies;
    this.url = url;
    this.beforeRequest = beforeRequest;

    if (!this.beforeRequest) {
      throw new Error('LongPoll needs a beforeRequest callback');
    }

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
  }

  request(handleResponseCallback) {
    if (typeof handleResponseCallback !== 'function') {
      throw new Error('LongPoll request() parameter must be a function callback');
    }
    // Get the options for this request
    const options = this.beforeRequest();

    // If caller want to skip this request just set the next one
    if (options.skipRequest) {
      return setTimeout(() => {
          this.request(handleResponseCallback);
        },
        this.pollInterval
      );
    }

    // No Skip, go ahead with request
    console.log(`${options.method} ${options.url}`);
    if (options.method === 'POST') {
      console.log(`POST Options: ${JSON.stringify(options.postData.form, null, 2)}`);
    }
    options.count = this.count;
    if (!options.method) {
      throw new Error('LongPoll must have a request method, ex GET, POST');
    }
    options.method = options.method.toUpperCase();

    switch (options.method) {
      case 'GET':
        {
          this.r.get(options.url, (errRGet, res, body) => {
            if (errRGet) {
              options.res = null;
              options.body = null;
              options.errorCount = ++this.errorCount;
            } else {
              this.errorCount = 0;
              options.res = res;
              options.body = body;
              options.errorCount = 0;
            }

            return handleResponseCallback(errRGet, options, () => {
              console.log(`Making the next request in ${this.pollInterval / 1000}s.`);
              return setTimeout(() => {
                  this.request(handleResponseCallback);
                },
                this.pollInterval
              );
            });
          });
          break;
        }
      case 'POST':
        {
          this.r.post(options.url, options.postData, (errRPost, res, body) => {
            if (errRPost) {
              options.res = null;
              options.body = null;
              options.errorCount = ++this.errorCount;
            } else {
              this.errorCount = 0;
              options.res = res;
              options.body = body;
              options.errorCount = 0;
            }

            return handleResponseCallback(errRPost, options, () => {
              console.log(`Making the next request in ${this.pollInterval / 1000}s.`);
              return setTimeout(() => {
                  this.request(handleResponseCallback);
                },
                this.pollInterval
              );
            });
          });
          break;
        }
      default:
        throw new Error(`LongPoll unknown request method ${options.method}`);
    }
    this.count += 1;
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
