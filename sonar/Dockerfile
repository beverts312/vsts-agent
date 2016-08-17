FROM beverts312/vsts-agent

ENV SONAR_SCANNER_VERSION 2.6.1
ENV PATH /sonar-scanner-$SONAR_SCANNER_VERSION/bin:$PATH

WORKDIR /

USER root

ADD https://sonarsource.bintray.com/Distribution/sonar-scanner-cli/sonar-scanner-$SONAR_SCANNER_VERSION.zip sonar-scanner.zip

RUN  apt-get install -y zip &&\
     add-apt-repository ppa:openjdk-r/ppa -y &&\
     apt-get -y update &&\
     apt-get install -y openjdk-8-jdk &&\
     unzip sonar-scanner.zip &&\
     rm -r sonar-scanner.zip &&\
     chmod +x /sonar-scanner-$SONAR_SCANNER_VERSION/bin/sonar-scanner &&\
     chmod +x /sonar-scanner-$SONAR_SCANNER_VERSION/bin/sonar-runner &&\
     chown agent /sonar-scanner-$SONAR_SCANNER_VERSION/bin/

USER agent
WORKDIR myagent
