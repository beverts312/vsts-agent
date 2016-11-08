FROM beverts312/vsts-agent

ARG COUCHBASE_VERSION=4.0.0

ENV PATH /couchbase-cli-$COUCHBASE_VERSION:$PATH

USER root

ADD https://github.com/couchbase/couchbase-cli/archive/$COUCHBASE_VERSION.zip couchbase-cli.zip

RUN  apt-get install -y python python-dev python-pip sshpass libffi-dev libssl-dev zip &&\
     curl https://sdk.cloud.google.com | bash &&\
     npm install -g azure-cli &&\     
     pip install ansible boto httplib2 dnspython awscli &&\
     unzip couchbase-cli.zip &&\
     rm -r couchbase-cli.zip

USER agent
