'use strict';
var url = require("url");
var http = require("http");
var https = require("https");

var proto = { "http:": http, "https:": https};

function request(urlStr, cookies, next) {
    var parsedurl = url.parse(urlStr);
    var options = {
        hostname: parsedurl.hostname,
        port: (parsedurl.port || parsedurl.protocol === "https:"? 443 : 80), // 80 by default
        method: 'GET',
        path: parsedurl.path,
        headers: {},
    };

    if(cookies) {
        options.headers['Cookie'] = cookies.join('; ');
    }

    var p = proto[parsedurl.protocol];
    p.request(options, function(response) {
        // display returned cookies in header
        var cookies = getCookies(response);
        var data = "";
        response.on(
            "data",
            function(chunk) {
                data += chunk;
            }
        );

        response.on(
            "end",
            next({
                cookies: cookies,
                data: data,
                statusCode: response.statusCode
            })
        );
    });
}

function getCookies(res) {
    var setcookie = res.headers["set-cookie"];
    var cookies = [];
    if (setcookie) {
        for (var i in setcookie) {
            cookies.push(setcookie[i].split(';')[0]);
        }
    }
    console.log(cookies);
    return cookies;
}



module.exports = request;