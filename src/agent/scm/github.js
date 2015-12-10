var gitm = require('./git');
function getProvider(ctx, endpoint) {
    return new gitm.GitScmProvider(ctx, endpoint);
}
exports.getProvider = getProvider;
