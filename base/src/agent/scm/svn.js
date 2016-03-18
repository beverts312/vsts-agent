var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var Q = require('q');
var scmprovider = require('./lib/scmprovider');
var sw = require('./lib/svnwrapper');
var utilm = require('../utilities');
var shell = require('shelljs');
var path = require('path');
var tl = require('vso-task-lib');
function getProvider(ctx, endpoint) {
    return new SvnScmProvider(ctx, endpoint);
}
exports.getProvider = getProvider;
var SvnScmProvider = (function (_super) {
    __extends(SvnScmProvider, _super);
    function SvnScmProvider(ctx, endpoint) {
        this.svnw = new sw.SvnWrapper(ctx);
        this.svnw.on('stdout', function (data) {
            ctx.info(data.toString());
        });
        this.svnw.on('stderr', function (data) {
            ctx.info(data.toString());
        });
        _super.call(this, ctx, endpoint);
    }
    SvnScmProvider.prototype.setAuthorization = function (authorization) {
        if (authorization && authorization['scheme']) {
            var scheme = authorization['scheme'];
            this.ctx.info('Using auth scheme: ' + scheme);
            switch (scheme) {
                case 'UsernamePassword':
                    this.username = process.env['VSO_SVN_USERNAME'] || this.getAuthParameter(authorization, 'Username') || '';
                    this.password = process.env['VSO_SVN_PASSWORD'] || this.getAuthParameter(authorization, 'Password') || '';
                    this.realmName = process.env['VSO_SVN_REALMNAME'] || this.getAuthParameter(authorization, 'RealmName') || '';
                    break;
                default:
                    this.ctx.warning('invalid auth scheme: ' + scheme);
            }
        }
        this.svnw.setSvnConnectionEndpoint({
            username: this.username,
            password: this.password,
            realmName: this.realmName,
            url: this.endpoint.url
        });
    };
    SvnScmProvider.prototype.getCode = function () {
        var _this = this;
        this._ensurePathExist(this.targetPath);
        var srcVersion = this.ctx.jobInfo.jobMessage.environment.variables['build.sourceVersion'];
        var srcBranch = this.ctx.jobInfo.jobMessage.environment.variables['build.sourceBranch'];
        this.defaultRevision = this._expandEnvironmentVariables(srcVersion);
        this.defaultBranch = this._expandEnvironmentVariables(srcBranch);
        this.ctx.info('Revision: ' + this.defaultRevision);
        this.ctx.info('Branch: ' + this.defaultBranch);
        var newMappings = this._buildNewMappings(this.endpoint);
        var oldMappings = {};
        return this.svnw.getOldMappings(this.targetPath)
            .then(function (mappings) {
            oldMappings = mappings;
            _this.ctx.verbose("OldMappings: " + JSON.stringify(oldMappings));
            _this.ctx.verbose("NewMappings: " + JSON.stringify(newMappings));
            _this._cleanupSvnWorkspace(mappings, newMappings);
        })
            .then(function () {
            return _this.svnw.getLatestRevision(_this.defaultBranch, _this.defaultRevision);
        })
            .then(function (latestRevision) {
            var deferred = Q.defer();
            var promiseChain = Q(0);
            for (var localPath in newMappings) {
                var mapping = newMappings[localPath];
                var serverPath = mapping.serverPath;
                var effectiveRevision = mapping.revision.toUpperCase() === 'HEAD' ? latestRevision : mapping.revision;
                var effectiveMapping = {
                    localPath: mapping.localPath,
                    serverPath: mapping.serverPath,
                    revision: effectiveRevision,
                    depth: mapping.depth,
                    ignoreExternals: mapping.ignoreExternals };
                _this.ctx.verbose("effectiveMapping for " + effectiveMapping.localPath);
                _this.ctx.verbose("         serverPath: " + effectiveMapping.serverPath);
                _this.ctx.verbose("         revision: " + effectiveMapping.revision);
                _this.ctx.verbose("         depth: " + effectiveMapping.depth);
                _this.ctx.verbose("         ignoreExternals: " + effectiveMapping.ignoreExternals);
                if (!shell.test('-d', _this.svnw.appendPath(localPath, sw.administrativeDirectoryName))) {
                    promiseChain = _this._addCheckoutPromise(promiseChain, effectiveMapping);
                }
                else if (oldMappings[localPath] && (oldMappings[localPath] === serverPath)) {
                    promiseChain = _this._addUpdatePromise(promiseChain, effectiveMapping);
                }
                else {
                    promiseChain = _this._addSwitchPromise(promiseChain, effectiveMapping);
                }
            }
            ;
            promiseChain.then(function (ret) {
                deferred.resolve(ret);
            }, function (err) {
                deferred.reject(err);
            });
            return deferred.promise;
        });
    };
    // Remove the target folder
    SvnScmProvider.prototype.clean = function () {
        this.ctx.info("Remove the target folder");
        if (this.enlistmentExists()) {
            return utilm.exec('rm -fr ' + this.targetPath)
                .then(function (ret) { return Q(ret.code); });
        }
        else {
            this.ctx.debug('Skip deleting nonexisting local source directory ' + this.targetPath);
            return Q(0);
        }
    };
    SvnScmProvider.prototype._addCheckoutPromise = function (promiseChain, effectiveMapping) {
        var _this = this;
        var svnModuleMapping = effectiveMapping;
        var oldChain = promiseChain;
        return oldChain.then(function (ret) {
            return _this.svnw.checkout(svnModuleMapping);
        });
    };
    SvnScmProvider.prototype._addUpdatePromise = function (promiseChain, effectiveMapping) {
        var _this = this;
        var svnModuleMapping = effectiveMapping;
        var oldChain = promiseChain;
        return oldChain.then(function (ret) {
            return _this.svnw.update(svnModuleMapping);
        });
    };
    SvnScmProvider.prototype._addSwitchPromise = function (promiseChain, effectiveMapping) {
        var _this = this;
        var svnModuleMapping = effectiveMapping;
        var oldChain = promiseChain;
        return oldChain.then(function (ret) {
            return _this.svnw.switch(svnModuleMapping);
        });
    };
    SvnScmProvider.prototype._ensurePathExist = function (path) {
        if (!shell.test('-d', path)) {
            this.ctx.debug("mkdir -p " + path);
            shell.mkdir("-p", path);
        }
    };
    SvnScmProvider.prototype._normalizeRelativePath = function (path) {
        var normalizedPath = path || '';
        if (normalizedPath.indexOf(':') + normalizedPath.indexOf('..') > -2) {
            throw new Error('Incorrect relative path ' + path + ' specified.');
        }
        normalizedPath = normalizedPath.trim().replace('\\', '/'); // convert path separators
        normalizedPath = normalizedPath.replace(/^(\/+).*(\/)+$/, function (s) { return ''; }); // remove leading and trailing path separators
        return normalizedPath;
    };
    SvnScmProvider.prototype._normalizeBranch = function (branch) {
        var normalizedBranch = this._normalizeRelativePath(branch);
        return (branch || '').length == 0 ? 'trunk' : branch;
    };
    SvnScmProvider.prototype._normalizeMappings = function (allMappings) {
        var _this = this;
        var distinctMappings = {};
        var distinctLocalPaths = {};
        var distinctServerPaths = {};
        var fullMapping = false;
        allMappings.forEach(function (map) {
            var localPath = _this._normalizeRelativePath(_this._expandEnvironmentVariables(map.localPath));
            var serverPath = _this._normalizeRelativePath(_this._expandEnvironmentVariables(map.serverPath));
            if (!fullMapping) {
                if ((serverPath == null) || (serverPath.length == 0)) {
                    _this.ctx.verbose("The empty relative server path is mapped to '" + localPath + "'.");
                    _this.ctx.verbose("The entire mapping set is ignored. Proceeding with the full branch mapping.");
                    fullMapping = true;
                    distinctMappings = null;
                    distinctMappings = {};
                    distinctMappings[localPath] = map;
                }
                else {
                    if (!(localPath && localPath.length > 0)) {
                        localPath = serverPath;
                    }
                    if ((distinctLocalPaths[localPath] == null) && (distinctServerPaths[serverPath] == null)) {
                        map.localPath = localPath;
                        map.serverPath = serverPath;
                        distinctMappings[localPath] = map;
                        distinctLocalPaths[localPath] = localPath;
                        distinctServerPaths[serverPath] = serverPath;
                    }
                }
            }
        });
        return distinctMappings;
    };
    SvnScmProvider.prototype._expandEnvironmentVariables = function (s) {
        var environment = this.ctx.jobInfo.jobMessage.environment;
        return (s || '').replaceVars(environment.variables);
    };
    SvnScmProvider.prototype._buildNewMappings = function (endpoint) {
        var svnMappings = {};
        if (endpoint && endpoint.data && endpoint.data['svnWorkspaceMapping']) {
            var svnWorkspace = JSON.parse(endpoint.data['svnWorkspaceMapping']);
            if (svnWorkspace && svnWorkspace.mappings && svnWorkspace.mappings.length > 0) {
                var distinctMappings = this._normalizeMappings(svnWorkspace.mappings);
                if (distinctMappings) {
                    for (var key in distinctMappings) {
                        var value = distinctMappings[key];
                        var absoluteLocalPath = this.svnw.appendPath(this.targetPath, value.localPath);
                        var url = this.svnw.buildSvnUrl(this.defaultBranch, value.serverPath);
                        svnMappings[absoluteLocalPath] = {
                            serverPath: url,
                            localPath: absoluteLocalPath,
                            revision: value.revision,
                            depth: value.depth,
                            ignoreExternals: value.ignoreExternals
                        };
                    }
                    return svnMappings;
                }
            }
        }
        svnMappings[this.targetPath] = {
            serverPath: this.svnw.buildSvnUrl(this.defaultBranch),
            localPath: this.targetPath,
            revision: 'HEAD',
            depth: 'infinity',
            ignoreExternals: true
        };
        return svnMappings;
    };
    SvnScmProvider.prototype._cleanupSvnWorkspace = function (oldMappings, newMappings) {
        var promiseChain = Q(0);
        this.ctx.verbose("_cleanupSvnWorkspace");
        for (var localPath in oldMappings) {
            if (!newMappings[localPath]) {
                this.ctx.verbose("Removing old mapping folder " + localPath);
                shell.rm('-rf', localPath);
            }
        }
        ;
        return promiseChain;
    };
    return SvnScmProvider;
})(scmprovider.ScmProvider);
exports.SvnScmProvider = SvnScmProvider;
