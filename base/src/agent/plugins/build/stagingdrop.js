// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/shelljs.d.ts" />
var path = require('path');
var fs = require('fs');
var Q = require("q");
var shelljs = require("shelljs");
var ctxm = require('../../context');
var util = require('../../utilities');
var webapim = require("vso-node-api/WebApi");
var tm = require('../../tracing');
var dropm = require('./lib/dropUploader');
var stagingOptionId = "82f9a3e8-3930-482e-ac62-ae3276f284d5";
var dropOptionId = "e8b30f6f-039d-4d34-969c-449bbe9c3b9e";
var _trace;
function _ensureTracing(ctx, area) {
    _trace = new tm.Tracing(__filename, ctx.traceWriter);
    _trace.enter(area);
}
exports.pluginName = function () {
    return "buildDrop";
};
exports.pluginTitle = function () {
    return "Build Drop";
};
exports.afterJobPlugins = function (executionContext) {
    /**
     * this plugin handles both the "copy to staging folder" and "create drop" build options
     * this way we can ensure that they happen in the correct order
     */
    var afterJobPlugins = [];
    var options = executionContext.jobInfo.jobMessage.environment.options;
    if (options) {
        var stagingOption = options[stagingOptionId];
        if (stagingOption) {
            afterJobPlugins.push(new CopyToStagingFolder(stagingOption));
        }
        var dropOption = options[dropOptionId];
        if (dropOption) {
            afterJobPlugins.push(new CreateDrop(stagingOption, dropOption));
        }
    }
    return afterJobPlugins;
};
var CopyToStagingFolder = (function () {
    function CopyToStagingFolder(stagingOption) {
        this._stagingOption = stagingOption;
    }
    CopyToStagingFolder.prototype.pluginName = function () {
        return "copyToStagingFolder";
    };
    CopyToStagingFolder.prototype.pluginTitle = function () {
        return "Copy to staging folder";
    };
    CopyToStagingFolder.prototype.shouldRun = function (jobSuccess, executionContext) {
        _ensureTracing(executionContext, 'shouldRun');
        _trace.write('shouldRun: ' + jobSuccess);
        return jobSuccess;
    };
    CopyToStagingFolder.prototype.afterJob = function (pluginContext, callback) {
        _ensureTracing(pluginContext, 'afterJob');
        this._copyToStagingFolder(pluginContext)
            .then(function () { return callback(); })
            .fail(function (err) {
            callback(err);
        });
    };
    CopyToStagingFolder.prototype._copyToStagingFolder = function (ctx) {
        // determine root: $(build.sourcesdirectory)
        _ensureTracing(ctx, 'copyToStagingFolder');
        ctx.info("looking for source in " + ctxm.WellKnownVariables.sourceFolder);
        var environment = ctx.jobInfo.jobMessage.environment;
        var sourcesRoot = environment.variables[ctxm.WellKnownVariables.sourceFolder].replaceVars(environment.variables);
        _trace.state('sourcesRoot', sourcesRoot);
        var stagingFolder = getStagingFolder(ctx, this._stagingOption);
        var searchPattern = this._stagingOption.data["pattern"];
        if (searchPattern) {
            // root the search pattern
            searchPattern = searchPattern.replaceVars(environment.variables);
            // fix semicolons
            searchPattern = searchPattern.replace(";;", "\0");
            // promises containing lists of files to copy
            var filesPromises = [];
            var searchPatterns = searchPattern.split(";");
            searchPatterns.forEach(function (pattern, index) {
                pattern = pattern.replace('\0', ';');
                if (!isPathRooted(pattern) && sourcesRoot) {
                    pattern = path.join(sourcesRoot, pattern);
                }
                _trace.state('pattern', pattern);
                // get list of files to copy
                var filesPromise;
                if (pattern.indexOf('*') > -1 || pattern.indexOf('?') > -1) {
                    ctx.info("Wildcard found in pattern parameter.");
                    filesPromise = findMatchingFiles(ctx, null, pattern, false, true);
                }
                else {
                    filesPromise = Q([pattern]);
                }
                filesPromises.push(filesPromise);
            });
            // TODO: staging folder should be created and defined outside of this plugin
            //       so if user opts out of copy pattern, they can still run a script.
            ctx.info("Staging folder: " + stagingFolder);
            var createStagingFolderPromise = util.ensurePathExists(stagingFolder);
            var deferred = Q.defer();
            Q.all([Q.all(filesPromises), createStagingFolderPromise])
                .then(function (results) {
                var filesArrays = results[0];
                var files = Array.prototype.concat.apply([], filesArrays);
                ctx.info("found " + files.length + " files or folders");
                _trace.state('files', files);
                var commonRoot = getCommonLocalPath(files);
                var useCommonRoot = !!commonRoot;
                if (useCommonRoot) {
                    ctx.info("There is a common root (" + commonRoot + ") for the files. Using the remaining path elements in staging folder.");
                }
                try {
                    files.forEach(function (file) {
                        var targetPath = stagingFolder;
                        if (useCommonRoot) {
                            var relativePath = file.substring(commonRoot.length)
                                .replace(/^\\/g, "")
                                .replace(/^\//g, "");
                            targetPath = path.join(stagingFolder, relativePath);
                        }
                        _trace.state('targetPath', targetPath);
                        ctx.info("Copying all files from " + file + " to " + targetPath);
                        shelljs.cp("-Rf", path.join(file, "*"), targetPath);
                    });
                    deferred.resolve(null);
                }
                catch (err) {
                    deferred.reject(err);
                }
            })
                .fail(function (err) {
                deferred.reject(err);
            });
            return deferred.promise;
        }
        else {
            ctx.warning("No pattern specified. Nothing to copy.");
            return Q(null);
        }
    };
    return CopyToStagingFolder;
})();
var CreateDrop = (function () {
    function CreateDrop(stagingOption, dropOption) {
        this._stagingOption = stagingOption;
        this._dropOption = dropOption;
    }
    CreateDrop.prototype.pluginName = function () {
        return "createDrop";
    };
    CreateDrop.prototype.pluginTitle = function () {
        return "Create drop";
    };
    CreateDrop.prototype.shouldRun = function (jobSuccess, ctx) {
        _ensureTracing(ctx, 'shouldRun');
        _trace.write('shouldRun: ' + jobSuccess);
        return jobSuccess;
    };
    CreateDrop.prototype.afterJob = function (pluginContext, callback) {
        _ensureTracing(pluginContext, 'afterJob');
        this._createDrop(pluginContext)
            .then(function () { return callback(); })
            .fail(function (err) {
            callback(err);
        });
    };
    CreateDrop.prototype._createDrop = function (ctx) {
        _ensureTracing(ctx, 'createDrop');
        var location = this._dropOption.data["location"];
        var path = this._dropOption.data["path"];
        var stagingFolder = getStagingFolder(ctx, this._stagingOption);
        var environment = ctx.jobInfo.jobMessage.environment;
        if (location) {
            location = location.replaceVars(environment.variables);
        }
        if (path) {
            path = path.replaceVars(environment.variables);
        }
        ctx.info("drop location = " + location);
        ctx.info("drop path = " + path);
        // determine drop provider
        var artifactType;
        var dropPromise = Q(null);
        switch (location) {
            case "filecontainer":
                artifactType = "container";
                dropPromise = this._copyToFileContainer(ctx, stagingFolder, path);
                break;
            case "uncpath":
                artifactType = "filepath";
                dropPromise = this._copyToUncPath(ctx, stagingFolder, path);
                break;
        }
        return dropPromise.then(function (artifactLocation) {
            if (artifactLocation) {
                var serverUrl = environment.systemConnection.url;
                var accessToken = environment.systemConnection.authorization.parameters['AccessToken'];
                var token = webapim.getBearerHandler(accessToken);
                var buildClient = new webapim.WebApi(serverUrl, webapim.getBearerHandler(accessToken)).getQBuildApi();
                return ctx.service.postArtifact(ctx.variables[ctxm.WellKnownVariables.projectId], parseInt(ctx.variables[ctxm.WellKnownVariables.buildId]), {
                    name: "drop",
                    resource: {
                        data: artifactLocation,
                        type: artifactType
                    }
                });
            }
            else {
                ctx.warning("Drop location/path is missing or not supported. Not creating a build drop artifact.");
                return Q(null);
            }
        });
    };
    CreateDrop.prototype._copyToFileContainer = function (ctx, stagingFolder, fileContainerPath) {
        _ensureTracing(ctx, 'copyToFileContainer');
        var fileContainerRegExp = /^#\/(\d+)(\/.*)$/;
        var containerId;
        var containerPath = "/";
        var match = fileContainerPath.match(fileContainerRegExp);
        if (match) {
            containerId = parseInt(match[1]);
            if (match.length > 2) {
                containerPath = match[2];
            }
        }
        else {
            ctx.error("invalid file container path '" + fileContainerPath + "'");
            return Q(null);
        }
        var containerRoot = containerPath;
        if (containerRoot.charAt(containerPath.length) !== '/') {
            containerRoot += '/';
        }
        if (containerRoot.charAt(0) === '/') {
            containerRoot = containerRoot.substr(1);
        }
        _trace.state('containerRoot', containerRoot);
        var contentMap = {};
        return readDirectory(ctx, stagingFolder, true, false)
            .then(function (files) {
            _trace.state('files', files);
            return dropm.uploadFiles(ctx, stagingFolder, containerId, containerRoot, files);
            /*
            return Q.all(files.map((fullPath: string) => {
                return Q.nfcall(fs.stat, fullPath)
                    .then((stat: fs.Stats) => {
                        _trace.state('fullPath', fullPath);
                        _trace.state('size', stat.size);

                        return ctx.feedback.uploadFileToContainer(containerId, {
                            fullPath: fullPath,
                            containerItem: {
                                containerId: containerId,
                                itemType: ifm.ContainerItemType.File,
                                path: containerRoot + fullPath.substring(stagingFolder.length + 1)
                            },
                            uncompressedLength: stat.size,
                            isGzipped: false
                        });
                    });
            }))
            */
        })
            .then(function () {
            ctx.info("container items uploaded");
            _trace.state('fileContainerPath', fileContainerPath);
            return fileContainerPath;
        });
    };
    CreateDrop.prototype._copyToUncPath = function (ctx, stagingFolder, uncPath) {
        ctx.info("Copying all files from " + stagingFolder + " to " + uncPath);
        shelljs.cp("-Rf", path.join(stagingFolder, "*"), uncPath);
        return Q(uncPath);
    };
    return CreateDrop;
})();
function getStagingFolder(ctx, stagingOption) {
    // determine staging folder: $(build.stagingdirectory)[/{stagingfolder}]
    var environment = ctx.jobInfo.jobMessage.environment;
    ctx.info("looking for staging folder in " + ctxm.WellKnownVariables.stagingFolder);
    var stagingFolder = environment.variables[ctxm.WellKnownVariables.stagingFolder].replaceVars(environment.variables);
    if (stagingOption) {
        var relativeStagingPath = stagingOption.data["stagingfolder"];
        if (relativeStagingPath) {
            stagingFolder = path.join(stagingFolder, relativeStagingPath.replaceVars(environment.variables));
        }
    }
    return stagingFolder;
}
var PagesPerBlock = 32;
var BytesPerPage = 64 * 1024;
var BlockSize = PagesPerBlock * BytesPerPage;
function getCommonLocalPath(files) {
    if (!files || files.length === 0) {
        return "";
    }
    else {
        var root = files[0];
        for (var index = 1; index < files.length; index++) {
            root = _getCommonLocalPath(root, files[index]);
            if (!root) {
                break;
            }
        }
        return root;
    }
}
function _getCommonLocalPath(path1, path2) {
    var path1Depth = getFolderDepth(path1);
    var path2Depth = getFolderDepth(path2);
    var shortPath;
    var longPath;
    if (path1Depth >= path2Depth) {
        shortPath = path2;
        longPath = path1;
    }
    else {
        shortPath = path1;
        longPath = path2;
    }
    while (!isSubItem(longPath, shortPath)) {
        var parentPath = path.dirname(shortPath);
        if (path.normalize(parentPath) === path.normalize(shortPath)) {
            break;
        }
        shortPath = parentPath;
    }
    return shortPath;
}
function isSubItem(item, parent) {
    item = path.normalize(item);
    parent = path.normalize(parent);
    return item.substring(0, parent.length) == parent
        && (item.length == parent.length || (parent.length > 0 && parent[parent.length - 1] === path.sep) || (item[parent.length] === path.sep));
}
function getFolderDepth(fullPath) {
    if (!fullPath) {
        return 0;
    }
    var current = path.normalize(fullPath);
    var parentPath = path.dirname(current);
    var count = 0;
    while (parentPath !== current) {
        ++count;
        current = parentPath;
        parentPath = path.dirname(current);
    }
    return count;
}
function findMatchingFiles(ctx, rootFolder, pattern, includeFiles, includeFolders) {
    pattern = pattern.replace(';;', '\0');
    var patterns = pattern.split(';');
    var includePatterns = [];
    var excludePatterns = [];
    patterns.forEach(function (p, index) {
        p = p.replace('\0', ';');
        var isIncludePattern = true;
        if (p.substring(0, 2) === "+:") {
            p = p.substring(2);
        }
        else if (p.substring(0, 2) === "-:") {
            isIncludePattern = false;
            p = p.substring(2);
        }
        if (!isPathRooted(p) && rootFolder) {
            p = path.join(rootFolder, p);
        }
        if (!isValidPattern(p)) {
            // TODO: report error
            ctx.error("invalid pattern " + p);
        }
        if (isIncludePattern) {
            includePatterns.push(p);
        }
        else {
            excludePatterns.push(convertPatternToRegExp(p));
        }
    });
    return getMatchingItems(ctx, includePatterns, excludePatterns, includeFiles, includeFolders);
}
function getMatchingItems(ctx, includePatterns, excludePatterns, includeFiles, includeFolders) {
    var fileMap = {};
    var funcs = includePatterns.map(function (includePattern, index) {
        return function (files) {
            var pathPrefix = getPathPrefix(includePattern);
            var patternRegex = convertPatternToRegExp(includePattern);
            return readDirectory(ctx, pathPrefix, includeFiles, includeFolders)
                .then(function (paths) {
                paths.forEach(function (path, index) {
                    var normalizedPath = path.replace(/\\/g, '/');
                    var alternatePath = normalizedPath + "//";
                    var isMatch = false;
                    if (patternRegex.test(normalizedPath) || (includeFolders && patternRegex.test(alternatePath))) {
                        isMatch = true;
                        for (var i = 0; i < excludePatterns.length; i++) {
                            var excludePattern = excludePatterns[i];
                            if (excludePattern.test(normalizedPath) || (includeFolders && excludePattern.test(alternatePath))) {
                                isMatch = false;
                                break;
                            }
                        }
                    }
                    if (isMatch && !fileMap[path]) {
                        fileMap[path] = true;
                        files.push(path);
                    }
                });
                return files;
            });
        };
    });
    return funcs.reduce(Q.when, Q([]));
}
function readDirectory(ctx, directory, includeFiles, includeFolders) {
    var results = [];
    var deferred = Q.defer();
    if (includeFolders) {
        results.push(directory);
    }
    Q.nfcall(fs.readdir, directory)
        .then(function (files) {
        var count = files.length;
        if (count > 0) {
            files.forEach(function (file, index) {
                var fullPath = path.join(directory, file);
                Q.nfcall(fs.stat, fullPath)
                    .then(function (stat) {
                    if (stat && stat.isDirectory()) {
                        readDirectory(ctx, fullPath, includeFiles, includeFolders)
                            .then(function (moreFiles) {
                            results = results.concat(moreFiles);
                            if (--count === 0) {
                                deferred.resolve(results);
                            }
                        }, function (error) {
                            ctx.error(error.toString());
                        });
                    }
                    else {
                        if (includeFiles) {
                            results.push(fullPath);
                        }
                        if (--count === 0) {
                            deferred.resolve(results);
                        }
                    }
                });
            });
        }
        else {
            deferred.resolve(results);
        }
    }, function (error) {
        ctx.error(error.toString());
        deferred.reject(error);
    });
    return deferred.promise;
}
function getPathPrefix(pattern) {
    var starIndex = pattern.indexOf('*');
    var questionIndex = pattern.indexOf('?');
    var index;
    if (starIndex > -1 && questionIndex > -1) {
        index = Math.min(starIndex, questionIndex);
    }
    else {
        index = Math.max(starIndex, questionIndex);
    }
    if (index < 0) {
        return path.dirname(pattern);
    }
    else {
        return pattern.substring(0, index);
    }
}
function isPathRooted(filePath) {
    if (filePath.substring(0, 2) === "\\\\") {
        return true;
    }
    else if (filePath.charAt(0) === "/") {
        return true;
    }
    else {
        var regex = /^[a-zA-Z]:/;
        return regex.test(filePath);
    }
}
function isValidPattern(pattern) {
    if (pattern.length > 0 && pattern.charAt(pattern.length - 1) === "\\" || pattern.charAt(pattern.length - 1) === "/") {
        return false;
    }
    else {
        return true;
    }
}
function convertPatternToRegExp(pattern) {
    pattern = pattern.replace(/\\/g, '/')
        .replace(/([.?*+^$[\]\\(){}|-])/g, "$1")
        .replace(/\/\*\*\//g, "((/.+/)|(/))")
        .replace(/\*\*/g, ".*")
        .replace("*", "[^/]*")
        .replace(/\?/g, ".");
    return new RegExp('^' + pattern + '$', "i");
}
