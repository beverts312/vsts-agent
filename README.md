For vso-agent documentation visit Microsoft's repo: https://github.com/microsoft/vso-agent  

Fully configurable via environmental variables:
    - VSTS_USERNAME= user  
    - VSTS_PASSWORD= pass  
    - URL=https://<yourpath>.visualstudio.com  
    - POOL= pool  
The agent name is configurable via the container hostname.  
See [docker-compose.yml](docker-compose.yml) for an example compose file you could use to start your agent.  

This image is built on alpine and has: docker, bash, git, and node installed in it. 
You can use this image as a base image if you require additional dependencies (i.e maven, java, ruby), see this [Dockerfile](ansible/Dockerfile) for an example.  
If you wish to do things like "docker build" with your agent you will need to run as privileged.  

Because of the way that the agent natively process inputs I had to hack around the agent to make it work without the prompt. Because of this I will need to manually merge changes to the actual agent into my image manually, this may result in the agent occasionally being a version behind.
