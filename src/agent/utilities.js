// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
/// <reference path="./definitions/Q.d.ts" />
var Q = require('q');
var fs = require('fs');
var shell = require('shelljs');
var path = require('path');
// TODO: offer these module level context-less helper functions in utilities below
function ensurePathExists(path) {
    var defer = Q.defer();
    if (fs.exists(path, function (exists) {
        if (!exists) {
            shell.mkdir('-p', path);
            var errMsg = shell.error();
            if (errMsg) {
                defer.reject(new Error('Could not create path (' + path + '): ' + errMsg));
            }
            else {
                defer.resolve(null);
            }
        }
        else {
            defer.resolve(null);
        }
    }))
        ;
    return defer.promise;
}
exports.ensurePathExists = ensurePathExists;
function readFileContents(filePath, encoding) {
    var defer = Q.defer();
    fs.readFile(filePath, encoding, function (err, data) {
        if (err) {
            defer.reject(new Error('Could not read file (' + filePath + '): ' + err.message));
        }
        else {
            defer.resolve(data);
        }
    });
    return defer.promise;
}
exports.readFileContents = readFileContents;
function fileExists(filePath) {
    var defer = Q.defer();
    fs.exists(filePath, function (exists) {
        defer.resolve(exists);
    });
    return defer.promise;
}
exports.fileExists = fileExists;
function objectToFile(filePath, obj) {
    var defer = Q.defer();
    fs.writeFile(filePath, JSON.stringify(obj, null, 2), function (err) {
        if (err) {
            defer.reject(new Error('Could not save to file (' + filePath + '): ' + err.message));
        }
        else {
            defer.resolve(null);
        }
    });
    return defer.promise;
}
exports.objectToFile = objectToFile;
function objectFromFile(filePath, defObj) {
    var defer = Q.defer();
    fs.exists(filePath, function (exists) {
        if (!exists && defObj) {
            defer.resolve(defObj);
        }
        else if (!exists) {
            defer.reject(new Error('File does not exist: ' + filePath));
        }
        else {
            fs.readFile(filePath, function (err, contents) {
                if (err) {
                    defer.reject(new Error('Could not read file (' + filePath + '): ' + err.message));
                }
                else {
                    var obj = JSON.parse(contents.toString());
                    defer.resolve(obj);
                }
            });
        }
    });
    return defer.promise;
}
exports.objectFromFile = objectFromFile;
function getOrCreateObjectFromFile(filePath, defObj) {
    var defer = Q.defer();
    fs.exists(filePath, function (exists) {
        if (!exists) {
            fs.writeFile(filePath, JSON.stringify(defObj, null, 2), function (err) {
                if (err) {
                    defer.reject(new Error('Could not save to file (' + filePath + '): ' + err.message));
                }
                else {
                    defer.resolve({
                        created: true,
                        result: defObj
                    });
                }
            });
        }
        else {
            fs.readFile(filePath, function (err, contents) {
                if (err) {
                    defer.reject(new Error('Could not read file (' + filePath + '): ' + err.message));
                }
                else {
                    var obj = JSON.parse(contents.toString());
                    defer.resolve({
                        created: false,
                        result: obj
                    });
                }
            });
        }
    });
    return defer.promise;
}
exports.getOrCreateObjectFromFile = getOrCreateObjectFromFile;
// ret is { output: string, code: number }
function exec(cmdLine) {
    var defer = Q.defer();
    shell.exec(cmdLine, function (code, output) {
        defer.resolve({ code: code, output: output });
    });
    return defer.promise;
}
exports.exec = exec;
(function (SearchOption) {
    SearchOption[SearchOption["TopDirectoryOnly"] = 0] = "TopDirectoryOnly";
    SearchOption[SearchOption["AllDirectories"] = 1] = "AllDirectories";
})(exports.SearchOption || (exports.SearchOption = {}));
var SearchOption = exports.SearchOption;
function readDirectory(directory, includeFiles, includeFolders, searchOption) {
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
                        if (SearchOption.TopDirectoryOnly === searchOption) {
                            results.push(fullPath);
                            if (--count === 0) {
                                deferred.resolve(results);
                            }
                        }
                        else {
                            readDirectory(fullPath, includeFiles, includeFolders, searchOption)
                                .then(function (moreFiles) {
                                results = results.concat(moreFiles);
                                if (--count === 0) {
                                    deferred.resolve(results);
                                }
                            }, function (error) {
                                deferred.reject(new Error(error.toString()));
                            });
                        }
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
        deferred.reject(error);
    });
    return deferred.promise;
}
exports.readDirectory = readDirectory;
//
// Utilities passed to each task
// which provides contextual logging to server etc...
// also contains general utility methods that would be useful to all task authors
//
var Utilities = (function () {
    function Utilities(context) {
        this.ctx = context;
    }
    //
    // '-a -b "quoted b value" -c -d "quoted d value"' becomes
    // [ '-a', '-b', '"quoted b value"', '-c', '-d', '"quoted d value"' ]
    //
    Utilities.prototype.argStringToArray = function (argString) {
        var args = argString.match(/([^" ]*("[^"]*")[^" ]*)|[^" ]+/g);
        //remove double quotes from each string in args as child_process.spawn() cannot handle literla quotes as part of arguments
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i].replace(/"/g, "");
        }
        return args;
    };
    // spawn a process with stdout/err piped to context's logger
    // callback(err)
    Utilities.prototype.spawn = function (name, args, options, callback) {
        var _this = this;
        var failed = false;
        options = options || {};
        args = args || [];
        var ops = {
            cwd: process.cwd(),
            env: process.env,
            failOnStdErr: true,
            failOnNonZeroRC: true
        };
        // write over specified options over default options (ops)
        for (var op in options) {
            ops[op] = options[op];
        }
        this.ctx.verbose('cwd: ' + ops.cwd);
        this.ctx.verbose('args: ' + args.toString());
        this.ctx.info('running: ' + name + ' ' + args.join(' '));
        var cp = require('child_process').spawn;
        var runCP = cp(name, args, ops);
        runCP.stdout.on('data', function (data) {
            _this.ctx.info(data.toString('utf8'));
        });
        runCP.stderr.on('data', function (data) {
            failed = ops.failOnStdErr;
            if (ops.failOnStdErr) {
                _this.ctx.error(data.toString('utf8'));
            }
            else {
                _this.ctx.info(data.toString('utf8'));
            }
        });
        runCP.on('exit', function (code) {
            if (failed) {
                callback(new Error('Failed with Error Output'), code);
                return;
            }
            if (code == 0 || !ops.failOnNonZeroRC) {
                callback(null, code);
            }
            else {
                var msg = path.basename(name) + ' returned code: ' + code;
                callback(new Error(msg), code);
            }
        });
    };
    return Utilities;
})();
exports.Utilities = Utilities;
