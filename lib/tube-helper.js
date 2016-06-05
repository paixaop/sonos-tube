const url = require('url');
const http = require('http');
const https = require('https');

const proto = {
  'http:': http,
  'https:': https,
};

function getCookies(res) {
  const setcookie = res.headers['set-cookie'];
  let cookies = [];
  if (setcookie) {
    for (let i in setcookie) {
      cookies.push(setcookie[i].split(';')[0]);
    }
  }
  console.log(cookies);
  return cookies;
}

function request(urlStr, cookies, next) {
  const parsedurl = url.parse(urlStr);
  let options = {
    hostname: parsedurl.hostname,
    port: (parsedurl.port || parsedurl.protocol === 'https:' ? 443 : 80), // 80 by default
    method: 'GET',
    path: parsedurl.path,
    headers: {},
  };

  if (cookies) {
    options.headers.Cookie = cookies.join('; ');
  }

  let p = proto[parsedurl.protocol];
  p.request(options, (response) => {
    // display returned cookies in header
    const cook = getCookies(response);
    let data = '';
    response.on(
      'data',
      (chunk) => {
        data += chunk;
      }
    );

    response.on(
      'end',
      next({
        cookies: cook,
        data,
        statusCode: response.statusCode,
      })
    );
  });

module.exports = request;