// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
var path = require('path');
var fs = require('fs');
var cm = require('../../../common');
var Q = require('q');
var releaseCommon = require('../lib/common');
var jenkinsapim = require('../api/jenkinsapi');
var shell = require('shelljs');
var zip = require('adm-zip');
var JenkinsArtifact = (function () {
    function JenkinsArtifact() {
    }
    JenkinsArtifact.prototype.download = function (context, artifactDefinition, artifactFolder) {
        var defer = Q.defer();
        try {
            var jenkinsDetails = JSON.parse(artifactDefinition.details, releaseCommon.reviver);
            var jenkinsEndpoint;
            context.jobInfo.jobMessage.environment.endpoints.some(function (endpoint) {
                if (endpoint.name === jenkinsDetails.connectionName) {
                    jenkinsEndpoint = endpoint;
                    return true;
                }
            });
            if (jenkinsEndpoint === null) {
                defer.reject('Cannot find required information in the job to download the Jenkins artifact: ' + jenkinsDetails.connectionName);
                return;
            }
            context.info('Created artifact folder: ' + artifactFolder);
            var zipSource = path.join(artifactFolder, 'download.zip');
            var fileStream = fs.createWriteStream(zipSource);
            var creds = {};
            creds.username = this.getAuthParameter(jenkinsEndpoint, 'Username');
            creds.password = this.getAuthParameter(jenkinsEndpoint, 'Password');
            var jenkinsApi = new jenkinsapim.JenkinsApi(jenkinsEndpoint.url, [cm.basicHandlerFromCreds(creds)]);
            jenkinsApi.getArtifactContentZip(jenkinsDetails.jobName, artifactDefinition.version.toString(), jenkinsDetails.relativePath, function (err, statusCode, res) {
                if (err) {
                    context.info('Error downloading artifact: ' + artifactDefinition.name);
                    defer.reject(err);
                    return;
                }
                else if (statusCode > 299) {
                    defer.reject("Failed Request: " + statusCode);
                    return;
                }
                res.pipe(fileStream);
                fileStream.on('finish', function () {
                    cm.extractFile(zipSource, artifactFolder, function (err) {
                        if (err) {
                            context.info('Error extracting artifact: ' + artifactDefinition.name);
                            defer.reject(err);
                            return;
                        }
                        shell.mv('-f', path.join(path.join(artifactFolder, 'archive'), '*'), artifactFolder);
                        var errorMessage = shell.error();
                        if (errorMessage) {
                            fileStream.end();
                            defer.reject(errorMessage);
                            return;
                        }
                        shell.rm('-rf', zipSource, path.join(artifactFolder, 'archive'));
                        errorMessage = shell.error();
                        if (errorMessage) {
                            fileStream.end();
                            defer.reject(errorMessage);
                            return;
                        }
                        fileStream.end();
                        defer.resolve(null);
                        return;
                    });
                });
            });
        }
        catch (error) {
            context.info('There was problem in downloading the artifact: ' + artifactDefinition.name);
            defer.reject(error);
            return;
        }
        return defer.promise;
    };
    JenkinsArtifact.prototype.getAuthParameter = function (endpoint, paramName) {
        var paramValue = null;
        if (endpoint && endpoint.authorization && endpoint.authorization['parameters']) {
            var parameters = Object.getOwnPropertyNames(endpoint.authorization['parameters']);
            var keyName;
            parameters.some(function (key) {
                if (key.toLowerCase() === paramName.toLowerCase()) {
                    keyName = key;
                    return true;
                }
            });
            paramValue = endpoint.authorization['parameters'][keyName];
        }
        return paramValue;
    };
    return JenkinsArtifact;
})();
exports.JenkinsArtifact = JenkinsArtifact;
