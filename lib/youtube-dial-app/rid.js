'use strict';
var randomstring = require("randomstring");

// Size of the zx random strings
var ZX_RANDOM_STRING_SIZE = 12;

/**
 * Generate Random IDs and Strings
 */
module.exports = function RID() {
    var self = this;

    self.rid = 0;

    self.newRandomId = function() {
        // new random number between 10000 - 99999
        self.rid = Math.floor(Math.random() * 80000) + 10000;
        return self.rid;
    };

    self.restart = self.newRandomId;

    self.next = function() {
        self.rid++;
        return self.rid;
    };

    /**
     * @return {string} random string of bytes that is 12 characters long.
     */
    self.zx = function() {
        return randomstring.generate(ZX_RANDOM_STRING_SIZE);
    };
};