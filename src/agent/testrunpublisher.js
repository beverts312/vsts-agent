var utilities = require('./utilities');
var async = require('async');
var fs = require('fs');
var path = require("path");
var xmlreader = require('xmlreader');
var Q = require('q');
var TestRunPublisher = (function () {
    //-----------------------------------------------------
    // Constructs a TestRunPublisher instance 
    // - service: cm.IFeedbackChannel - for routing the server calls to real or loopback 
    // - command: cm.ITaskCommand - used for logging warnings, errors  
    // - teamProject: string - since test publishing is scoped to team projects 
    // - runContext: TestRunContext - for identifying context(buildId, platform, config, etc), which is needed while publishing
    // - reader: IResultReader - for reading different(junit, nunit) result files 
    //-----------------------------------------------------
    function TestRunPublisher(service, command, teamProject, runContext, reader) {
        this.service = service;
        this.command = command;
        this.runContext = runContext;
        this.reader = reader;
        this.service.initializeTestManagement(teamProject);
    }
    //-----------------------------------------------------
    // Read results from a file. Each file will be published as a separate test run
    // - file: string () - location of the results file 
    //-----------------------------------------------------    
    TestRunPublisher.prototype.readResults = function (file) {
        var defer = Q.defer();
        var testRun;
        this.reader.readResults(file, this.runContext).then(function (testRun) {
            defer.resolve(testRun);
        }).fail(function (err) {
            defer.reject(err);
        });
        return defer.promise;
    };
    //-----------------------------------------------------
    // Start a test run - create a test run entity on the server, and marks it in progress
    // - testRun: TestRun - test run to be published  
    // - resultsFilePath - needed for uploading the run level attachment 
    //-----------------------------------------------------
    TestRunPublisher.prototype.startTestRun = function (testRun, resultFilePath) {
        var defer = Q.defer();
        var _this = this;
        _this.service.createTestRun(testRun).then(function (createdTestRun) {
            utilities.readFileContents(resultFilePath, "ascii").then(function (res) {
                var contents = new Buffer(res).toString('base64');
                _this.service.createTestRunAttachment(createdTestRun.id, path.basename(resultFilePath), contents).then(function (attachment) {
                    defer.resolve(createdTestRun);
                }, function (err) {
                    // We can skip attachment publishing if it fails to upload
                    if (_this.command) {
                        _this.command.warning("Skipping attachment : " + resultFilePath + ". " + err.statusCode + " - " + err.message);
                    }
                    defer.resolve(createdTestRun);
                });
            }, function (err) {
                defer.reject(err);
            });
        }, function (err) {
            defer.reject(err);
        });
        return defer.promise;
    };
    //-----------------------------------------------------
    // Stop a test run - mark it completed
    // - testRun: TestRun - test run to be published  
    //-----------------------------------------------------
    TestRunPublisher.prototype.endTestRun = function (testRunId) {
        var defer = Q.defer();
        this.service.endTestRun(testRunId).then(function (endedTestRun) {
            defer.resolve(endedTestRun);
        }, function (err) {
            defer.reject(err);
        });
        return defer.promise;
    };
    //-----------------------------------------------------
    // Add results to an inprogress test run 
    // - testrunID: number - runId against which results are to be published 
    // - testRunResults: TestRunResult[] - testresults to be published  
    //-----------------------------------------------------
    TestRunPublisher.prototype.addResults = function (testRunId, testResults) {
        var defer = Q.defer();
        var _this = this;
        var i = 0;
        var batchSize = 100;
        var returnedResults;
        async.whilst(function () {
            return i < testResults.length;
        }, function (callback) {
            var noOfResultsToBePublished = batchSize;
            if (i + batchSize >= testResults.length) {
                noOfResultsToBePublished = testResults.length - i;
            }
            var currentBatch = testResults.slice(i, i + noOfResultsToBePublished);
            i = i + batchSize;
            var _callback = callback;
            _this.service.createTestRunResult(testRunId, currentBatch).then(function (createdTestResults) {
                returnedResults = createdTestResults;
                setTimeout(_callback, 10);
            }, function (err) {
                defer.reject(err);
            });
        }, function (err) {
            defer.resolve(returnedResults);
        });
        return defer.promise;
    };
    //-----------------------------------------------------
    // Publish a test run
    // - resultFilePath: string - Path to the results file
    //-----------------------------------------------------
    TestRunPublisher.prototype.publishTestRun = function (resultFilePath) {
        var defer = Q.defer();
        var _this = this;
        var testRunId;
        var results;
        _this.readResults(resultFilePath).then(function (res) {
            results = res.testResults;
            return _this.startTestRun(res.testRun, resultFilePath);
        }).then(function (res) {
            testRunId = res.id;
            return _this.addResults(testRunId, results);
        }).then(function (res) {
            return _this.endTestRun(testRunId);
        }).then(function (res) {
            defer.resolve(res);
        }).fail(function (err) {
            defer.reject(err);
        });
        return defer.promise;
    };
    return TestRunPublisher;
})();
exports.TestRunPublisher = TestRunPublisher;
;
