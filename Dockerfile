FROM ubuntu:14.04

RUN apt-get update &&\
    apt-get install nodejs npm -y &&\
    apt-get install nodejs-legacy -y &&\
    npm install vsoagent-installer -g

RUN curl -L https://github.com/docker/compose/releases/download/1.5.1/docker-compose-`uname -s`-`uname -m` > /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    curl -L https://github.com/docker/machine/releases/download/v0.5.2/docker-machine_linux-amd64.zip >machine.zip && \
    unzip machine.zip && \
    rm machine.zip && \
    mv -f docker-machine* /usr/local/bin

ADD /src /vso-agent

CMD node /vso-agent/agent/vsoagent