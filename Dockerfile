FROM beverts312/node

RUN npm install vsoagent-installer -g

ADD /src /vso-agent

CMD node /vso-agent/agent/vsoagent