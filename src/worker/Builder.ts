import {BuildStep, WorkerError, WorkerMessage} from "./interfaces";
import {WorkerResult} from "./types";
import {store} from "./worker";
import {PLATFORM_PARAMS, TOOLS} from "./global_vars";
import {errorResult} from "./util";

export class Builder {
    steps: BuildStep[] = [];
    startseq: number = 0;

    async executeBuildSteps(): Promise<WorkerResult> {
        this.startseq = store.currentVersion();
        var linkstep: BuildStep = null;

        while (this.steps.length) {
            var step = this.steps.shift(); // get top of array
            var platform = step.platform;
            var toolfn = TOOLS[step.tool];

            if (!toolfn) {
                throw Error("no tool named " + step.tool);
            }

            step.params = PLATFORM_PARAMS['zx'];

            try {
                step.result = await toolfn(step);
            } catch (e) {
                console.log("EXCEPTION", e, e.stack);
                return errorResult(e + "");
            }

            if (step.result) {
                (step.result as any).params = step.params;

                // errors? return them
                if ('errors' in step.result && step.result.errors.length) {
                    applyDefaultErrorPath(step.result.errors, step.path);
                    return step.result;
                }

                // if we got some output, return it immediately
                if ('output' in step.result && step.result.output) {
                    return step.result;
                }

                // combine files with a link tool?
                if ('linktool' in step.result) {
                    if (linkstep) {
                        linkstep.files = linkstep.files.concat(step.result.files);
                        linkstep.args = linkstep.args.concat(step.result.args);
                    } else {
                        linkstep = {
                            tool: step.result.linktool,
                            platform: platform,
                            files: step.result.files,
                            args: step.result.args
                        };
                    }
                }

                // process with another tool?
                if ('nexttool' in step.result) {
                    var asmstep: BuildStep = {
                        tool: step.result.nexttool,
                        platform: platform,
                        ...step.result
                    }

                    this.steps.push(asmstep);
                }

                // process final step?
                if (this.steps.length == 0 && linkstep) {
                    this.steps.push(linkstep);
                    linkstep = null;
                }
            }
        }
    }

    async handleMessage(data: WorkerMessage): Promise<WorkerResult> {
        this.steps = [];

        // file updates
        if (data.updates) {
            data.updates.forEach((u) => store.putFile(u.path, u.data));
        }

        // object update
        if (data.setitems) {
            data.setitems.forEach((i) => store.setItem(i.key, i.value));
        }

        // build steps
        if (data.buildsteps) {
            this.steps.push.apply(this.steps, data.buildsteps);
        }

        // single-file
        if (data.code) {
            this.steps.push(data as BuildStep);
        }

        // execute build steps
        if (this.steps.length) {
            var result = await this.executeBuildSteps();
            return result ? result : {unchanged: true};
        }

        // message not recognized
        console.log("Unknown message", data);
    }
}

function applyDefaultErrorPath(errors: WorkerError[], path: string) {
    if (!path) {
        return;
    }

    for (var i = 0; i < errors.length; i++) {
        var err = errors[i];
        if (!err.path && err.line) {
            err.path = path;
        }
    }
}