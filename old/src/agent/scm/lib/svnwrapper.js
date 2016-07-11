/// <reference path="../../definitions/node.d.ts"/>
/// <reference path="../../definitions/toolrunner.d.ts"/>
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var tl = require('vso-task-lib');
var events = require('events');
var cm = require('../../common');
var utilm = require('../../utilities');
var Q = require('q');
var shell = require('shelljs');
var path = require('path');
var xmlReader = require('xmlreader');
exports.administrativeDirectoryName = ".svn";
var SvnWrapper = (function (_super) {
    __extends(SvnWrapper, _super);
    function SvnWrapper(ctx) {
        this.svnPath = shell.which('svn', false);
        this.endpoint = {};
        this.ctx = ctx;
        _super.call(this);
    }
    SvnWrapper.prototype.setSvnConnectionEndpoint = function (endpoint) {
        if (endpoint) {
            this.endpoint = endpoint;
        }
    };
    SvnWrapper.prototype.getOldMappings = function (rootPath) {
        var _this = this;
        if (shell.test("-f", rootPath)) {
            throw new Error("The file " + rootPath + " already exists.");
        }
        if (shell.test("-d", rootPath)) {
            return this._getSvnWorkingCopyPaths(rootPath)
                .then(function (workingDirectoryPaths) {
                var mappingsPromise = Q({});
                if (workingDirectoryPaths) {
                    var mappings = {};
                    workingDirectoryPaths.forEach(function (workingDirectoryPath) {
                        mappingsPromise = mappingsPromise
                            .then(function (v) {
                            return _this._getTargetUrl(workingDirectoryPath);
                        })
                            .then(function (url) {
                            if (url) {
                                mappings[workingDirectoryPath] = url;
                            }
                            return Q(mappings);
                        });
                    });
                }
                return mappingsPromise;
            });
        }
        else {
            return Q({});
        }
    };
    SvnWrapper.prototype._getSvnWorkingCopyPaths = function (rootPath) {
        var _this = this;
        var candidates = [];
        var deferred = Q.defer();
        if (shell.test("-d", path.join(rootPath, exports.administrativeDirectoryName))) {
            // The rootPath contains .svn subfolder and we treat it as
            // a working copy candidate.  
            deferred.resolve([rootPath]);
        }
        else {
            // Browse direct subfolder children of the rootPath
            utilm.readDirectory(rootPath, false, true, utilm.SearchOption.TopDirectoryOnly)
                .then(function (subFolders) {
                // The first element in the collection returned by the method is the rootPath, 
                // which we've already tested. Ignore it.
                subFolders.shift();
                var count = subFolders.length;
                if (count > 0) {
                    subFolders.forEach(function (subFolder) {
                        if (shell.test("-d", path.join(subFolder, exports.administrativeDirectoryName))) {
                            // The subfolder contains .svn directory and we treat it as
                            // a working copy candidate.
                            candidates.push(subFolder);
                            if (--count == 0) {
                                deferred.resolve(candidates);
                            }
                        }
                        else {
                            // Merge working directory paths found in the subfolder into the common candidates collection.
                            _this._getSvnWorkingCopyPaths(subFolder)
                                .then(function (moreCandidates) {
                                candidates = candidates.concat(moreCandidates);
                                if (--count == 0) {
                                    deferred.resolve(candidates);
                                }
                            });
                        }
                    });
                }
                else {
                    deferred.resolve(candidates);
                }
            });
        }
        return deferred.promise;
    };
    SvnWrapper.prototype._getTargetUrl = function (folder) {
        var _this = this;
        if (!shell.test("-d", folder)) {
            throw new Error("Folder " + folder + " does not exists");
        }
        var deferred = Q.defer();
        this._shellExec('info', [folder, "--depth", "empty", "--xml"])
            .then(function (ret) {
            if (!_this.isSuccess(ret)) {
                deferred.resolve(null);
            }
            else if (ret.output) {
                xmlReader.read(ret.output, function (err, res) {
                    if (err) {
                        deferred.reject(err);
                    }
                    else {
                        try {
                            return deferred.resolve(res.info.entry.url.text());
                        }
                        catch (e) {
                            deferred.reject(e);
                        }
                    }
                });
            }
            else {
                deferred.resolve(null);
            }
        });
        return deferred.promise;
    };
    SvnWrapper.prototype.getLatestRevision = function (sourceBranch, sourceRevision) {
        var _this = this;
        return this._shellExec('info', [this.buildSvnUrl(sourceBranch),
            "--depth", "empty",
            "--revision", sourceRevision,
            "--xml"])
            .then(function (ret) {
            var defer = Q.defer();
            if (!_this.isSuccess(ret)) {
                defer.reject(ret.output);
            }
            else {
                try {
                    xmlReader.read(ret.output, function (err, res) {
                        if (err) {
                            defer.reject(err);
                        }
                        else {
                            defer.resolve(res);
                        }
                    });
                }
                catch (e) {
                    defer.reject(e);
                }
            }
            return defer.promise;
        })
            .then(function (res) {
            var rev = res.info.entry.commit.attributes()["revision"];
            _this.ctx.verbose("Latest revision: " + rev);
            return rev;
        }, function (err) {
            _this.ctx.verbose("Subversion call filed: " + err);
            _this.ctx.verbose("Using the original revision: " + sourceRevision);
            return sourceRevision;
        });
    };
    SvnWrapper.prototype.update = function (svnModule) {
        this.ctx.info("Updating " + svnModule.localPath
            + " with depth: " + svnModule.depth
            + ", revision: " + svnModule.revision
            + ", ignore externals: " + svnModule.ignoreExternals);
        var args = [svnModule.localPath,
            '--revision', svnModule.revision,
            '--depth', this._toSvnDepth(svnModule.depth)];
        if (svnModule.ignoreExternals) {
            args.push('--ignore-externals');
        }
        return this._exec('update', args);
    };
    SvnWrapper.prototype.switch = function (svnModule) {
        this.ctx.info("Switching " + svnModule.localPath
            + " to ^" + svnModule.serverPath
            + " with depth: " + svnModule.depth
            + ", revision: " + svnModule.revision
            + ", ignore externals: " + svnModule.ignoreExternals);
        var args = [svnModule.serverPath,
            svnModule.localPath,
            '--revision', svnModule.revision,
            '--depth', this._toSvnDepth(svnModule.depth)];
        if (svnModule.ignoreExternals) {
            args.push('--ignore-externals');
        }
        return this._exec('switch', args);
    };
    SvnWrapper.prototype.checkout = function (svnModule) {
        this.ctx.info("Checking out " + svnModule.localPath
            + " with depth: " + svnModule.depth
            + ", revision: " + svnModule.revision
            + ", ignore externals: " + svnModule.ignoreExternals);
        var args = [svnModule.serverPath,
            svnModule.localPath,
            '--revision', svnModule.revision,
            '--depth', this._toSvnDepth(svnModule.depth)];
        if (svnModule.ignoreExternals) {
            args.push('--ignore-externals');
        }
        return this._exec('checkout', args);
    };
    SvnWrapper.prototype.buildSvnUrl = function (sourceBranch, serverPath) {
        var url = this.endpoint.url;
        if ((url == null) || (url.length == 0)) {
            throw new Error("Connection endpoint URL cannot be empty.");
        }
        url = this.appendPath(url.replace('\\', '/'), sourceBranch);
        if (serverPath) {
            url = this.appendPath(url, serverPath);
        }
        return url;
    };
    SvnWrapper.prototype.appendPath = function (base, path) {
        var url = base.replace('\\', '/');
        if (path && (path.length > 0)) {
            if (!url.endsWith('/')) {
                url = url + '/';
            }
            url = url + path;
        }
        return url;
    };
    SvnWrapper.prototype._getQuotedArgsWithDefaults = function (args) {
        // default connection related args
        var usernameArg = '--username';
        var passwordArg = '--password';
        var defaults = [];
        if (this.endpoint.username && this.endpoint.username.length > 0) {
            this.ctx.verbose("username=" + this.endpoint.username);
            defaults.push(usernameArg, this.endpoint.username);
        }
        if (this.endpoint.password && this.endpoint.password.length > 0) {
            this.ctx.verbose("password=" + this.endpoint.password);
            defaults.push(passwordArg, this.endpoint.password);
        }
        var quotedArg = function (arg) {
            var quote = '"';
            if (arg.indexOf('"') > -1) {
                quote = '\'';
            }
            return quote + arg + quote;
        };
        return args.concat(defaults).map(function (a) { return quotedArg(a); });
    };
    SvnWrapper.prototype._scrubCredential = function (msg) {
        if (msg && typeof msg.replace === 'function'
            && this.endpoint.password) {
            return msg.replace(this.endpoint.password, cm.MASK_REPLACEMENT);
        }
        return msg;
    };
    SvnWrapper.prototype._exec = function (cmd, args, options) {
        var _this = this;
        if (this.svnPath === null) {
            return this._getSvnNotInstalled();
        }
        var svn = new tl.ToolRunner(this.svnPath);
        svn.silent = !this.isDebugMode();
        svn.on('debug', function (message) {
            _this.emit('stdout', '[debug]' + _this._scrubCredential(message));
        });
        svn.on('stdout', function (data) {
            _this.emit('stdout', _this._scrubCredential(data));
        });
        svn.on('stderr', function (data) {
            _this.emit('stderr', _this._scrubCredential(data));
        });
        // cmd
        svn.arg(cmd, true);
        var quotedArgs = this._getQuotedArgsWithDefaults(args);
        // args
        if (quotedArgs.map(function (arg) {
            svn.arg(arg, true); // raw arg
        }))
            ;
        options = options || {};
        var ops = {
            cwd: options.cwd || process.cwd(),
            env: options.env || process.env,
            silent: !this.isDebugMode(),
            outStream: options.outStream || process.stdout,
            errStream: options.errStream || process.stderr,
            failOnStdErr: options.failOnStdErr || false,
            ignoreReturnCode: options.ignoreReturnCode || false
        };
        return svn.exec(ops);
    };
    SvnWrapper.prototype._shellExec = function (cmd, args) {
        var _this = this;
        if (this.svnPath === null) {
            return this._getSvnNotInstalled();
        }
        var cmdline = this.svnPath + ' ' + cmd + ' ' + this._getQuotedArgsWithDefaults(args).join(' ');
        return utilm.exec(cmdline)
            .then(function (v) {
            _this.ctx.verbose(_this._scrubCredential(cmdline));
            _this.ctx.verbose(JSON.stringify(v));
            return v;
        });
    };
    SvnWrapper.prototype._getSvnNotInstalled = function () {
        return Q.reject(new Error("'svn' was not found. Please install the Subversion command-line client and add 'svn' to the path."));
    };
    SvnWrapper.prototype._toSvnDepth = function (depth) {
        return depth == "0" ? 'empty' :
            depth == "1" ? 'files' :
                depth == "2" ? 'children' :
                    depth == "3" ? 'infinity' :
                        depth || 'infinity';
    };
    SvnWrapper.prototype.isSuccess = function (ret) {
        return ret && ret.code === 0;
    };
    SvnWrapper.prototype.isDebugMode = function () {
        var environment = this.ctx.jobInfo.jobMessage.environment;
        var debugMode = environment.variables["system.debug"] || 'false';
        return debugMode === 'true';
    };
    return SvnWrapper;
})(events.EventEmitter);
exports.SvnWrapper = SvnWrapper;
