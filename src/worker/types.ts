export type FileData = string | Uint8Array;

export interface SourceLocation {
    line: number;
    label?: string;
    path?: string;
    start?: number;
    end?: number;
    segment?: string;
    func?: string;
}

// actually it's a kind of SourceSnippet .. can have multiple per line
export interface SourceLine extends SourceLocation {
    offset: number;
    insns?: string;
    iscode?: boolean;
    cycles?: number;
}

export class SourceFile {
    lines: SourceLine[];
    text: string;
    offset2loc: Map<number, SourceLine>; //{[offset:number]:number};
    line2offset: Map<number, number>; //{[line:number]:number};

    constructor(lines: SourceLine[], text: string) {
        lines = lines || [];

        this.lines = lines;
        this.text = text;
        this.offset2loc = new Map();
        this.line2offset = new Map();

        for (var info of lines) {
            if (info.offset >= 0) {
                // first line wins (is assigned to offset)
                if (!this.offset2loc[info.offset])
                    this.offset2loc[info.offset] = info;
                if (!this.line2offset[info.line])
                    this.line2offset[info.line] = info.offset;
            }
        }
    }

    findLineForOffset(PC: number, lookbehind: number) {
        if (this.offset2loc) {
            for (var i = 0; i <= lookbehind; i++) {
                var loc = this.offset2loc[PC];

                if (loc) {
                    return loc;
                }

                PC--;
            }
        }

        return null;
    }

    lineCount(): number {
        return this.lines.length;
    }
}

export interface Dependency {
    path: string
    filename: string
    link: boolean
    data: FileData
}

export interface WorkerFileUpdate {
    path: string
    data: FileData
}

export interface WorkerBuildStep {
    path?: string
    files?: string[]
    platform: string
    tool: string
    mainfile?: boolean
}

export interface WorkerItemUpdate {
    key: string
    value: object
}

export interface WorkerMessage {
    preload?: string
    platform?: string
    tool?: string
    updates: WorkerFileUpdate[]
    buildsteps: WorkerBuildStep[]
    reset?: boolean
    code?: string
    setitems?: WorkerItemUpdate[]
}

export interface WorkerError extends SourceLocation {
    msg: string,
}

export interface CodeListing {
    lines: SourceLine[]
    asmlines?: SourceLine[]
    text?: string
    sourcefile?: SourceFile   // not returned by worker
    assemblyfile?: SourceFile  // not returned by worker
}

export type CodeListingMap = { [path: string]: CodeListing };

export type Segment = { name: string, start: number, size: number, last?: number, type?: string };

export type WorkerResult =
    WorkerErrorResult
    | WorkerOutputResult<any>
    | WorkerUnchangedResult;

export interface WorkerUnchangedResult {
    unchanged: true;
}

export interface WorkerErrorResult {
    errors: WorkerError[]
    listings?: CodeListingMap
}

export interface WorkerOutputResult<T> {
    output: T
    listings?: CodeListingMap
    symbolmap?: { [sym: string]: number }
    params?: {}
    segments?: Segment[]
    debuginfo?: {} // optional info
}

export function isOutputResult(result: WorkerResult): result is WorkerOutputResult<any> {
    return ('output' in result);
}

export interface WorkingStore {
    getFileData(path: string): FileData;
}