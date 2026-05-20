import Dockerode from "dockerode";

const docker = new Dockerode();

export interface ContainerInfo{
    containerId:string;
    host:string;
    port:number;
}

/**
 * Creates and starts the runtime container with full isolation config.
 * Returns the host and the randomly-assigned host port mapped to container port 8080.
 */

export async function startContainer(
    submissionId:string,
    imageTag:string,
): Promise<ContainerInfo> {
    console.log(`[sandbox] starting container for ${submissionId} with image ${imageTag}`);

    const container= await docker.createContainer({
        name:`submission-${submissionId}`,
        Image:imageTag,
        ExposedPorts:{'8080/tcp':{}},
        HostConfig:{

            // ── Memory & CPU limits ────────────────────────────────────────
            Memory: 536_870_912,          // 512 MB hard cap — OOM kill if exceeded
            MemorySwap: 536_870_912,      // disable swap (swap = Memory cap)
            NanoCpus: 1_000_000_000,      // 1 vCPU max
            CpusetCpus: '0',             // pin to core 0 (adjust if multi-core host)
            // ── Filesystem isolation ───────────────────────────────────────
            ReadonlyRootfs: true,         // immutable filesystem — no writes at runtime
            // ── Capability dropping ────────────────────────────────────────
            CapDrop: ['ALL'],             // drop ALL Linux capabilities
            SecurityOpt: ['no-new-privileges'], // prevent privilege escalation
            // ── Network isolation ──────────────────────────────────────────
            NetworkMode: 'sandbox-net',   // isolated bridge — no internet access
            // ── Process limits ─────────────────────────────────────────────
            PidsLimit: 100,               // prevent fork bombs
            // ── File descriptor limits ─────────────────────────────────────
            Ulimits: [{ Name: 'nofile', Soft: 256, Hard: 256 }],
            // ── Port mapping — 0 = let Docker pick a random available host port
            PortBindings: {
                '8080/tcp': [{ HostPort: '0' }],
            },
        },
    });

    await container.start();

    console.log(`[sandbox] container ${container.id} started successfully`);

    const info= await container.inspect();
    // const hostPort=parseInt(
    //     info.NetworkSettings.Ports['8080/tcp']?.[0]?.HostPort?? '0',
    //     10,
    // );

    // if(!hostPort){
    //     throw new Error(`[sandbox] failed to get host port for ${submissionId}`);
    // }
    const containerIp =
    info.NetworkSettings.Networks['sandbox-net']?.IPAddress;

    if (!containerIp) {
        throw new Error(
            `[sandbox] failed to get container IP for ${submissionId}`
        );
    }

    return {
        containerId:container.id,
        host:containerIp,
        port:8080,
    };

}


/**
 * Stops and removes a container by ID.
 * Called on error cleanup or when submission-stopped event is received.
 */

export async function removeContainer(containerId:string):Promise<void>{
    try{
        const container=docker.getContainer(containerId);
        await container.stop({ t:5 });
        await container.remove({ v:true, force:true });
        console.log(`[sandbox] container ${containerId} removed successfully`);
    }catch(error){
        console.error(`[sandbox] failed to remove container ${containerId}:`, error);
        throw new Error(`Failed to remove container ${containerId}`);
    }
}