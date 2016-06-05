'use strict';
var sonos = require('sonos');
var _ = require('underscore');
var DialServer = require('./lib/tube-server');

var sonosPlayers = { };

var TIMEOUT = 2000 // Search for 2 seconds, increase this value if not all devices are shown
var SEARCH_INTERVAL = 60 * 1000; // Search for new Sonos device every minute
var PORT = 3100;

// Search and collect device information
function searchSonosDevices() {
    sonos.search(function(device, model) {
        var deviceData = {
            ip: device.host,
            port: device.port,
            model: model
        }
        var ssdpStarted = false;
        device.getZoneAttrs(function(err, attrs) {
            if (!err) {
                _.extend(deviceData, attrs)
            }
            device.getZoneInfo(function(err, info) {
                if (!err) {
                    _.extend(deviceData, info)
                }
                device.getTopology(function(err, info) {
                    if (!err) {
                        info.zones.forEach(function(group) {
                            if (group.location === 'http://' + deviceData.ip + ':' + deviceData.port + '/xml/device_description.xml') {
                                _.extend(deviceData, group)
                            }
                        })
                    }
                    if( !sonosPlayers[deviceData.name] && deviceData.name ==='Gym') {
                        var d = new DialServer(deviceData, PORT++);
                        d.start(function() {
                            sonosPlayers[deviceData.name] = d;
                        });
                    }
                })
            });
        })
    })
}

var pjson = require('./package.json');

console.log('SonosTube - Stream from YouTube directly to your Sonos players v' + pjson.version + '\n');
console.log('Searching for Sonos devices...');
searchSonosDevices();

// Refresh the search
setInterval(function() {
    searchSonosDevices();
}, SEARCH_INTERVAL);