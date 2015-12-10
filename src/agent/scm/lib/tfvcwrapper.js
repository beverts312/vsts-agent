/// <reference path="../../definitions/node.d.ts"/>
/// <reference path="../../definitions/toolrunner.d.ts"/>
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var tl = require('vso-task-lib');
var cm = require('../../common');
var events = require('events');
var utilm = require('../../utilities');
var Q = require('q');
var shell = require('shelljs');
var path = require('path');
var xr = require('xmlreader');
var TfvcWrapper = (function (_super) {
    __extends(TfvcWrapper, _super);
    function TfvcWrapper() {
        this.tfPath = shell.which('tf', false);
        this.connOptions = {};
        _super.call(this);
    }
    TfvcWrapper.prototype.setTfvcConnOptions = function (options) {
        if (options) {
            this.connOptions = options;
        }
    };
    TfvcWrapper.prototype.getWorkspace = function (workspaceName) {
        var _this = this;
        return this._shellExec('workspaces', ['-format:xml'])
            .then(function (ret) {
            if (!_this._success(ret)) {
                return null;
            }
            //tf command returns non-xml text when there is no workspace
            var sanitize = function (output) {
                return output.slice(output.indexOf("<?xml"));
            };
            if (ret.output) {
                var workspace = null;
                xr.read(sanitize(ret.output), function (err, res) {
                    if (res && res.workspaces && res.workspaces.workspace) {
                        res.workspaces.workspace.each(function (i, ws) {
                            if (ws.attributes()['name'] === workspaceName) {
                                workspace = _this._parseWorkspace(ws);
                            }
                        });
                    }
                });
                return workspace;
            }
        });
    };
    TfvcWrapper.prototype.deleteWorkspace = function (workspace) {
        return this._exec('workspace', ['-delete', workspace.name]);
    };
    TfvcWrapper.prototype.newWorkspace = function (workspace) {
        return this._exec("workspace", ['-new', '-permission:Private', '-location:local', workspace.name]);
    };
    TfvcWrapper.prototype.cloakFolder = function (serverPath, workspace) {
        return this._exec('workfold', ['-cloak', serverPath, '-workspace:' + workspace.name]);
    };
    TfvcWrapper.prototype.mapFolder = function (serverPath, localPath, workspace) {
        return this._exec('workfold', ['-map', serverPath, localPath, '-workspace:' + workspace.name]);
    };
    TfvcWrapper.prototype.unshelve = function (shelveset, workspace) {
        return this._exec('unshelve', ['-recursive', '-format:detailed', '-workspace:' + workspace.name, shelveset]);
    };
    TfvcWrapper.prototype.get = function (version) {
        return this._exec('get', ['.', '-recursive', '-version:' + version, '-noprompt']);
    };
    TfvcWrapper.prototype.undo = function () {
        return this._exec('undo', ['.', '-recursive']);
    };
    TfvcWrapper.prototype._getQuotedArgsWithDefaults = function (args) {
        // default connection related args
        var collectionArg = '-collection:' + this.connOptions.collection;
        var loginArg = '-login:' + this.connOptions.username + ',' + this.connOptions.password;
        var quotedArg = function (arg) {
            var quote = '"';
            if (arg.indexOf('"') > -1) {
                quote = '\'';
            }
            return quote + arg + quote;
        };
        return args.concat([collectionArg, loginArg]).map(function (a) { return quotedArg(a); });
    };
    TfvcWrapper.prototype._scrubCredential = function (msg) {
        if (msg && typeof msg.replace === 'function'
            && this.connOptions.password) {
            return msg.replace(this.connOptions.password, cm.MASK_REPLACEMENT);
        }
        return msg;
    };
    TfvcWrapper.prototype._exec = function (cmd, args, options) {
        var _this = this;
        if (this.tfPath === null) {
            return this._getTfNotInstalled();
        }
        var tf = new tl.ToolRunner(this.tfPath);
        tf.silent = true;
        tf.on('debug', function (message) {
            _this.emit('stdout', '[debug]' + _this._scrubCredential(message));
        });
        tf.on('stdout', function (data) {
            _this.emit('stdout', _this._scrubCredential(data));
        });
        tf.on('stderr', function (data) {
            _this.emit('stderr', _this._scrubCredential(data));
        });
        // cmd
        tf.arg(cmd, true);
        var quotedArgs = this._getQuotedArgsWithDefaults(args);
        // args
        if (quotedArgs.map(function (arg) {
            tf.arg(arg, true); // raw arg
        }))
            ;
        options = options || {};
        var ops = {
            cwd: options.cwd || process.cwd(),
            env: options.env || process.env,
            silent: true,
            outStream: options.outStream || process.stdout,
            errStream: options.errStream || process.stderr,
            failOnStdErr: options.failOnStdErr || false,
            ignoreReturnCode: options.ignoreReturnCode || false
        };
        return tf.exec(ops);
    };
    TfvcWrapper.prototype._shellExec = function (cmd, args) {
        if (this.tfPath === null) {
            return this._getTfNotInstalled();
        }
        var cmdline = 'tf ' + cmd + ' ' + this._getQuotedArgsWithDefaults(args).join(' ');
        return utilm.exec(cmdline);
    };
    TfvcWrapper.prototype._parseWorkspace = function (xmlNode) {
        var workspace = {
            name: xmlNode.attributes()['name'],
            mappings: []
        };
        if (xmlNode['working-folder']) {
            xmlNode['working-folder'].each(function (i, folder) {
                // if mapping depth is one-level, add a wildcard to the end of the mapping
                // so it matches the input
                var serverPath = folder.attributes()['server-item'];
                var depth = folder.attributes()['depth'];
                if (depth && depth === 'one-level') {
                    serverPath = path.join(serverPath, "*");
                }
                workspace.mappings.push({
                    serverPath: serverPath,
                    localPath: folder.attributes()['local-item'],
                    type: folder.attributes()['type']
                });
            });
        }
        return workspace;
    };
    TfvcWrapper.prototype._getTfNotInstalled = function () {
        var defer = Q.defer();
        defer.reject(new Error("'tf' was not found. Please install the Microsoft Team Explorer Everywhere cross-platorm, command-line client and add 'tf' to the path.\n"
            + "Please also accept its End User License Agreement by running 'tf eula'.\n"
            + "See https://www.visualstudio.com/products/team-explorer-everywhere-vs.aspx \n"));
        return defer.promise;
    };
    TfvcWrapper.prototype._success = function (ret) {
        return ret && ret.code === 0;
    };
    return TfvcWrapper;
})(events.EventEmitter);
exports.TfvcWrapper = TfvcWrapper;
