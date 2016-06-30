FROM beverts312/vsts-agent

ENV SONAR_SCANNER_VERSION 2.6.1
ENV PATH /sonar-scanner-$SONAR_SCANNER_VERSION/bin:$PATH

ADD https://sonarsource.bintray.com/Distribution/sonar-scanner-cli/sonar-scanner-$SONAR_SCANNER_VERSION.zip sonar-scanner.zip

RUN  apk --update add openjdk8-jre &&\
     unzip sonar-scanner.zip &&\
     rm -r sonar-scanner.zip &&\
     chmod +x /sonar-scanner-$SONAR_SCANNER_VERSION/bin/sonar-scanner &&\
     chmod +x /sonar-scanner-$SONAR_SCANNER_VERSION/bin/sonar-runner
