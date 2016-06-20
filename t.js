const querystring = require('querystring');
const JSON5 = require('json5');
let raw1 = Buffer.from(`17
[[6,["noop"]
]
]
557
[[7,["setPlaylist",{"listId":"RQAGdO5p-OeFC4UfUQXf9nqiiDNQdG_Drpd3doH9xojONKV1F7unMWr2evsEBw5fUy3mz1HhWUpXT5","currentTime":"0","ctt":"APmki7R1rDByemh2UY0G7GOK3kLGpwyPGHiZ56TeVKFJtYkeXAUTFvsmQjmp_bUn06BQ10S7fHxpWpm1xd-6QEKjUttW71lK_r4_Q39W9smSBwTMKnQHZJw","eventDetails":"{\\"eventType\\":\\"PLAYLIST_SET\\",\\"userAvatarUri\\":\\"https://yt3.ggpht.com/-B1R68XDOw4g/AAAAAAAAAAI/AAAAAAAAAAA/jrcnT3dzPos/s240-c-k-no-rj-c0xffffff/photo.jpg\\",\\"user\\":\\"Pedro\\",\\"videoIds\\":[\\"nLRQvK2-iqQ\\"]}","videoId":"nLRQvK2-iqQ","videoIds":"nLRQvK2-iqQ","currentIndex":"0"}]]
]
1003
[[8,["remoteConnected",{"app":"ytios-phone-11.21.8","pairingType":"dial","capabilities":"atp,que,mus","ui":"true","clientName":"ios","experiments":"","name":"UM","id":"9D286730-B2BF-4F68-AA27-86494C706789","type":"REMOTE_CONTROL","device":"{\\"app\\":\\"ytios-phone-11.21.8\\",\\"pairingType\\":\\"dial\\",\\"capabilities\\":\\"atp,que,mus\\",\\"clientName\\":\\"ios\\",\\"experiments\\":\\"\\",\\"name\\":\\"UM\\",\\"id\\":\\"9D286730-B2BF-4F68-AA27-86494C706789\\",\\"type\\":\\"REMOTE_CONTROL\\"}"}]]
,[9,["loungeStatus",{"devices":"[{\\"app\\":\\"lb-v4\\",\\"capabilities\\":\\"que,mus\\",\\"clientName\\":\\"tvhtml5\\",\\"experiments\\":\\"\\",\\"name\\":\\"YouTube TV\\",\\"id\\":\\"53e2befe-9b4b-404c-8259-0d7fbefac194\\",\\"userAvatarUri\\":\\"\\",\\"type\\":\\"LOUNGE_SCREEN\\",\\"user\\":\\"\\",\\"hasCc\\":\\"true\\"},{\\"app\\":\\"ytios-phone-11.21.8\\",\\"pairingType\\":\\"dial\\",\\"capabilities\\":\\"atp,que,mus\\",\\"clientName\\":\\"ios\\",\\"experiments\\":\\"\\",\\"name\\":\\"UM\\",\\"id\\":\\"9D286730-B2BF-4F68-AA27-86494C706789\\",\\"type\\":\\"REMOTE_CONTROL\\"}]","token":""}]]
]
`);

let raw = Buffer.from(`147
[[0,["c","34A4E2DD35604E4B","",8]
]
,[1,["S","DE22FUt8ORHbSsQQZ1q_kw"]]
,[2,["loungeStatus",{"devices":"[]","token":""}]]
,[3,["getNowPlaying"]]
]
`);



let messages = [];
while (raw.length) {
  let lineEnd = raw.indexOf('\n');
  let dataSize = +raw.toString('ascii', 0, lineEnd);
  raw = raw.slice(lineEnd + 1, raw.length);
  let data = raw.slice(0, dataSize)
    .toString();
  let parsedData = null;
  try {
    parsedData = JSON.parse(data, (k, v) => {
      if (typeof v === 'string' && v.indexOf('\"') !== -1) {
        return JSON.parse(v);
      }
      return v;
    });
    for (const m of parsedData) {
      messages.push({
        index: m[0],
        command: m[1][0],
        args: m[1][1],
      });
    }
  } catch (e) {
    console.log(e.message);
  }
  raw = raw.slice(dataSize, raw.length);
}

console.log(querystring.stringify({
  id: 'id',
  c: 1
}));

process.exit();
