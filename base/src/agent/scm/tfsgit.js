var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var gitm = require('./git');
function getProvider(ctx, endpoint) {
    return new GitTfsScmProvider(ctx, endpoint);
}
exports.getProvider = getProvider;
var GitTfsScmProvider = (function (_super) {
    __extends(GitTfsScmProvider, _super);
    function GitTfsScmProvider() {
        _super.apply(this, arguments);
    }
    // override since TfsGit uses the generated OAuth token
    GitTfsScmProvider.prototype.setAuthorization = function (authorization) {
        if (authorization && authorization['scheme']) {
            var scheme = authorization['scheme'];
            this.ctx.info('Using auth scheme: ' + scheme);
            switch (scheme) {
                case 'OAuth':
                    this.username = process.env['VSO_GIT_USERNAME'] || 'OAuth';
                    this.password = process.env['VSO_GIT_PASSWORD'] || this.getAuthParameter(authorization, 'AccessToken') || 'not supplied';
                    break;
                default:
                    this.ctx.warning('invalid auth scheme: ' + scheme);
            }
        }
    };
    return GitTfsScmProvider;
})(gitm.GitScmProvider);
exports.GitTfsScmProvider = GitTfsScmProvider;
