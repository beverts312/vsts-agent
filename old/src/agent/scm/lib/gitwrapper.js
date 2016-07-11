/// <reference path="../../definitions/node.d.ts"/>
/// <reference path="../../definitions/toolrunner.d.ts"/>
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
// TODO: convert vso-task-lib to TS and generate .d.ts file
var tl = require('vso-task-lib');
var events = require('events');
var Q = require('q');
var shell = require('shelljs');
var path = require('path');
exports.envGitUsername = 'GIT_USERNAME';
exports.envGitPassword = 'GIT_PASSWORD';
;
// TODO: support isolated local copy of git
var _gitLocalPath = path.join(__dirname, process.platform, 'libgit_host');
// TODO: move into vso-task-lib??
var GitWrapper = (function (_super) {
    __extends(GitWrapper, _super);
    function GitWrapper() {
        this.gitInstalled = shell.which('git', false) !== null;
        _super.call(this);
    }
    GitWrapper.prototype.clone = function (repository, progress, folder, options) {
        options = options || {};
        options.useGitExe = true;
        options.creds = true;
        var args = ['clone', repository];
        if (progress) {
            args.push('--progress');
        }
        if (folder) {
            args.push(folder);
        }
        return this.exec(args, options);
    };
    GitWrapper.prototype.remote = function (args, options) {
        options = options || {};
        options.useGitExe = true;
        options.creds = true;
        return this.exec(['remote'].concat(args), options);
    };
    GitWrapper.prototype.fetch = function (args, options) {
        options = options || {};
        options.useGitExe = true;
        options.creds = true;
        return this.exec(['fetch'].concat(args), options);
    };
    GitWrapper.prototype.checkout = function (ref, options) {
        options = options || {};
        options.useGitExe = true;
        options.creds = true;
        return this.exec(['checkout', ref], options);
    };
    GitWrapper.prototype.clean = function (args, options) {
        options = options || {};
        options.useGitExe = true;
        return this.exec(['clean'].concat(args), options);
    };
    GitWrapper.prototype.reset = function (args, options) {
        options = options || {};
        options.useGitExe = true;
        return this.exec(['reset'].concat(args), options);
    };
    GitWrapper.prototype.submodule = function (args, options) {
        options = options || {};
        options.useGitExe = true;
        options.creds = true;
        return this.exec(['submodule'].concat(args), options);
    };
    GitWrapper.prototype.exec = function (args, options) {
        var _this = this;
        options = options || {};
        var defer = Q.defer();
        var gitPath = options.useGitExe || process.env['AGENT_USEGITEXE'] ? shell.which('git', false) : _gitLocalPath;
        if (!gitPath) {
            throw (new Error('git not found.  ensure installed and in the path'));
            return;
        }
        var git = new tl.ToolRunner(gitPath);
        git.silent = true;
        var creds = this.username + ':' + this.password;
        git.on('debug', function (message) {
            if (options.debugOutput) {
                var repl = message.replace(creds, '...');
                _this.emit('stdout', '[debug]' + repl);
            }
        });
        git.on('stdout', function (data) {
            _this.emit('stdout', data);
        });
        git.on('stderr', function (data) {
            _this.emit('stderr', data);
        });
        // TODO: if HTTP_PROXY is set (debugging) we can also supply http.proxy config
        // TODO: handle and test with spaces in the path
        if (false // not using credhelper for now, user/pass in url
            && options.creds) {
            // protect against private repo where no creds are supplied (external) - we don't want a prompt
            process.env[exports.envGitUsername] = this.username || 'none';
            process.env[exports.envGitPassword] = this.password || '';
            var credHelper = path.join(__dirname, 'credhelper.js');
            git.arg('-c');
            // TODO: test quoting and spaces
            git.arg('credential.helper=' + credHelper, true); // raw arg
        }
        if (args.map(function (arg) {
            git.arg(arg, true); // raw arg
        }))
            ;
        options = options || {};
        var ops = {
            cwd: options.cwd || process.cwd(),
            env: options.env || process.env,
            silent: true,
            outStream: options.outStream || process.stdout,
            errStream: options.errStream || process.stderr,
            failOnStdErr: false,
            ignoreReturnCode: false
        };
        return git.exec(ops)
            .fin(function () {
            process.env[exports.envGitUsername] = null;
            process.env[exports.envGitPassword] = null;
        });
    };
    return GitWrapper;
})(events.EventEmitter);
exports.GitWrapper = GitWrapper;
