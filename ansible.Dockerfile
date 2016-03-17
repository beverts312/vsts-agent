FROM beverts312/vsts-agent

RUN  apk add --update python &&\
     pip install ansible