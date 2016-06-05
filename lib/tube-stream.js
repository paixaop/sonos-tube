'use strict';
var ytdl = require('ytdl-core');
var FFmpeg = require('fluent-ffmpeg');
var through = require('through2');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var TubeStream = function(uri) {
  var self = this;
  EventEmitter.call(self);

  self.opt = {
    videoFormat: 'mp4',
    quality: 'lowest',
    audioFormat: 'mp3',
    applyOptions: function() {}
  };

  self.video = ytdl(uri, {
    filter: self.filterVideo,
    quality: self.opt.quality
  });

  self.video.on('info', function(data) {
    console.log('TubeStream Info: ' + data.title);
    self.emit('info', data);
  });

  self.video.on('finish', function() {
    self.emit('finish');
  });

  self.video.on('end', function() {
    self.emit('end');
  });

  self.filterVideo = function(format) {
    return format.container === (self.opt.videoFormat);
  }

  self._stream = self.opt.file ? fs.createWriteStream(self.opt.file) : through();

  self.ffmpeg = new FFmpeg(self.video);
  self.opt.applyOptions(self.ffmpeg);
  self.output = self.ffmpeg
    .format(self.opt.audioFormat)
    .pipe(self._stream);

  self.output.on('error', function(video) {
    self.video.end.bind(video);
    self.emit('error', video);
  });

  self.output.on('unpipe', function(source) {
    self.emit('unpipe', source);
  });

  self.stream = function() {
    return self._stream;
  };

  self.pipe = function(stream) {
    return self._stream.pipe(stream);
  };

};

util.inherits(TubeStream, EventEmitter);
module.exports = TubeStream;

