#!/bin/bash -x
if [[ -z $VSTS_URL ]] ; then
   echo "Must set VSTS_URL as env variable"
   exit 1
elif [[ -z $VSTS_TOKEN ]] ; then
   echo "Must set VSTS_TOKEN as env variable"
   exit 1
elif [[ -z $VSTS_POOL ]] ; then
   echo "Must set VSTS_POOL as env variable"
   exit 1
fi

./config.sh --url "$VSTS_URL" \
            --pool "$VSTS_POOL" \
            --replace \
            --auth PAT \
            --token "$VSTS_TOKEN"

./run.sh
