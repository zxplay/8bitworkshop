import {
    CodeProject,
    createNewPersistentStore,
    LocalForageFilesystem,
    OverlayFilesystem,
    ProjectFilesystem,
    WebPresetsFileSystem
} from "./project";
import {ProjectWindows} from "./windows";
import {Preset, EmuState} from "./emulator/debug";
import {ZXWASMPlatform} from "./emulator/zx_platform";
import {EmuHalt} from "./emulator/error";
import {Toolbar} from "./toolbar";
import {getFilenameForPath, getFilenamePrefix, hex} from "./util";
import {StateRecorderImpl} from "./emulator/recorder";
import Split = require('split.js');
import {ListingView, SourceEditor} from "./editors";
import {DisassemblerView} from "./views/disassembly";
import {BinaryFileView} from "./views";
import {MemoryView} from "./views/memory_browser";
import {MemoryMapView} from "./views/memory_map";
import {AddressHeatMapView} from "./views/memory_probe";
import {ProbeLogView} from "./views/probe_log";
import {ScanlineIOView} from "./views/scanline_io";
import {ProbeSymbolView} from "./views/symbol_profiler";
import {FrameCallsView} from "./views/frame_profiler";
import {DebugBrowserView} from "./views/debug_tree";
import {saveAs} from "file-saver";
import {DebugSymbols, DebugEvalCondition} from "./emulator/debug";
import {WorkerError, WorkerResult} from "./worker/defs_build_result";

declare var $: JQueryStatic;

// Global variables
export var platform: ZXWASMPlatform; // emulator object
export var current_project: CodeProject;
export var projectWindows: ProjectWindows;	// window manager
export var compparams; // received build params from worker
export var lastDebugState: EmuState; // last debug state (object)

interface UIQueryString {
    file?: string;
}

function decodeQueryString(qs: string): {} {
    if (qs.startsWith('?')) qs = qs.substr(1);
    var a = qs.split('&');

    if (!a || a.length == 0) {
        return {};
    }

    var b = {};
    for (var i = 0; i < a.length; ++i) {
        var p = a[i].split('=', 2);

        if (p.length == 1) {
            b[p[0]] = "";
        } else {
            b[p[0]] = decodeURIComponent(p[1].replace(/\+/g, " "));
        }
    }

    return b;
}

const qs: UIQueryString = decodeQueryString(window.location.search || '?') as UIQueryString;
const toolbar = $("#controls_top");

let PRESETS: Preset[];
let uitoolbar: Toolbar;
let stateRecorder: StateRecorderImpl;
let userPaused: boolean; // did user explicitly pause?
let current_output: any; // current ROM (or other object)
let current_preset: Preset; // current preset object (if selected)
let store: LocalForage; // persistent fileStore
let lastDebugInfo; // last debug info (CPU text)
let debugTickPaused = false;
let recorderActive = false;
let lastViewClicked = null;
let errorWasRuntime = false;
let lastBreakExpr = "c.PC == 0x6000";

const TOOL_TO_SOURCE_STYLE = {
    'z80asm': 'z80',
    'sdasz80': 'z80',
    'sdcc': 'text/x-csrc',
    'zmac': 'z80',
}

function alertError(s: string) {
    setWaitDialog(false);
    bootbox.alert({
        title: '<span class="glyphicon glyphicon-alert" aria-hidden="true"></span> Alert',
        message: s
    });
}

function newWorker(): Worker {
    return new Worker("./dist/worker.js");
}

function getCurrentPresetTitle(): string {
    if (!current_preset) {
      return current_project.mainFilename || "ROM";
    } else {
      return current_preset.title || current_preset.name || current_project.mainFilename || "ROM";
    }
}

async function newFilesystem() {
    var basefs: ProjectFilesystem = new WebPresetsFileSystem();
    return new OverlayFilesystem(basefs, new LocalForageFilesystem(store));
}

async function initProject() {
    var filesystem = await newFilesystem();

    current_project = new CodeProject(newWorker(), platform, filesystem);
    projectWindows = new ProjectWindows($("#workspace")[0] as HTMLElement, current_project);

    current_project.callbackBuildResult = (result: WorkerResult) => {
        setCompileOutput(result);
    };

    current_project.callbackBuildStatus = (busy: boolean) => {
        setBusyStatus(busy);
    };
}

function setBusyStatus(busy: boolean) {
    if (busy) {
        toolbar.addClass("is-busy");
    } else {
        toolbar.removeClass("is-busy");
    }

    $('#compile_spinner').css('visibility', busy ? 'visible' : 'hidden');
}

function refreshWindowList() {
    var ul = $("#windowMenuList").empty();
    var separate = false;

    function addWindowItem(id, name, createfn) {
        if (separate) {
            ul.append(document.createElement("hr"));
            separate = false;
        }

        var li = document.createElement("li");
        var a = document.createElement("a");

        a.setAttribute("class", "dropdown-item");
        a.setAttribute("href", "#");

        a.setAttribute("data-wndid", id);
        if (id == projectWindows.getActiveID()) {
            $(a).addClass("dropdown-item-checked");
        }

        a.appendChild(document.createTextNode(name));
        li.appendChild(a);
        ul.append(li);

        if (createfn) {
            var onopen = (id, wnd) => {
                ul.find('a').removeClass("dropdown-item-checked");
                $(a).addClass("dropdown-item-checked");
            };

            projectWindows.setCreateFunc(id, createfn);
            projectWindows.setShowFunc(id, onopen);

            $(a).click((e) => {
                projectWindows.createOrShow(id);
                lastViewClicked = id;
            });
        }
    }

    function loadEditor(path: string) {
        var tool = platform.getToolForFilename(path);
        var mode = tool && TOOL_TO_SOURCE_STYLE[tool];
        return new SourceEditor(path, mode);
    }

    function addEditorItem(id: string) {
        addWindowItem(id, getFilenameForPath(id), () => {
            var data = current_project.getFile(id);
            if (typeof data === 'string') {
                return loadEditor(id);
            } else if (data instanceof Uint8Array) {
                return new BinaryFileView(id, data as Uint8Array);
            }
        });
    }

    // add main file editor
    addEditorItem(current_project.mainFilename);

    // add other source files
    current_project.iterateFiles((id, text) => {
        if (text && id != current_project.mainFilename) {
            addEditorItem(id);
        }
    });

    // add listings
    separate = true;
    var listings = current_project.getListings();
    if (listings) {
        for (var lstfn in listings) {
            var lst = listings[lstfn];

            // add listing if source/assembly file exists and has text
            if ((lst.assemblyfile && lst.assemblyfile.text) || (lst.sourcefile && lst.sourcefile.text)) {
                addWindowItem(lstfn, getFilenameForPath(lstfn), (path) => {
                    return new ListingView(path);
                });
            }
        }
    }

    separate = true;

    addWindowItem("#disasm", "Disassembly", () => {
        return new DisassemblerView();
    });

    addWindowItem("#memory", "Memory Browser", () => {
        return new MemoryView();
    });

    if (current_project.segments && current_project.segments.length) {
        addWindowItem("#memmap", "Memory Map", () => {
            return new MemoryMapView();
        });
    }

    if (platform.startProbing) {
        addWindowItem("#memheatmap", "Memory Probe", () => {
            return new AddressHeatMapView();
        });

        addWindowItem("#probelog", "Probe Log", () => {
            return new ProbeLogView();
        });

        addWindowItem("#scanlineio", "Scanline I/O", () => {
            return new ScanlineIOView();
        });

        addWindowItem("#symbolprobe", "Symbol Profiler", () => {
            return new ProbeSymbolView();
        });

        addWindowItem("#framecalls", "Frame Profiler", () => {
            return new FrameCallsView();
        });
    }

    addWindowItem("#debugview", "Debug Tree", () => {
        return new DebugBrowserView();
    });
}

function loadMainWindow(filename: string) {

    // we need this to build create functions for the editor
    refreshWindowList();

    // show main file
    projectWindows.createOrShow(filename);

    // build project
    current_project.setMainFilename(filename);
}

async function loadProject(filename: string) {

    // set current file ID
    current_project.mainFilename = filename;

    // load files from storage or web URLs
    var result = await current_project.loadFiles([filename]);
    console.assert(result && result.length);
    measureTimeLoad = new Date(); // for timing calc.
    loadMainWindow(filename);
}

function reloadProject(id: string) {
    qs.file = id;
    gotoNewLocation();
}

function getCurrentMainFilename(): string {
    return getFilenameForPath(current_project.mainFilename);
}

function _downloadROMImage(e) {
    if (current_output == null) {
        alertError("Please finish compiling with no errors before downloading ROM.");
        return true;
    }

    var prefix = getFilenamePrefix(getCurrentMainFilename());
    if (current_output instanceof Uint8Array) {
        var blob = new Blob([current_output], {type: "application/octet-stream"});
        var suffix = "-zx.bin";
        saveAs(blob, prefix + suffix);
    } else {
        alertError(`The platform doesn't have downloadable ROMs.`);
    }
}

function populateExamples(sel) {
    var files = {};

    for (var i = 0; i < PRESETS.length; i++) {
        var preset = PRESETS[i];
        var name = preset.chapter ? (preset.chapter + ". " + preset.name) : preset.name;
        var isCurrentPreset = preset.id == current_project.mainFilename;

        sel.append($("<option />").val(preset.id).text(name).attr('selected', isCurrentPreset ? 'selected' : null));

        if (isCurrentPreset) {
            current_preset = preset;
        }

        files[preset.id] = name;
    }

    return files;
}

async function populateFiles(sel: JQuery, category: string, prefix: string, foundFiles: {}) {
    var keys = await store.keys();
    var numFound = 0;

    if (!keys) {
        keys = [];
    }

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];

        if (key.startsWith(prefix) && !foundFiles[key]) {
            if (numFound++ == 0) {
                sel.append($("<option />").text("------- " + category + " -------").attr('disabled', 'true'));
            }

            var name = key.substring(prefix.length);
            sel.append($("<option />").val(key).text(name).attr('selected', (key == current_project.mainFilename) ? 'selected' : null));
        }
    }
}

function finishSelector(sel) {
    sel.css('visibility', 'visible');

    // create option if not selected
    var main = current_project.mainFilename;
    if (sel.val() != main) {
        sel.append($("<option />").val(main).text(main).attr('selected', 'selected'));
    }
}

async function updateSelector() {
    var sel = $("#preset_select").empty();

    // normal: examples, and local files

    var foundFiles = populateExamples(sel);
    await populateFiles(sel, "Local Files", "", foundFiles);
    finishSelector(sel);

    // set click handlers
    sel.off('change').change(function (e) {
        reloadProject($(this).val().toString());
    });
}

function getErrorElement(err: WorkerError) {
    var span = $('<p/>');

    if (err.path != null) {
        var s = err.line ? err.label ? `(${err.path} @ ${err.label})` : `(${err.path}:${err.line})` : `(${err.path})`
        var link = $('<a/>').text(s);
        var path = err.path;

        if (path == getCurrentMainFilename()) {
            path = current_project.mainFilename;
        }

        // click link to open file, if it's available...
        if (projectWindows.isWindow(path)) {
            link.click((ev) => {
                var wnd = projectWindows.createOrShow(path);
                if (wnd instanceof SourceEditor) {
                    wnd.setCurrentLine(err, true);
                }
            });
        }

        span.append(link);
        span.append('&nbsp;');
    }

    span.append($('<span/>').text(err.msg));
    return span;
}

function hideErrorAlerts() {
    $("#error_alert").hide();
    errorWasRuntime = false;
}

function showErrorAlert(errors: WorkerError[], runtime: boolean) {
    var div = $("#error_alert_msg").empty();

    for (var err of errors.slice(0, 10)) {
        div.append(getErrorElement(err));
    }

    $("#error_alert").show();
    errorWasRuntime = runtime;
}

function showExceptionAsError(err, msg: string) {
    if (msg != null) {
        var werr: WorkerError = {msg: msg, line: 0};

        if (err instanceof EmuHalt && err.$loc) {
            werr = Object.create(err.$loc);
            werr.msg = msg;
            console.log(werr);
        }

        showErrorAlert([werr], true);
    }
}

var measureTimeStart: Date = new Date();
var measureTimeLoad: Date;

function measureBuildTime() {
    if (measureTimeLoad) {
        var measureTimeBuild = new Date();
        console.log('load time', measureTimeLoad.getTime() - measureTimeStart.getTime());
        console.log('build time', measureTimeBuild.getTime() - measureTimeLoad.getTime());
        measureTimeLoad = null; // only measure once
    }
}

async function setCompileOutput(data: WorkerResult) {

    // errors? mark them in editor
    if ('errors' in data && data.errors.length > 0) {
        toolbar.addClass("has-errors");
        projectWindows.setErrors(data.errors);
        refreshWindowList(); // to make sure windows are created for showErrorAlert()
        showErrorAlert(data.errors, false);
    } else {
        toolbar.removeClass("has-errors"); // may be added in next callback
        projectWindows.setErrors(null);
        hideErrorAlerts();

        // exit if compile output unchanged
        if (data == null || ('unchanged' in data && data.unchanged)) {
            return;
        }

        // make sure it's a WorkerOutputResult
        if (!('output' in data)) {
            return;
        }

        // process symbol map
        platform.debugSymbols = new DebugSymbols(data.symbolmap, data.debuginfo);
        compparams = data.params;

        // load ROM
        var rom = data.output;
        if (rom != null) {
            try {
                clearBreakpoint(); // so we can replace memory
                _resetRecording();
                await platform.loadROM(getCurrentPresetTitle(), rom);
                current_output = rom;

                if (!userPaused) {
                    _resume();
                }

                measureBuildTime();
            } catch (e) {
                console.log(e);
                toolbar.addClass("has-errors");
                showExceptionAsError(e, e + "");
                current_output = null;
                refreshWindowList();
                return;
            }
        }

        // update all windows (listings)
        refreshWindowList();
        projectWindows.refresh(false);
    }
}

function hideDebugInfo() {
    var meminfo = $("#mem_info");
    meminfo.hide();
    lastDebugInfo = null;
}

function setDebugButtonState(btnid: string, btnstate: string) {
    $("#debug_bar, #run_bar").find("button").removeClass("btn_active").removeClass("btn_stopped");
    $("#dbg_" + btnid).addClass("btn_" + btnstate);
}

function isPlatformReady() {
    return platform && current_output != null;
}

function checkRunReady() {
    if (!isPlatformReady()) {
        alertError("Can't do this until build successfully completes.");
        return false;
    } else {
        return true;
    }
}

function openRelevantListing(state: EmuState) {

    // if we clicked on another window, retain it
    if (lastViewClicked != null) return;

    // has to support disassembly, at least
    if (!platform.disassemble) return;

    // search through listings
    var listings = current_project.getListings();
    var bestid = "#disasm";
    var bestscore = 32;

    if (listings) {
        var pc = state.c ? (state.c.EPC || state.c.PC) : 0;
        for (var lstfn in listings) {
            var lst = listings[lstfn];
            var file = lst.assemblyfile || lst.sourcefile;

            // pick either listing or source file
            var wndid = current_project.filename2path[lstfn] || lstfn;
            if (file == lst.sourcefile) wndid = projectWindows.findWindowWithFilePrefix(lstfn);

            // does this window exist?
            if (projectWindows.isWindow(wndid)) {
                var res = file && file.findLineForOffset(pc, 32);
                if (res && pc - res.offset < bestscore) {
                    bestid = wndid;
                    bestscore = pc - res.offset;
                }
                //console.log(hex(pc,4), wndid, lstfn, bestid, bestscore);
            }
        }
    }

    // if no appropriate listing found, use disassembly view
    projectWindows.createOrShow(bestid, true);
}

function uiDebugCallback(state: EmuState) {
    lastDebugState = state;
    openRelevantListing(state);
    projectWindows.refresh(true); // move cursor
    debugTickPaused = true;
}

function setupDebugCallback(btnid?: string) {
    platform.setupDebug((state: EmuState, msg: string) => {
        uiDebugCallback(state);
        setDebugButtonState(btnid || "pause", "stopped");
        msg && showErrorAlert([{msg: "STOPPED: " + msg, line: 0}], true);
    });
}

function setupBreakpoint(btnid?: string) {
    if (!checkRunReady()) {
        return;
    }

    _disableRecording();
    setupDebugCallback(btnid);

    if (btnid) {
        setDebugButtonState(btnid, "active");
    }
}

function _pause() {
    if (platform && platform.isRunning()) {
        platform.pause();
        console.log("Paused");
    }

    setDebugButtonState("pause", "stopped");
}

function pause() {
    if (!checkRunReady()) {
        return;
    }

    clearBreakpoint();
    _pause();

    userPaused = true;
}

function _resume() {
    if (!platform.isRunning()) {
        platform.resume();
        console.log("Resumed");
    }

    setDebugButtonState("go", "active");

    if (errorWasRuntime) {
        hideErrorAlerts();
    }
}

function resume() {
    if (!checkRunReady()) {
        return;
    }

    clearBreakpoint();

    if (!platform.isRunning()) {
        projectWindows.refresh(false);
    }

    _resume();
    userPaused = false;
    lastViewClicked = null;
}

function singleStep() {
    if (!checkRunReady()) {
        return;
    }

    setupBreakpoint("step");
    platform.step();
}

function singleFrameStep() {
    if (!checkRunReady()) {
        return;
    }

    setupBreakpoint("tovsync");
    platform.runToVsync();
}

function getEditorPC(): number {
    var wnd = projectWindows.getActive();
    return wnd && wnd.getCursorPC && wnd.getCursorPC();
}

export function runToPC(pc: number) {
    if (!checkRunReady() || !(pc >= 0)) {
        return;
    }

    setupBreakpoint("toline");
    console.log("Run to", pc.toString(16));
    platform.runToPC(pc);
}

function runToCursor() {
    runToPC(getEditorPC());
}

function runUntilReturn() {
    if (!checkRunReady()) {
        return;
    }

    setupBreakpoint("stepout");
    platform.runUntilReturn();
}

function runStepBackwards() {
    if (!checkRunReady()) {
        return;
    }

    setupBreakpoint("stepback");
    platform.stepBack();
}

function clearBreakpoint() {
    lastDebugState = null;
    platform.clearDebug();
    setupDebugCallback(); // in case of BRK/trap
}

function resetPlatform() {
    platform.reset();
    _resetRecording();
}

function resetAndRun() {
    if (!checkRunReady()) {
        return;
    }

    clearBreakpoint();
    resetPlatform();
    _resume();
}

function resetAndDebug() {
    if (!checkRunReady()) {
        return;
    }

    var wasRecording = recorderActive;

    _disableRecording();

    clearBreakpoint();
    _resume();
    resetPlatform();
    setupBreakpoint("restart");

    platform.runEval((c) => {
        return true;
    });

    if (wasRecording) {
        _enableRecording();
    }
}

function _breakExpression() {
    var modal = $("#debugExprModal");
    var btn = $("#debugExprSubmit");

    $("#debugExprInput").val(lastBreakExpr);
    $("#debugExprExamples").text(getDebugExprExamples());

    modal.modal('show');

    btn.off('click').on('click', () => {
        var exprs = $("#debugExprInput").val() + "";
        modal.modal('hide');
        breakExpression(exprs);
    });
}

function getDebugExprExamples(): string {
    var state = platform.saveState && platform.saveState();
    var cpu = state.c;
    console.log(cpu, state);

    var s = '';
    if (cpu.PC) {
        s += "c.PC == 0x" + hex(cpu.PC) + "\n";
    }

    if (cpu.SP) {
        s += "c.SP < 0x" + hex(cpu.SP) + "\n";
    }

    if (cpu['HL']) {
        s += "c.HL == 0x4000\n";
    }

    if (platform.readAddress) { // NOTE: Always true.
        s += "this.readAddress(0x1234) == 0x0\n";
    }

    return s;
}

function breakExpression(exprs: string) {
    var fn = new Function('c', 'return (' + exprs + ');').bind(platform);
    setupBreakpoint();
    platform.runEval(fn as DebugEvalCondition);
    lastBreakExpr = exprs;
}

function updateDebugWindows() {
    if (platform.isRunning()) {
        projectWindows.tick();
        debugTickPaused = false;
    } else if (!debugTickPaused) { // final tick after pausing
        projectWindows.tick();
        debugTickPaused = true;
    }

    setTimeout(updateDebugWindows, 100);
}

function setWaitDialog(b: boolean) {
    if (b) {
        setWaitProgress(0);
        $("#pleaseWaitModal").modal('show');
    } else {
        setWaitProgress(1);
        $("#pleaseWaitModal").modal('hide');
    }
}

function setWaitProgress(prog: number) {
    $("#pleaseWaitProgressBar").css('width', (prog * 100) + '%').show();
}

function _disableRecording() {
    if (recorderActive) {
        platform.setRecorder(null);
        $("#dbg_record").removeClass("btn_recording");
        $("#replaydiv").hide();
        hideDebugInfo();
        recorderActive = false;
    }
}

function _resetRecording() {
    if (recorderActive) {
        stateRecorder.reset();
    }
}

function _enableRecording() {
    stateRecorder.reset();
    platform.setRecorder(stateRecorder);
    $("#dbg_record").addClass("btn_recording");
    $("#replaydiv").show();
    recorderActive = true;
}

function _toggleRecording() {
    if (recorderActive) {
        _disableRecording();
    } else {
        _enableRecording();
    }
}

function _lookupHelp() {
    window.open("https://worldofspectrum.org/faq/reference/reference.htm", "_help");
}

function setupDebugControls() {
    uitoolbar = new Toolbar($("#toolbar")[0], null);
    uitoolbar.grp.prop('id', 'run_bar');
    uitoolbar.add('ctrl+alt+r', 'Reset', 'glyphicon-refresh', resetAndRun).prop('id', 'dbg_reset');
    uitoolbar.add('ctrl+alt+,', 'Pause', 'glyphicon-pause', pause).prop('id', 'dbg_pause');
    uitoolbar.add('ctrl+alt+.', 'Resume', 'glyphicon-play', resume).prop('id', 'dbg_go');

    uitoolbar.newGroup();
    uitoolbar.grp.prop('id', 'debug_bar');
    uitoolbar.add('ctrl+alt+e', 'Reset and Debug', 'glyphicon-fast-backward', resetAndDebug).prop('id', 'dbg_restart');
    uitoolbar.add('ctrl+alt+b', 'Step Backwards', 'glyphicon-step-backward', runStepBackwards).prop('id', 'dbg_stepback');
    uitoolbar.add('ctrl+alt+s', 'Single Step', 'glyphicon-step-forward', singleStep).prop('id', 'dbg_step');
    uitoolbar.add('ctrl+alt+o', 'Step Out of Subroutine', 'glyphicon-hand-up', runUntilReturn).prop('id', 'dbg_stepout');
    uitoolbar.add('ctrl+alt+n', 'Next Frame/Interrupt', 'glyphicon-forward', singleFrameStep).prop('id', 'dbg_tovsync');
    uitoolbar.add('ctrl+alt+l', 'Run To Line', 'glyphicon-save', runToCursor).prop('id', 'dbg_toline');

    uitoolbar.newGroup();
    uitoolbar.grp.prop('id', 'xtra_bar');
    uitoolbar.add('ctrl+alt+?', 'Show Help', 'glyphicon-question-sign', _lookupHelp);
    uitoolbar.add('ctrl+alt+0', 'Start/Stop Replay Recording', 'glyphicon-record', _toggleRecording).prop('id', 'dbg_record');

    // add menu clicks
    $(".dropdown-menu").collapse({toggle: false});
    $("#item_debug_expr").click(_breakExpression).show();
    $("#item_download_rom").click(_downloadROMImage);

    updateDebugWindows();
    setupReplaySlider();
}

function setupReplaySlider() {
    var replayslider = $("#replayslider");
    var clockslider = $("#clockslider");
    var replayframeno = $("#replay_frame");
    var clockno = $("#replay_clock");

    var updateFrameNo = () => {
        replayframeno.text(stateRecorder.lastSeekFrame + "");
        clockno.text(stateRecorder.lastSeekStep + "");
    };

    var sliderChanged = (e) => {
        _pause();

        var frame: number = parseInt(replayslider.val().toString());
        var step: number = parseInt(clockslider.val().toString());

        if (stateRecorder.loadFrame(frame, step) >= 0) {
            clockslider.attr('min', 0);
            clockslider.attr('max', stateRecorder.lastStepCount);
            updateFrameNo();
            uiDebugCallback(platform.saveState());
        }
    };

    var setFrameTo = (frame: number) => {
        _pause();

        if (stateRecorder.loadFrame(frame) >= 0) {
            replayslider.val(frame);
            updateFrameNo();
            uiDebugCallback(platform.saveState());
        }
    };

    var setClockTo = (clock: number) => {
        _pause();

        var frame: number = parseInt(replayslider.val().toString());
        if (stateRecorder.loadFrame(frame, clock) >= 0) {
            clockslider.val(clock);
            updateFrameNo();
            uiDebugCallback(platform.saveState());
        }
    };

    stateRecorder.callbackStateChanged = () => {
        replayslider.attr('min', 0);
        replayslider.attr('max', stateRecorder.numFrames());
        replayslider.val(stateRecorder.currentFrame());
        clockslider.val(stateRecorder.currentStep());
        updateFrameNo();
        platform.saveState();
    };

    replayslider.on('input', sliderChanged);
    clockslider.on('input', sliderChanged);

    $("#replay_min").click(() => {
        setFrameTo(1)
    });

    $("#replay_max").click(() => {
        setFrameTo(stateRecorder.numFrames());
    });

    $("#replay_back").click(() => {
        setFrameTo(parseInt(replayslider.val().toString()) - 1);
    });

    $("#replay_fwd").click(() => {
        setFrameTo(parseInt(replayslider.val().toString()) + 1);
    });

    $("#clock_back").click(() => {
        setClockTo(parseInt(clockslider.val().toString()) - 1);
    });

    $("#clock_fwd").click(() => {
        setClockTo(parseInt(clockslider.val().toString()) + 1);
    });

    $("#replay_bar").show();
}

function globalErrorHandler(msgevent) {
    var err = msgevent.error || msgevent.reason;
    if (err != null && err instanceof EmuHalt) {
        haltEmulation(err);
    }
}

function haltEmulation(err?: EmuHalt) {
    _pause();
    emulationHalted(err);
}

function installErrorHandler() {
    window.addEventListener('error', globalErrorHandler);
    window.addEventListener('unhandledrejection', globalErrorHandler);
}

function uninstallErrorHandler() {
    window.removeEventListener('error', globalErrorHandler);
    window.removeEventListener('unhandledrejection', globalErrorHandler);
}

function gotoNewLocation(replaceHistory?: boolean) {
    uninstallErrorHandler();
    if (replaceHistory) {
        window.location.replace("?" + $.param(qs));
    } else {
        window.location.href = "?" + $.param(qs);
    }
}

function replaceURLState() {
    delete qs['']; // remove null parameter
    history.replaceState({}, "", "?" + $.param(qs));
}

function addPageFocusHandlers() {
    var hidden = false;

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState == 'hidden' && platform && platform.isRunning()) {
            _pause();
            hidden = true;
        } else if (document.visibilityState == 'visible' && hidden) {
            _resume();
            hidden = false;
        }
    });

    $(window).on("focus", () => {
        if (hidden) {
            _resume();
            hidden = false;
        }
    });

    $(window).on("blur", () => {
        if (platform && platform.isRunning()) {
            _pause();
            hidden = true;
        }
    });
}

function revealTopBar() {
    setTimeout(() => {
        $("#controls_dynamic").css('visibility', 'inherit');
    }, 250);
}

function setupSplits() {
    Split(['#sidebar', '#workspace', '#emulator'], {
        sizes: [12, 44, 44],
        minSize: [0, 250, 250],
        onDragEnd: () => {
            if (projectWindows) projectWindows.resize();
        },
    });
}

function emulationHalted(err: EmuHalt) {
    var msg = (err && err.message) || msg;
    showExceptionAsError(err, msg);
    projectWindows.refresh(false); // don't mess with cursor
}

async function startPlatform() {
    platform = new ZXWASMPlatform($("#emuscreen")[0]);
    stateRecorder = new StateRecorderImpl(platform);
    PRESETS = platform.getPresets ? platform.getPresets() : [];

    if (!qs.file) {
        // load first preset file, unless we're in a repo
        var defaultfile = PRESETS[0].id;
        qs.file = defaultfile || 'DEFAULT';
        if (!defaultfile) {
            alertError("There is no default main file for this project. Try selecting one from the pulldown.");
        }
    }

    // start platform and load file
    replaceURLState();
    installErrorHandler();
    await platform.start();
    await initProject();
    await loadProject(qs.file);
    setupDebugControls();
    addPageFocusHandlers();
    await updateSelector();
    revealTopBar();
}

async function loadAndStartPlatform() {
    try {
        await startPlatform();
        document.title = document.title + " - " + current_project.mainFilename;
    } catch (e) {
        console.log(e);
        alertError('Platform zx failed to load.');
    } finally {
        revealTopBar();
    }
}

export async function start() {
    setupSplits();

    // create fileStore
    store = createNewPersistentStore('zx');

    // load and start platform object
    await loadAndStartPlatform();
}

start();
