var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var Q = require('q');
var scmm = require('./lib/scmprovider');
var gitwm = require('./lib/gitwrapper');
var path = require('path');
var shell = require('shelljs');
var url = require('url');
var PullRefsPrefix = "refs/pull/";
var PullRefsOriginPrefix = "refs/remotes/origin/pull/";
function getProvider(ctx, endpoint) {
    return new GitScmProvider(ctx, endpoint);
}
exports.getProvider = getProvider;
function _translateRef(ref) {
    var brPre = 'refs/heads/';
    if (ref.startsWith(brPre)) {
        ref = 'refs/remotes/origin/' + ref.substr(brPre.length, ref.length - brPre.length);
    }
    return ref;
}
// TODO: take options with stdout and stderr streams for testing?
var GitScmProvider = (function (_super) {
    __extends(GitScmProvider, _super);
    function GitScmProvider(ctx, endpoint) {
        this.gitw = new gitwm.GitWrapper();
        this.gitw.on('stdout', function (data) {
            ctx.info(data.toString());
        });
        this.gitw.on('stderr', function (data) {
            ctx.info(data.toString());
        });
        _super.call(this, ctx, endpoint);
    }
    GitScmProvider.prototype.setAuthorization = function (authorization) {
        if (authorization && authorization['scheme']) {
            var scheme = authorization['scheme'];
            this.ctx.info('Using auth scheme: ' + scheme);
            switch (scheme) {
                case 'UsernamePassword':
                    this.username = this.getAuthParameter(authorization, 'Username') || 'not supplied';
                    this.password = this.getAuthParameter(authorization, 'Password') || 'not supplied';
                    break;
                default:
                    this.ctx.warning('invalid auth scheme: ' + scheme);
            }
        }
    };
    GitScmProvider.prototype.getCode = function () {
        var _this = this;
        if (!this.endpoint) {
            throw (new Error('endpoint not set.  initialize not called'));
        }
        this.ctx.info(this.endpoint.url);
        // encodes projects and repo names with spaces
        var gu = url.parse(this.endpoint.url);
        if (this.username && this.password) {
            gu.auth = this.username + ':' + this.password;
        }
        var giturl = gu.format(gu);
        var folder = path.basename(this.targetPath);
        // figure out ref
        var srcVersion = this.ctx.jobInfo.jobMessage.environment.variables['build.sourceVersion'];
        var srcBranch = this.ctx.jobInfo.jobMessage.environment.variables['build.sourceBranch'];
        this.ctx.info('srcVersion: ' + srcVersion);
        this.ctx.info('srcBranch: ' + srcBranch);
        var selectedRef;
        var isPullRequest = this._isPullRequest(srcBranch);
        if (isPullRequest) {
            selectedRef = srcBranch;
        }
        else {
            selectedRef = srcVersion ? srcVersion : srcBranch;
        }
        var inputref = "refs/heads/master";
        if (selectedRef && selectedRef.trim().length > 0) {
            inputref = selectedRef;
        }
        // if branch, we want to clone remote branch name to avoid tracking etc.. ('/refs/remotes/...')
        var ref = _translateRef(inputref);
        this.ctx.info('Using ref: ' + ref);
        var gopt = {
            creds: true,
            debugOutput: this.debugOutput
        };
        this.gitw.username = this.username;
        this.gitw.password = this.password;
        return Q(0)
            .then(function (code) {
            if (!_this.enlistmentExists()) {
                return _this.gitw.clone(giturl, true, folder, gopt).then(function (result) {
                    if (isPullRequest) {
                        // clone doesn't pull the refs/pull namespace, so fetch it
                        shell.cd(_this.targetPath);
                        return _this.gitw.fetch(['origin', srcBranch], gopt);
                    }
                    else {
                        return Q(result);
                    }
                });
            }
            else {
                shell.cd(_this.targetPath);
                return _this.gitw.remote(['set-url', 'origin', giturl], gopt)
                    .then(function (code) {
                    var fetchArgs = [];
                    if (isPullRequest) {
                        fetchArgs.push('origin');
                        fetchArgs.push(srcBranch);
                    }
                    return _this.gitw.fetch(fetchArgs, gopt);
                });
            }
        })
            .then(function (code) {
            shell.cd(_this.targetPath);
            if (isPullRequest) {
                ref = srcVersion;
            }
            return _this.gitw.checkout(ref, gopt);
        })
            .then(function (code) {
            if (_this.endpoint.data['checkoutSubmodules'] === "True") {
                _this.ctx.info('Updating Submodules');
                shell.cd(_this.targetPath);
                return _this.gitw.submodule(['init'])
                    .then(function (code) {
                    return _this.gitw.submodule(['update']);
                });
            }
            else {
                return Q(0);
            }
        });
        // security delete-internet-password -s <account>.visualstudio.com
    };
    GitScmProvider.prototype.clean = function () {
        var _this = this;
        if (this.enlistmentExists()) {
            shell.cd(this.targetPath);
            return this.gitw.clean(['-fdx'])
                .then(function (code) {
                return _this.gitw.reset(['--hard']);
            });
        }
        else {
            this.ctx.debug('skipping clean since repo does not exist');
            return Q(0);
        }
    };
    GitScmProvider.prototype._isPullRequest = function (branch) {
        return !!branch && (branch.toLowerCase().startsWith(PullRefsPrefix) || branch.toLowerCase().startsWith(PullRefsOriginPrefix));
    };
    return GitScmProvider;
})(scmm.ScmProvider);
exports.GitScmProvider = GitScmProvider;
