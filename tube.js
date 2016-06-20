const request = require('request');
const uuid = require('uuid');
const randomstring = require('randomstring');
const querystring = require('querystring');

function rid() {
  return Math.floor(Math.random() * 80000) + 10000;
}

function zx() {
  return randomstring.generate(12)
    .toLowerCase();
}

const cookieJar = request.jar();
const requestDefaults = {
  jar: cookieJar,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/601.6.17 (KHTML, like Gecko) Version/9.1.1 Safari/601.6.17',
    referer: 'https://www.youtube.com/tv?theme=cl',
  },
};

function logCookies() {
  console.log(`Cookies: ${cookieJar.getCookieString('https://www.youtube.com')}`);
}

const r = request.defaults(requestDefaults);
//const launchData = 'pairingCode=4b257d6d-3097-4cd1-945d-afac683b4cd4&theme=cl';
const launchData = 'pairingCode=cd96184e-3b78-4a54-b605-4d86c70aaee4&v=0GGt-zGdfeg&t=85.9&theme=cl';
console.log(`TV: https://www.youtube.com/tv?${launchData}`);
logCookies();
r.get(`https://www.youtube.com/tv?${launchData}`, (err, res, body) => {
  if (err) {
    throw err;
  }
  console.log('https://www.youtube.com/api/lounge/pairing/generate_screen_id');
  logCookies();
  r.get('https://www.youtube.com/api/lounge/pairing/generate_screen_id', (err2, res2, screenId) => {
    if (err2) {
      throw err2;
    }
    console.log(`Screen ID: [${screenId}]`);
    console.log('https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch');
    logCookies();
    r.post('https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch', {
      form: {
        screen_ids: screenId,
      },
    }, (err3, res3, screens) => {
      if (err3) {
        throw err3;
      }
      const s = JSON.parse(screens);
      const loungeToken = s.screens[0].loungeToken;
      console.log(`Lounge Token: [${loungeToken}]`);
      //const url = `https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=${uuid.v4()}&name=YouTube%20TV&loungeIdToken=${loungeToken}&RID=${rid()}&zx=${zx()}&v=2&CVER=1&mdx-version=2&t=1&VER=8&app=lb-v4&theme=cl&capabilities`;
      //const url = `https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=${uuid.v4()}&name=YouTube%20TV&loungeIdToken=${loungeToken}&RID=${rid()}&zx=${zx()}&VER=8&theme=cl`;
      const url = `https://www.youtube.com/api/lounge/bc/bind?${querystring.stringify({
        id: uuid.v4(),
        name: 'Youtube TV',
        loungeToken: loungeToken,
        RID: rid(),
        zx: zx(),
        v: 2,
        CVER: 1,
        'mdx-version': 2,
        t: 1,
      })}&capabilities`;
      console.log(`Session URL: [${url}]`);
      logCookies();
      r.post(url, {
        form: {
          count: 0,
        },
      }, (err4, res4, data) => {
        if (err4) {
          throw err4;
        }
        logCookies();
        console.log(data);
        process.exit(1);
      });
    });
  });
});
