/*
* ---------------------------------------------------------
* Copyright(C) Microsoft Corporation. All rights reserved.
* ---------------------------------------------------------
*/
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
// Licensed under the MIT license.  See LICENSE file in the project root for full license information.
var basem = require('vso-node-api/ClientApiBases');
var JenkinsApi = (function (_super) {
    __extends(JenkinsApi, _super);
    function JenkinsApi(baseUrl, handlers) {
        _super.call(this, baseUrl, handlers, 'node-jenkins-api');
    }
    /**
     * Gets the artifact as a zip
     *
     * @param {string} jobName - Job name of the artifact
     * @param {string} job - Job to be downloaded
     * @param {string} relativePath - Relative path inside the artifact
     * @param onResult callback function with the resulting void
     */
    JenkinsApi.prototype.getArtifactContentZip = function (jobName, job, relativePath, onResult) {
        var requestUrl = this.baseUrl + '/job/' + jobName + '/' + job + '/artifact/' + relativePath + '/*zip*/';
        this.httpClient.getStream(requestUrl, null, "application/zip", onResult);
    };
    return JenkinsApi;
})(basem.ClientApiBase);
exports.JenkinsApi = JenkinsApi;
