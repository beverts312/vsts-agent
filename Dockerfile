FROM ubuntu:14.04

RUN apt-get update &&\
    apt-get install nodejs npm -y &&\
    apt-get install nodejs-legacy -y
  
ADD /vso-agent /vso-agent

RUN cd /vso-agent &&\
    npm install

CMD node /vso-agent/agent