'use strict';
var ytdl = require('ytdl-core');
var FFmpeg = require('fluent-ffmpeg');
var through = require('through2');
var xtend = require('xtend');
var fs = require('fs');
var Throttle = require('throttle');
// 16-bit signed samples
var SAMPLE_SIZE = 16;
var CHANNELS = 2;
var SAMPLE_RATE = 44100;

// If we're getting raw PCM data as expected, calculate the number of bytes
// that need to be read for `1 Second` of audio data.
var BLOCK_ALIGN = SAMPLE_SIZE / 8 * CHANNELS;
var BYTES_PER_SECOND = SAMPLE_RATE * BLOCK_ALIGN;


module.exports = streamify;

function streamify(uri, opt) {
  opt = xtend({
    videoFormat: 'mp4',
    quality: 'lowest',
    audioFormat: 'mp3',
    applyOptions: function() {}
  }, opt);

  var video = ytdl(uri, {
    filter: filterVideo,
    quality: opt.quality
  });

  video.on('info', function(data) {
    if (typeof opt.info === 'function') opt.info(data);
  });

  video.on('finish', function() {
    if (opt.finish && typeof opt.finish === 'function') opt.finish();
  });

  video.on('end', function() {
    if (opt.end && typeof opt.end === 'function') opt.end();
  });

  var bytesPerSecond = 0;
  var throttle = null;

  function filterVideo(format) {
    if( format.container === (opt.videoFormat) ) {
      if (opt.format && typeof opt.format === 'function') opt.format();
      bytesPerSecond = format.audioBitrate * 1000 / 8;
      //console.log('Throttle: ' + bytesPerSecond / 1000 + 'KBps');
      throttle = new Throttle(bytesPerSecond);
      return true;
    }
    return false;
  }

  var stream = opt.file ? fs.createWriteStream(opt.file) : through();

  //var ffmpeg = throttle? new FFmpeg(video.pipe(throttle)) : new FFmpeg(video);
  var ffmpeg = new FFmpeg(video);
  opt.applyOptions(ffmpeg);
  var output = ffmpeg
    .format(opt.audioFormat)
    .pipe(stream);

  output.on('error', function(video) {
    console.log(JSON.stringify(video, null, 2));
    video.end.bind(video);
  });

  output.on('unpipe', function(source) {
    console.log('ytdl Output pipe closed');
  });

  output.on('error', function(stream) {
    console.log(JSON.stringify(stream, null, 2));
    stream.emit.bind(stream, 'error');
  });
  return stream;
}