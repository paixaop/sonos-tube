/* eslint strict: "off" */
'use strict';

const request = require('request');
const fs = require('fs');

class LongPoll {

  constructor({
    pollInterval = 1000,
    beforeRequest = null,
    requestDefaults = {
      jar: true,
      proxy: '',
    },
  } = {}) {
    this.pollInterval = pollInterval;
    this.beforeRequest = beforeRequest;

    if (!this.beforeRequest) {
      throw new Error('LongPoll needs a beforeRequest callback');
    }

    // Count number of errors
    this.errorCount = 0;

    // request.debug = true;
    // process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    // Set request cookie defaults
    this.r = request.defaults(requestDefaults);
  }

  setBeforeRequest(callback) {
    this.beforeRequest = callback;
    return this;
  }

  setPollInterval(interval) {
    this.pollInterval = interval;
    return this;
  }

  singleRequest(handleResponseCallback) {
    return this.request(handleResponseCallback, true);
  }

  request(handleResponseCallback, once = false) {
    if (typeof handleResponseCallback !== 'function') {
      throw new Error('LongPoll request() parameter must be a function callback');
    }
    // Get the options for this request
    const options = this.beforeRequest();

    // If caller want to skip this request just set the next one
    if (options.skipRequest) {
      if (!once) {
        this.pollTimer = setTimeout(() => {
          this.request(handleResponseCallback);
        }, this.pollInterval);
      }
      return this;
    }

    // No Skip, go ahead with request
    console.log(`${options.method} ${options.url}`);
    if (options.method === 'POST') {
      console.log(`POST Options: ${JSON.stringify(options.postData.form, null, 2)}`);
    }
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
              if (!once) {
                this.pollTimer = setTimeout(() => {
                  this.request(handleResponseCallback);
                }, this.pollInterval);
              }
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
              if (!once) {
                this.pollTimer = setTimeout(() => {
                  this.request(handleResponseCallback);
                }, this.pollInterval);
              }
            });
          });
          break;
        }
      default:
        throw new Error(`LongPoll unknown request method ${options.method}`);
    }
    return this;
  }

  getErrorCount() {
    return this.errorCount;
  }

  reset() {
    this.errorCount = 0;
    return this;
  }

  stop() {
    clearTimeout(this.pollTimer);
    return this;
  }
}

module.exports = LongPoll;
