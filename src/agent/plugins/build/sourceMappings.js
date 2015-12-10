/// <reference path="../../definitions/shelljs.d.ts"/>
/// <reference path="../../definitions/Q.d.ts" />
var Q = require('q');
var shell = require('shelljs');
var cm = require('../../common');
var utilm = require('../../utilities');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var tm = require('../../tracing');
var trace;
function ensureTrace(writer) {
    if (!trace) {
        trace = new tm.Tracing(__filename, writer);
    }
}
var SourceMappings = (function () {
    function SourceMappings(workPath, writer) {
        ensureTrace(writer);
        trace.enter('SourceMappings()');
        this.workPath = workPath;
        this.sourceMappingRootPath = path.join(this.workPath, "SourceRootMapping");
        trace.state('sourceMappingRootPath', this.sourceMappingRootPath);
        this.sourceTrackingPath = path.join(this.sourceMappingRootPath, "Mappings.json");
        trace.state('sourceTrackingPath', this.sourceTrackingPath);
    }
    SourceMappings.prototype.getSourceTracking = function () {
        var newTrk = {
            lastBuildFolderNumber: 1,
            lastBuildFolderCreatedOn: new Date().toISOString()
        };
        shell.mkdir('-p', this.sourceMappingRootPath);
        return utilm.getOrCreateObjectFromFile(this.sourceTrackingPath, newTrk).then(function (result) {
            return result.result;
        });
    };
    SourceMappings.prototype.incrementSourceTracking = function () {
        var _this = this;
        var ret = null;
        return utilm.objectFromFile(this.sourceTrackingPath)
            .then(function (trk) {
            ++trk.lastBuildFolderNumber;
            trk.lastBuildFolderCreatedOn = new Date().toISOString();
            ret = trk;
            utilm.objectToFile(_this.sourceTrackingPath, trk);
        })
            .then(function () {
            return ret;
        });
    };
    SourceMappings.prototype.getSourceMapping = function (hashKey, job, endpoint) {
        var _this = this;
        trace.enter('getSourceMapping');
        var defer = Q.defer();
        var expectedMap = {};
        var variables = job.environment.variables;
        expectedMap.system = variables[cm.vars.system];
        expectedMap.collectionId = variables[cm.vars.systemCollectionId];
        expectedMap.definitionId = variables[cm.vars.systemDefinitionId];
        expectedMap.repositoryUrl = endpoint.url;
        expectedMap.lastRunOn = new Date().toISOString();
        //
        // Use old source enlistments if they already exist.  Let's not force a reclone on agent update
        // New workspaces get a shorter path
        //
        var hashInput = expectedMap.collectionId + ':' + expectedMap.definitionId + ':' + endpoint.url;
        var hashProvider = crypto.createHash("sha256");
        hashProvider.update(hashInput, 'utf8');
        var hash = hashProvider.digest('hex');
        var legacyDir = path.join('build', hash);
        trace.state('legacyDir', legacyDir);
        fs.exists(legacyDir, function (exists) {
            if (exists && _this.supportsLegacyPaths) {
                trace.write('legacy exists');
                expectedMap.hashKey = hash;
                expectedMap.agent_builddirectory = legacyDir;
                expectedMap.build_sourcesdirectory = path.join(legacyDir, 'repo');
                expectedMap.build_artifactstagingdirectory = path.join(legacyDir, 'artifacts');
                expectedMap.common_testresultsdirectory = path.join(legacyDir, 'TestResults');
                // not setting other informational fields since legacy is not persisted
                trace.state('map', expectedMap);
                defer.resolve(expectedMap);
            }
            else {
                // non-legacy path
                // TODO: set info fields
                trace.write('using source tracking');
                _this.getSourceTracking()
                    .then(function (trk) {
                    trace.state('hashKey', hashKey);
                    expectedMap.hashKey = hashKey;
                    return _this.processSourceMapping(expectedMap, trk);
                })
                    .then(function (resultMap) {
                    trace.state('resultMap', resultMap);
                    defer.resolve(resultMap);
                })
                    .fail(function (err) {
                    trace.error(err.message);
                    defer.reject(new Error('Failed creating source map: ' + err.message));
                });
            }
        });
        return defer.promise;
    };
    SourceMappings.prototype.processSourceMapping = function (expectedMap, trk) {
        var _this = this;
        var resultMap;
        var srcMapPath = path.join(this.sourceMappingRootPath, expectedMap.collectionId, expectedMap.definitionId);
        trace.state('srcMapPath', srcMapPath);
        shell.mkdir('-p', srcMapPath);
        srcMapPath = path.join(srcMapPath, 'SourceFolder.json');
        trace.state('srcMapPath', srcMapPath);
        trace.write('updating expected map');
        this.updateSourceMappingPaths(expectedMap, trk);
        return utilm.getOrCreateObjectFromFile(srcMapPath, expectedMap)
            .then(function (result) {
            var currMap = result.result;
            trace.state('curr.hashKey', currMap.hashKey);
            trace.state('expected.hashKey', expectedMap.hashKey);
            if (result.created || currMap.hashKey !== expectedMap.hashKey) {
                trace.write('creating new source folder');
                return _this.createNewSourceFolder(currMap);
            }
            else {
                trace.write('using current map');
                return currMap;
            }
        })
            .then(function (map) {
            resultMap = map;
            trace.write('writing map');
            trace.state('map', resultMap);
            return utilm.objectToFile(srcMapPath, resultMap);
        })
            .then(function () {
            trace.write('done: ' + srcMapPath);
            return resultMap;
        });
    };
    SourceMappings.prototype.createNewSourceFolder = function (map) {
        var _this = this;
        return this.incrementSourceTracking()
            .then(function (trk) {
            _this.updateSourceMappingPaths(map, trk);
            trace.write('ensuring paths exist');
            shell.mkdir('-p', map.agent_builddirectory);
            shell.mkdir('-p', map.build_artifactstagingdirectory);
            shell.mkdir('-p', map.common_testresultsdirectory);
            // build_sourcesdirectory: 
            // we are not creating because SCM provider will create (clone etc...)
            trace.write('folders created');
            return map;
        });
    };
    SourceMappings.prototype.updateSourceMappingPaths = function (map, trk) {
        trace.enter('updateSourceMappingPaths');
        var rootPath = trk.lastBuildFolderNumber + '';
        map.agent_builddirectory = rootPath;
        map.build_sourcesdirectory = path.join(rootPath, 's');
        map.build_artifactstagingdirectory = path.join(rootPath, 'a');
        map.common_testresultsdirectory = path.join(rootPath, 'TestResults');
        trace.state('map', map);
    };
    return SourceMappings;
})();
exports.SourceMappings = SourceMappings;
