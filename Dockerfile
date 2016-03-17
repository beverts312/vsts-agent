FROM beverts312/node

RUN npm install vsoagent-installer -g &&\
    apk add --update git docker


ADD /src /vso-agent

CMD node /vso-agent/agent/vsoagent
