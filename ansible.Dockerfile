FROM beverts312/vsts-agent

RUN  apk add --update python python-dev py-pip &&\
     pip install ansible boto