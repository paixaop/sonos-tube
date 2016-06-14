/* eslint strict: "off" */
'use strict';

const randomstring = require('randomstring');

// Size of the zx random strings
const ZX_RANDOM_STRING_SIZE = 12;

/**
 * Generate Random IDs and Strings
 */
class RID {

  constructor() {
    this.newRandomId();
  }

  newRandomId() {
    // new random number between 10000 - 99999
    this.rid = Math.floor(Math.random() * 80000) + 10000;
    return this;
  }

  restart() {
    return this.newRandomId();
  }

  next() {
    this.rid += 1;
    return this.rid;
  }

  /**
   * @return {string} random string of bytes that is 12 characters long.
   */
  zx() {
    return randomstring.generate(ZX_RANDOM_STRING_SIZE);
  }
}

module.exports = RID;
