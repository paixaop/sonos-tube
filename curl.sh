#!/bin/bash
USERAGENT="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/601.6.17 (KHTML, like Gecko) Version/9.1.1 Safari/601.6.17"
CURL="/usr/local/bin/curl --http2 --cookie-jar cookies.txt --silent -A \"User-Agent: $USERAGENT\" "

$CURL 'https://www.youtube.com/tv?pairingCode=4b257d6d-3097-4cd1-945d-afac683b4cd4&theme=cl'
SCREEN_ID=$($CURL 'https://www.youtube.com/api/lounge/pairing/generate_screen_id')

echo "Screen ID: [$SCREEN_ID]"

LOUNGE_TOKEN=$($CURL --data screen_ids=$SCREEN_ID 'https://www.youtube.com/api/lounge/pairing/get_lounge_token_batch' | python -c 'import json,sys;obj=json.load(sys.stdin);print obj["screens"][0]["loungeToken"]')
echo "Lounge Token: [$LOUNGE_TOKEN]"

UUID="afb4b6b5-2a3e-4b46-a97a-9f4bae8d736c";

function uuid {
  part1=`LC_CTYPE=C tr -dc A-Fa-f0-9 < /dev/urandom | fold -w ${1:-8} | head -n 1 | awk '{print tolower($0)}'`
  part2=`LC_CTYPE=C tr -dc A-Fa-f0-9 < /dev/urandom | fold -w ${1:-4} | head -n 1 | awk '{print tolower($0)}'`
  part3=`LC_CTYPE=C tr -dc A-Fa-f0-9 < /dev/urandom | fold -w ${1:-4} | head -n 1 | awk '{print tolower($0)}'`
  part4=`LC_CTYPE=C tr -dc A-Fa-f0-9 < /dev/urandom | fold -w ${1:-4} | head -n 1 | awk '{print tolower($0)}'`
  part5=`LC_CTYPE=C tr -dc A-Fa-f0-9 < /dev/urandom | fold -w ${1:-12} | head -n 1 | awk '{print tolower($0)}'`
  echo $part1-$part2-$part3-$part4-$part5
}

function zx {
  echo `LC_CTYPE=C tr -dc A-Fa-f0-9 < /dev/urandom | fold -w ${1:-12} | head -n 1 | awk '{print tolower($0)}'`
}

function rid {
  echo `LC_CTYPE=C tr -dc 0-9 < /dev/urandom | fold -w ${1:-5} | head -n 1`
}

UUID=$(uuid)

URL="https://www.youtube.com/api/lounge/bc/bind?device=LOUNGE_SCREEN&id=$UUID&name=YouTube%20TV&app=lb-v4&theme=cl&capabilities&mdx-version=2&loungeIdToken=$LOUNGE_TOKEN&VER=8&v=2&RID=$(rid)&CVER=1&zx=$(zx)&t=1"

OUTPUT=$($CURL --data count=0 $URL)
echo $OUTPUT