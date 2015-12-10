import Q = require('q');
import scmm = require('./lib/scmprovider');
import gitwm = require('./lib/gitwrapper');
import cm = require('../common');
import agentifm = require('vso-node-api/interfaces/TaskAgentInterfaces');

var path = require('path');
var shell = require('shelljs');
var url = require('url');

var PullRefsPrefix = "refs/pull/";
var PullRefsOriginPrefix = "refs/remotes/origin/pull/";

export function getProvider(ctx: cm.IExecutionContext, endpoint: agentifm.ServiceEndpoint): cm.IScmProvider {
	return new GitScmProvider(ctx, endpoint);
}

function _translateRef(ref) {
    var brPre = 'refs/heads/';
    if (ref.startsWith(brPre)) {
        ref = 'refs/remotes/origin/' + ref.substr(brPre.length, ref.length - brPre.length);
    }

    return ref;
}

// TODO: take options with stdout and stderr streams for testing?

export class GitScmProvider extends scmm.ScmProvider {
	constructor(ctx: cm.IExecutionContext, endpoint: agentifm.ServiceEndpoint) {
		this.gitw = new gitwm.GitWrapper();
		this.gitw.on('stdout', (data) => {
			ctx.info(data.toString());
		});

		this.gitw.on('stderr', (data) => {
			ctx.info(data.toString());
		});

		super(ctx, endpoint);
	}

	public username: string;
	public password: string;
	public gitw: gitwm.GitWrapper;

    public setAuthorization(authorization: agentifm.EndpointAuthorization) {
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
    }

	public getCode(): Q.Promise<number> {
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
	    
        var selectedRef: string;
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

	    var gopt = <gitwm.IGitExecOptions>{
	    	creds: true,
	    	debugOutput: this.debugOutput
	    }

	    this.gitw.username = this.username;
	    this.gitw.password = this.password;

        return Q(0)
        .then((code: number) => {
	        if (!this.enlistmentExists()) {
	        	return this.gitw.clone(giturl, true, folder, gopt).then((result: number) => {
                    if (isPullRequest) {
                        // clone doesn't pull the refs/pull namespace, so fetch it
                        shell.cd(this.targetPath);
                        return this.gitw.fetch(['origin', srcBranch], gopt);
                    }
                    else {
                        return Q(result);
                    }
                });
	        }
	        else {
	        	shell.cd(this.targetPath);

	        	return this.gitw.remote(['set-url', 'origin', giturl], gopt)
                .then((code: number) => {
                    var fetchArgs = [];
                    if (isPullRequest) {
                        fetchArgs.push('origin');
                        fetchArgs.push(srcBranch);
                    }
                    return this.gitw.fetch(fetchArgs, gopt);
                })
	        }
        })
        .then((code: number) => {
            shell.cd(this.targetPath);
            if (isPullRequest) {
                ref = srcVersion;
            }
            
            return this.gitw.checkout(ref, gopt);
        })
        .then((code: number) => {
        	if (this.endpoint.data['checkoutSubmodules'] === "True") {
        		this.ctx.info('Updating Submodules');
        		shell.cd(this.targetPath);
        		return this.gitw.submodule(['init'])
        		.then((code: number) => {
        			return this.gitw.submodule(['update']);
        		})
        	}
        	else {
        		return Q(0);
        	}
        })

		// security delete-internet-password -s <account>.visualstudio.com

	}

	public clean(): Q.Promise<number> {
		if (this.enlistmentExists()) {
			shell.cd(this.targetPath);
			return this.gitw.clean(['-fdx'])
			.then((code: number) => {
				return this.gitw.reset(['--hard']);
			})
		}
		else {
			this.ctx.debug('skipping clean since repo does not exist');
			return Q(0);
		}
	}	

    private _isPullRequest(branch: string): boolean {
        return !!branch && (branch.toLowerCase().startsWith(PullRefsPrefix) || branch.toLowerCase().startsWith(PullRefsOriginPrefix));
    }
}