var Q = require('q');
var shell = require('shelljs');
var crypto = require('crypto');
var ScmProvider = (function () {
    function ScmProvider(ctx, endpoint) {
        this.ctx = ctx;
        this.endpoint = endpoint;
        this.job = ctx.jobInfo.jobMessage;
        this.variables = this.job.environment.variables;
    }
    ScmProvider.prototype.enlistmentExists = function () {
        return shell.test('-d', this.targetPath);
    };
    // should override if you need to process/store creds from the endpoint
    ScmProvider.prototype.setAuthorization = function (authorization) {
    };
    // override if it's more complex than just hashing the url
    ScmProvider.prototype.getHashKey = function () {
        var hash = null;
        if (this.endpoint.url) {
            var hashProvider = crypto.createHash("sha256");
            hashProvider.update(this.endpoint.url, 'utf8');
            hash = hashProvider.digest('hex');
        }
        return hash;
    };
    ScmProvider.prototype.initialize = function () {
        if (!this.ctx) {
            throw (new Error('executionContext null initializing git scm provider'));
        }
        if (!this.endpoint) {
            throw (new Error('endpoint null initializing git scm provider'));
        }
        this.setAuthorization(this.endpoint.authorization);
        this.hashKey = this.getHashKey();
    };
    ScmProvider.prototype.getAuthParameter = function (authorization, paramName) {
        var paramValue = null;
        if (authorization && authorization['parameters']) {
            paramValue = authorization['parameters'][paramName];
        }
        return paramValue;
    };
    // virtual - must override
    ScmProvider.prototype.getCode = function () {
        var defer = Q.defer();
        defer.reject(new Error('Must override the getCode method'));
        return defer.promise;
    };
    // virtual - must override
    ScmProvider.prototype.clean = function () {
        var defer = Q.defer();
        defer.reject(new Error('Must override the clean method'));
        return defer.promise;
    };
    return ScmProvider;
})();
exports.ScmProvider = ScmProvider;
