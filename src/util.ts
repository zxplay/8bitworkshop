export function lpad(s: string, n: number): string {
    s += ''; // convert to string

    while (s.length < n) {
      s = " " + s;
    }

    return s;
}

export function rpad(s: string, n: number): string {
    s += ''; // convert to string

    while (s.length < n) {
        s += " ";
    }

    return s;
}

export function getFilenameForPath(s: string): string {
    var toks = s.split('/');
    return toks[toks.length - 1];
}

export function getFolderForPath(s: string): string {
    return s.substring(0, s.lastIndexOf('/'));
}

export function getFilenamePrefix(s: string): string {
    var pos = s.lastIndexOf('.');
    return (pos > 0) ? s.substr(0, pos) : s;
}

export function hex(v: number, nd?: number) {
    if (!nd) {
        nd = 2;
    }

    if (nd == 8) {
        return hex((v >> 16) & 0xffff, 4) + hex(v & 0xffff, 4);
    } else {
        return toradix(v, nd, 16);
    }
}

export function tobin(v: number, nd?: number) {
    if (!nd) {
        nd = 8;
    }

    return toradix(v, nd, 2);
}

export function toradix(v: number, nd: number, radix: number) {
    try {
        var s = v.toString(radix).toUpperCase();

        while (s.length < nd) {
            s = "0" + s;
        }

        return s;
    } catch (e) {
        return v + "";
    }
}

export function arrayCompare(a: ArrayLike<any>, b: ArrayLike<any>): boolean {
    if (a == null && b == null) {
        return true;
    }

    if (a == null) {
        return false;
    }

    if (b == null) {
        return false;
    }

    if (a.length != b.length) {
        return false;
    }

    for (var i = 0; i < a.length; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }

    return true;
}

export function invertMap(m: {}): {} {
    var r = {};

    if (m) {
        for (var k in m) {
            r[m[k]] = k;
        }
    }

    return r;
}

export function highlightDifferences(s1: string, s2: string): string {
    var split1 = s1.split(/(\S+\s+)/).filter(function (n) {
        return n
    });

    var split2 = s2.split(/(\S+\s+)/).filter(function (n) {
        return n
    });

    var i = 0;
    var j = 0;
    var result = "";

    while (i < split1.length && j < split2.length) {
        var w1 = split1[i];
        var w2 = split2[j];

        if (w2 && w2.indexOf("\n") >= 0) {
            while (i < s1.length && split1[i].indexOf("\n") < 0) {
                i++;
            }
        }

        if (w1 != w2) {
            w2 = '<span class="hilite">' + w2 + '</span>';
        }

        result += w2;
        i++;
        j++;
    }

    while (j < split2.length) {
        result += split2[j++];
    }

    return result;
}

export function byteArrayToUTF8(data: number[] | Uint8Array): string {
    var str = "";

    var charLUT = new Array();
    for (var i = 0; i < 128; ++i) {
        charLUT[i] = String.fromCharCode(i);
    }

    var c;
    var len = data.length;

    for (var i = 0; i < len;) {
        c = data[i++];

        if (c < 128) {
            str += charLUT[c];
        } else {
            if ((c >= 192) && (c < 224)) {
                c = ((c & 31) << 6) | (data[i++] & 63);
            } else {
                c = ((c & 15) << 12) | ((data[i] & 63) << 6) | (data[i + 1] & 63);
                i += 2;

                if (c == 0xfeff) {
                    continue; // ignore BOM
                }
            }

            str += String.fromCharCode(c);
        }
    }

    return str;
}

export function isProbablyBinary(path: string, data?: number[] | Uint8Array): boolean {
    var score = 0;

    // check extensions
    if (path) {
        path = path.toUpperCase();
        const BINEXTS = ['.CHR', '.BIN', '.DAT', '.PAL', '.NAM', '.RLE', '.LZ4', '.NSF'];
        for (var ext of BINEXTS) {
            if (path.endsWith(ext)) {
                score++;
            }
        }
    }

    // decode as UTF-8
    for (var i = 0; i < (data ? data.length : 0);) {
        let c = data[i++];
        if ((c & 0x80) == 0) {

            // more likely binary if we see a NUL or obscure control character
            if (c < 9 || (c >= 14 && c < 26) || c == 0x7f) {
                score++;
                break;
            }
        } else {

            // look for invalid unicode sequences
            var nextra = 0;

            if ((c & 0xe0) == 0xc0) {
                nextra = 1;
            } else if ((c & 0xf0) == 0xe0) {
                nextra = 2;
            } else if ((c & 0xf8) == 0xf0) {
                nextra = 3;
            } else if (c < 0xa0) {
                score++;
            } else if (c == 0xff) {
                score++;
            }

            while (nextra--) {
                if (i >= data.length || (data[i++] & 0xc0) != 0x80) {
                    score++;
                    break;
                }
            }
        }
    }

    return score > 0;
}

export function printFlags(val: number, names: string[], r2l: boolean) {
    var s = '';

    for (var i = 0; i < names.length; i++) {
        if (names[i]) {
            var bit = 1 << (r2l ? (names.length - 1 - i) : i);

            if (i > 0) {
                s += " ";
            }

            s += (val & bit) ? names[i] : "-";
        }
    }

    return s;
}

export function RGBA(r: number, g: number, b: number) {
    return (r & 0xff) | ((g & 0xff) << 8) | ((b & 0xff) << 16) | 0xff000000;
}

export function clamp(minv: number, maxv: number, v: number) {
    return (v < minv) ? minv : (v > maxv) ? maxv : v;
}

export function safeident(s: string): string {
    return s.replace(/\W+/g, "_");
}

// firefox doesn't do GET with binary files
export function getWithBinary(url: string, success: (text: string | Uint8Array) => void, datatype: 'text' | 'arraybuffer') {
    var oReq = new XMLHttpRequest();
    oReq.open("GET", url, true);
    oReq.responseType = datatype;

    oReq.onload = function (oEvent) {
        if (oReq.status == 200) {
            var data = oReq.response;

            if (data instanceof ArrayBuffer) {
                data = new Uint8Array(data);
            }

            success(data);
        } else if (oReq.status == 404) {
            success(null);
        } else {
            throw Error("Error " + oReq.status + " loading " + url);
        }
    }

    oReq.onerror = function (oEvent) {
        success(null);
    }

    oReq.ontimeout = function (oEvent) {
        throw Error("Timeout loading " + url);
    }

    oReq.send(null);
}

// get platform ID without . emulator
export function getBasePlatform(platform: string): string {
    return platform.split('.')[0];
}

// get platform ID without - specialization
export function getRootPlatform(platform: string): string {
    return platform.split('-')[0];
}

// get platform ID without emulator or specialization
export function getRootBasePlatform(platform: string): string {
    return getRootPlatform(getBasePlatform(platform));
}

export function isArray(obj: any): obj is ArrayLike<any> {
    return obj != null && (Array.isArray(obj) || isTypedArray(obj));
}

export function isTypedArray(obj: any): obj is ArrayLike<number> {
    return obj != null && obj['BYTES_PER_ELEMENT'];
}

export function convertDataToString(data: string | Uint8Array): string {
    return (data instanceof Uint8Array) ? byteArrayToUTF8(data) : data;
}

export function byteToASCII(b: number): string {
    if (b < 32) {
        return String.fromCharCode(b + 0x2400);
    } else {
        return String.fromCharCode(b);
    }
}

export function loadScript(scriptfn: string): Promise<Event> {
    return new Promise((resolve, reject) => {
        var script = document.createElement('script');
        script.onload = resolve;
        script.onerror = reject;
        script.src = scriptfn;
        document.getElementsByTagName('head')[0].appendChild(script);
    });
}

export function decodeQueryString(qs: string): {} {
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

export function parseBool(s: string): boolean {
    if (!s) {
        return false;
    }

    if (s == 'false' || s == '0') {
        return false;
    }

    if (s == 'true' || s == '1') {
        return true;
    }

    return s ? true : false;
}

// lame factorization for displaying bitmaps
// returns a > b such that a * b == x (or higher), a >= mina, b >= minb
export function findIntegerFactors(x: number, mina: number, minb: number, aspect: number): { a: number, b: number } {
    let a = x;
    let b = 1;

    if (minb > 1 && minb < a) {
        a = Math.ceil(x / minb);
        b = minb;
    }

    while (a > b) {
        let a2 = a;
        let b2 = b;

        if ((a & 1) == 0) {
            b2 = b * 2;
            a2 = a / 2;
        }

        if ((a % 3) == 0) {
            b2 = b * 3;
            a2 = a / 3;
        }

        if ((a % 5) == 0) {
            b2 = b * 5;
            a2 = a / 5;
        }

        if (a2 < mina) {
            break;
        }

        if (a2 < b2 * aspect) {
            break;
        }

        a = a2;
        b = b2;
    }

    return {a, b};
}

export class FileDataCache {
    maxSize: number = 8000000;
    size: number;
    cache: Map<string, string | Uint8Array>;

    constructor() {
        this.reset();
    }

    get(key: string): string | Uint8Array {
        return this.cache.get(key);
    }

    put(key: string, value: string | Uint8Array) {
        this.cache.set(key, value);
        this.size += value.length;

        if (this.size > this.maxSize) {
            console.log('cache reset', this);
            this.reset();
        }
    }

    reset() {
        this.cache = new Map();
        this.size = 0;
    }
}

export function coerceToArray<T>(arrobj: any): T[] {
    if (Array.isArray(arrobj)) {
        return arrobj;
    } else if (arrobj != null && typeof arrobj[Symbol.iterator] === 'function') {
        return Array.from(arrobj);
    } else if (typeof arrobj === 'object') {
        return Array.from(Object.values(arrobj))
    } else {
        throw new Error(`Expected array or object, got "${arrobj}"`);
    }
}
