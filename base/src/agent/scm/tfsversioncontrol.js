var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var Q = require('q');
var scmm = require('./lib/scmprovider');
var tfvcwm = require('./lib/tfvcwrapper');
var utilm = require('../utilities');
var shell = require('shelljs');
var path = require('path');
var tl = require('vso-task-lib');
function getProvider(ctx, endpoint) {
    return new TfsvcScmProvider(ctx, endpoint);
}
exports.getProvider = getProvider;
var TfsvcScmProvider = (function (_super) {
    __extends(TfsvcScmProvider, _super);
    function TfsvcScmProvider(ctx, endpoint) {
        this.tfvcw = new tfvcwm.TfvcWrapper();
        this.tfvcw.on('stdout', function (data) {
            ctx.info(data.toString());
        });
        this.tfvcw.on('stderr', function (data) {
            ctx.info(data.toString());
        });
        _super.call(this, ctx, endpoint);
        this.version = this.ctx.jobInfo.jobMessage.environment.variables['build.sourceVersion'];
        this.shelveset = this.ctx.jobInfo.jobMessage.environment.variables['build.sourceTfvcShelveset'];
    }
    TfsvcScmProvider.prototype.setAuthorization = function (authorization) {
        if (authorization && authorization['scheme']) {
            var scheme = authorization['scheme'];
            this.ctx.info('Using auth scheme: ' + scheme);
            switch (scheme) {
                case 'OAuth':
                    this.username = process.env['VSO_TFVC_USERNAME'] || 'OAuth';
                    this.password = process.env['VSO_TFVC_PASSWORD'] || this.getAuthParameter(authorization, 'AccessToken') || 'not supplied';
                    break;
                default:
                    this.ctx.warning('invalid auth scheme: ' + scheme);
            }
        }
        var collectionUri = this.ctx.variables['system.teamFoundationCollectionUri'];
        if (!collectionUri) {
            throw (new Error('collectionUri null initializing tfvc scm provider'));
        }
        this.tfvcw.setTfvcConnOptions({
            username: this.username,
            password: this.password,
            collection: collectionUri
        });
    };
    TfsvcScmProvider.prototype.getCode = function () {
        var _this = this;
        var workspaceName = this._getWorkspaceName();
        var buildDefinitionMappings = this._getTfvcMappings(this.endpoint);
        var byType = function (mappings, type) {
            return mappings.filter(function (mapping) {
                return mapping.type === type;
            });
        };
        var isMappingIdentical = function (buildDefMappings, currMappings) {
            if (!buildDefMappings) {
                throw new Error("Could not read mappings from build definition");
            }
            if (!currMappings) {
                // this should never happen as we should always get empty arrays
                throw new Error("Could not read workspace mapping from current workspace");
            }
            if (buildDefMappings.length !== currMappings.length) {
                return false;
            }
            // hopefully mappings are short lists so a naive comparison isn't too terriably slow
            var contains = function (m, mArray) {
                for (var i = 0; i < mArray.length; i++) {
                    if (m.type === mArray[i].type && m.serverPath === mArray[i].serverPath) {
                        return true;
                    }
                }
                return false;
            };
            var extraInBuildDefinition = buildDefMappings.filter(function (mapping) {
                return !contains(mapping, currMappings);
            });
            if (extraInBuildDefinition.length !== 0) {
                return false;
            }
            var extraInCurrMapping = currMappings.filter(function (mapping) {
                return !contains(mapping, buildDefMappings);
            });
            if (extraInCurrMapping.length !== 0) {
                return false;
            }
            return true;
        };
        return this.tfvcw.getWorkspace(workspaceName)
            .then(function (workspace) {
            if (workspace) {
                if (isMappingIdentical(buildDefinitionMappings, workspace.mappings)) {
                    //workspace exists and the mappings are identical
                    //just undo pending changes so we can do 'tf get' later
                    var getCodePromiseChain = Q(0);
                    byType(buildDefinitionMappings, "map").forEach(function (mapping) {
                        _this.ctx.info("cd " + mapping.localPath);
                        _this._ensurePathExist(mapping.localPath);
                        shell.cd(mapping.localPath);
                        _this.ctx.info("Undo changes for " + mapping.serverPath);
                        getCodePromiseChain = getCodePromiseChain.then(function () {
                            return _this.tfvcw.undo();
                        }, function () {
                            //ignore any undo error from previous step (it errors if there is no pending changes)
                            return _this.tfvcw.undo();
                        });
                    });
                    return getCodePromiseChain.then(function () {
                        // just pass the workspace down
                        return workspace;
                    }, function () {
                        //ignore any undo error from previous step (it errors if there is no pending changes)
                        return workspace;
                    });
                }
                else {
                    //workspace exists and the mappings have been changed, cleanup
                    _this.ctx.info("The current workspace mappings are different from mappings on the build definition.");
                    _this.ctx.info("Clean up existing workspace and remap.");
                    return _this.tfvcw.deleteWorkspace(workspace)
                        .then(function (code) {
                        if (_this.enlistmentExists()) {
                            return utilm.exec('rm -fr ' + _this.targetPath)
                                .then(function (ret) { return ret.code; });
                        }
                        else {
                            _this.ctx.debug('Skip delete nonexistent local source directory');
                            return Q(0);
                        }
                    })
                        .then(function () {
                        //there is no workspace 
                        return null;
                    });
                }
            }
            else {
                //there is no workspace 
                return null;
            }
        })
            .then(function (workspace) {
            if (workspace) {
                //workspace is identical, just pass it down
                return workspace;
            }
            else {
                //workspace either doesn't exist, or we deleted it due to mapping changed
                //need to recreate  
                var newWorkspace = {
                    name: workspaceName,
                    mappings: []
                };
                _this.ctx.info("Creating workspace " + newWorkspace.name);
                return _this.tfvcw.newWorkspace(newWorkspace)
                    .then(function (code) {
                    if (code !== 0) {
                        throw new Error("Failed to create workspace: " + newWorkspace.name);
                    }
                })
                    .then(function () {
                    //get latest workspace
                    return _this.tfvcw.getWorkspace(newWorkspace.name);
                });
            }
        })
            .then(function (workspace) {
            // workspace must eixst now, either identical, or newly created
            if (workspace.mappings.length === 0) {
                //newly created, need to map the mappings
                //map first
                var promiseChain = Q(0);
                byType(buildDefinitionMappings, "map").forEach(function (mapping) {
                    promiseChain = promiseChain.then(function () {
                        _this.ctx.info("Mapping " + mapping.serverPath);
                        return _this.tfvcw.mapFolder(mapping.serverPath, mapping.localPath, workspace);
                    });
                });
                //cloak last 
                byType(buildDefinitionMappings, "cloak").forEach(function (mapping) {
                    promiseChain = promiseChain.then(function () {
                        _this.ctx.info("Cloaking " + mapping.serverPath);
                        return _this.tfvcw.cloakFolder(mapping.serverPath, workspace);
                    });
                });
                return promiseChain;
            }
            else {
                return Q(0);
            }
        })
            .then(function () {
            // now it's guaranteed build definition mapping and actual workspace mapping are identical
            var getCodePromiseChain = Q(0);
            byType(buildDefinitionMappings, "map").forEach(function (mapping) {
                getCodePromiseChain = getCodePromiseChain.then(function () {
                    _this.ctx.info("cd " + mapping.localPath);
                    _this._ensurePathExist(mapping.localPath);
                    shell.cd(mapping.localPath);
                    _this.ctx.info("Getting files for " + mapping.serverPath);
                    return _this.tfvcw.get(_this.version);
                });
            });
            return getCodePromiseChain;
        })
            .then(function (code) {
            if (_this.shelveset) {
                shell.cd(_this.targetPath);
                _this.ctx.info("Unshelving " + _this.shelveset);
                return _this.tfvcw.unshelve(_this.shelveset, {
                    name: workspaceName
                });
            }
            else {
                return Q(0);
            }
        });
    };
    // clean a workspace. Delete the workspace and remove the target folder
    TfsvcScmProvider.prototype.clean = function () {
        var _this = this;
        var workspaceName = this._getWorkspaceName();
        // clean workspace and delete local folder
        return this.tfvcw.getWorkspace(workspaceName)
            .then(function (workspace) {
            if (workspace) {
                return _this.tfvcw.deleteWorkspace(workspace);
            }
            else {
                _this.ctx.debug('Workspace does not exist on server');
                return Q(0);
            }
        })
            .then(function (code) {
            if (_this.enlistmentExists()) {
                return utilm.exec('rm -fr ' + _this.targetPath)
                    .then(function (ret) { return ret.code; });
            }
            else {
                _this.ctx.debug('Skip delete nonexistent local source directory');
                return Q(0);
            }
        });
    };
    TfsvcScmProvider.prototype._getWorkspaceName = function () {
        var agentId = this.ctx.config.agent.id;
        var workspaceName = ("ws_" + this._getBuildFolder() + "_" + agentId).slice(0, 60);
        this.ctx.info("workspace name: " + workspaceName);
        return workspaceName;
    };
    TfsvcScmProvider.prototype._getBuildFolder = function () {
        var agentBuildDir = this.ctx.jobInfo.jobMessage.environment.variables["agent.buildDirectory"];
        var agentWorkDir = this.ctx.jobInfo.jobMessage.environment.variables["agent.workFolder"];
        return agentBuildDir.slice(agentWorkDir.length + 1);
    };
    TfsvcScmProvider.prototype._ensurePathExist = function (path) {
        if (!shell.test('-d', path)) {
            this.ctx.debug("mkdir -p " + path);
            shell.mkdir("-p", path);
        }
    };
    TfsvcScmProvider.prototype._rootingWildcardPath = function (path) {
        if (path.indexOf('*') > -1) {
            return path.slice(0, path.indexOf('*'));
        }
        return path;
    };
    TfsvcScmProvider.prototype._getCommonPath = function (commonPath, serverPath) {
        var commonPathSegments = commonPath.split('/');
        var pathSegments = serverPath.split('/');
        var commonSegments = [];
        var idx = 0;
        while (idx < commonPathSegments.length && idx < pathSegments.length
            && commonPathSegments[idx] === pathSegments[idx]) {
            commonSegments = commonSegments.concat(commonPathSegments[idx]);
            idx++;
        }
        return path.join.apply(null, commonSegments);
    };
    TfsvcScmProvider.prototype._getCommonRootPath = function (definitionMappings) {
        var _this = this;
        var serverPaths = definitionMappings.map(function (mapping) {
            return _this._rootingWildcardPath(mapping["serverPath"]);
        });
        var commonPath = serverPaths[0];
        serverPaths.forEach(function (serverPath) {
            commonPath = _this._getCommonPath(path.normalize(commonPath), path.normalize(serverPath));
            if (!commonPath) {
                return false;
            }
        });
        return commonPath;
    };
    TfsvcScmProvider.prototype._createLocalPath = function (mapping, commonPath) {
        var serverPath = mapping["serverPath"];
        var rootedServerPath = this._rootingWildcardPath(serverPath.slice(commonPath.length));
        var localPath = path.join(this.targetPath, rootedServerPath);
        this._ensurePathExist(localPath);
        return localPath;
    };
    TfsvcScmProvider.prototype._getTfvcMappings = function (endpoint) {
        var _this = this;
        if (endpoint && endpoint.data && endpoint.data['tfvcWorkspaceMapping']) {
            var tfvcMappings = JSON.parse(endpoint.data['tfvcWorkspaceMapping']);
            if (tfvcMappings && tfvcMappings.mappings) {
                var commonRootPath = this._getCommonRootPath(tfvcMappings.mappings);
                this.ctx.info('common path for mapping: ' + commonRootPath);
                return tfvcMappings.mappings.map(function (buildDefMap) {
                    var serverPath = buildDefMap["serverPath"];
                    return {
                        type: buildDefMap["mappingType"],
                        serverPath: serverPath,
                        localPath: _this._createLocalPath(buildDefMap, commonRootPath)
                    };
                });
            }
        }
        return [];
    };
    return TfsvcScmProvider;
})(scmm.ScmProvider);
exports.TfsvcScmProvider = TfsvcScmProvider;
