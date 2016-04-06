FROM beverts312/vsts-agent

ENV COUCHBASE_VERSION 4.0.0
ENV PATH /couchbase-cli-$COUCHBASE_VERSION:$PATH

ADD https://github.com/couchbase/couchbase-cli/archive/$COUCHBASE_VERSION.zip couchbase-cli.zip

RUN  apk add --update python python-dev py-pip py-crypto openssh &&\
     pip install ansible boto httplib2 dnspython &&\
     unzip couchbase-cli.zip &&\
     rm -r couchbase-cli.zip     