var trp = require('../testrunpublisher');
var trr = require('../testresultreader');
var Q = require('q');
//-----------------------------------------------------
// Publishes results from a specified file to TFS server 
// - CMD_PREFIX + "results.publish type=junit]" + testResultsFile
//-----------------------------------------------------
function createAsyncCommand(executionContext, command) {
    return new ResultsPublishCommand(executionContext, command);
}
exports.createAsyncCommand = createAsyncCommand;
var ResultsPublishCommand = (function () {
    function ResultsPublishCommand(executionContext, command) {
        this.command = command;
        this.executionContext = executionContext;
        this.description = "Results.Publish async Command";
    }
    ResultsPublishCommand.prototype.runCommandAsync = function () {
        var _this = this;
        var defer = Q.defer();
        var teamProject = this.executionContext.variables["system.teamProject"];
        var resultFilePath = this.command.message;
        var resultType = this.command.properties['type'];
        if (resultType) {
            resultType = resultType.toLowerCase();
        }
        var platform = this.command.properties['platform'];
        var config = this.command.properties['config'];
        var command = this.command;
        var testRunContext = {
            requestedFor: this.executionContext.variables["build.requestedFor"],
            buildId: this.executionContext.variables["build.buildId"],
            platform: platform,
            config: config
        };
        var reader;
        if (resultType == "junit") {
            reader = new trr.JUnitResultReader();
        }
        else if (resultType == "nunit") {
            reader = new trr.NUnitResultReader();
        }
        else if (resultType == "xunit") {
            reader = new trr.XUnitResultReader();
        }
        else {
            this.command.warning("Test results of format '" + resultType + "'' are not supported by the VSO/TFS OSX and Linux build agent");
        }
        if (reader != null) {
            var testRunPublisher = new trp.TestRunPublisher(this.executionContext.service, command, teamProject, testRunContext, reader);
            testRunPublisher.publishTestRun(resultFilePath).then(function (createdTestRun) {
                defer.resolve(null);
            })
                .fail(function (err) {
                _this.command.warning("Failed to publish test results: " + err.message);
                defer.resolve(null);
            });
        }
        else {
            defer.resolve(null);
        }
        return defer.promise;
    };
    return ResultsPublishCommand;
})();
exports.ResultsPublishCommand = ResultsPublishCommand;
