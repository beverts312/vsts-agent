FROM ubuntu:14.04

RUN apt-get update &&\
    apt-get install nodejs npm -y &&\
    apt-get install nodejs-legacy -y &&\
    npm install vsoagent-installer -g

ADD /src /vso-agent

CMD node /vso-agent/agent/vsoagent