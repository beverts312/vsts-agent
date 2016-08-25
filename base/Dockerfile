FROM ubuntu:14.04

RUN apt-get update -y &&\
    apt-get install -y software-properties-common &&\
    apt-add-repository ppa:git-core/ppa &&\
    apt-get update -y &&\
    apt-get install -y libunwind8 libcurl3 libicu52 curl nodejs git &&\
    curl -sL https://deb.nodesource.com/setup_6.x | bash &&\
    curl -fsSL https://experimental.docker.com/ | sh &&\
    apt-get install -y nodejs &&\
    mkdir myagent

ARG AGENT_VERSION=2.105.2

ADD https://github.com/Microsoft/vsts-agent/releases/download/v${AGENT_VERSION}/vsts-agent-ubuntu.14.04-x64-${AGENT_VERSION}.tar.gz agent.tar.gz
ADD init.sh /myagent/init.sh

WORKDIR myagent

RUN tar xzf /agent.tar.gz &&\
    useradd -ms /bin/bash agent &&\
    usermod -aG docker agent &&\
    chown agent /myagent &&\
    chmod +x init.sh &&\
    rm /agent.tar.gz
USER agent
CMD ./init.sh
