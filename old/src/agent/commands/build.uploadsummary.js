/// <reference path="../definitions/vso-node-api.d.ts" />
var ctxm = require('../context');
var Q = require('q');
var path = require('path');
var fs = require('fs');
function createAsyncCommand(executionContext, command) {
    return new UploadSummaryCommand(executionContext, command);
}
exports.createAsyncCommand = createAsyncCommand;
var UploadSummaryCommand = (function () {
    function UploadSummaryCommand(executionContext, command) {
        this.command = command;
        this.executionContext = executionContext;
        this.description = "Upload a build summary document";
    }
    UploadSummaryCommand.prototype.runCommandAsync = function () {
        var _this = this;
        var filename = this.command.message;
        if (!filename) {
            return Q(null);
        }
        var deferred = Q.defer();
        fs.exists(filename, function (exists) {
            if (!exists) {
                deferred.resolve(null);
            }
            var projectId = _this.executionContext.variables[ctxm.WellKnownVariables.projectId];
            var buildId = parseInt(_this.executionContext.variables[ctxm.WellKnownVariables.buildId]);
            var type = "DistributedTask.Core.Summary";
            var name = "CustomMarkDownSummary-" + path.basename(filename);
            var webapi = _this.executionContext.getWebApi();
            var taskClient = webapi.getQTaskApi();
            fs.stat(filename, function (err, stats) {
                if (err) {
                    deferred.reject(err);
                }
                else {
                    var headers = {};
                    headers["Content-Length"] = stats.size;
                    var stream = fs.createReadStream(filename);
                    taskClient.createAttachment(headers, stream, projectId, "Build", _this.executionContext.jobInfo.planId, _this.executionContext.jobInfo.timelineId, _this.executionContext.recordId, type, name).then(function () { return deferred.resolve(null); }, function (err) { return deferred.reject(err); });
                }
            });
        });
        return deferred.promise;
    };
    return UploadSummaryCommand;
})();
exports.UploadSummaryCommand = UploadSummaryCommand;
