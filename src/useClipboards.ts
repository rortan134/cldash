import * as React from "react";

// ToDo: copy hook that handles every file type

export interface ClipboardData {
    fileType?: string;
    text?: string;
    errorMessage?: string;
}

const IS_SERVER = typeof window === "undefined";

function format(message) {
    const copyKey = (/mac os x/i.test(navigator.userAgent) ? "⌘" : "Ctrl") + "+C";
    return message.replace(/#{\s*key\s*}/g, copyKey);
}

const clipboardToIE11Formatting = {
    "text/plain": "Text",
    "text/html": "Url",
    default: "Text",
};

const defaultMessage = "Copy to clipboard: #{key}, Enter";

// Adapted from https://github.com/sudodoki/toggle-selection
function toggleSelection() {
    const selection = document.getSelection();
    if (!selection.rangeCount) {
        return () => {};
    }

    let active = document.activeElement as HTMLElement;

    const ranges = [];
    for (let i = 0; i < selection.rangeCount; i++) {
        ranges.push(selection.getRangeAt(i));
    }

    switch (
        active.tagName.toUpperCase() // .toUpperCase handles XHTML
    ) {
        case "INPUT":
        case "TEXTAREA":
            active.blur();
            break;

        default:
            active = null;
            break;
    }

    selection.removeAllRanges();
    return () => {
        selection.type === "Caret" && selection.removeAllRanges();

        if (!selection.rangeCount) {
            ranges.forEach(function (range) {
                selection.addRange(range);
            });
        }

        active?.focus();
    };
}

function copy(text, options) {
    var debug,
        message,
        reselectPrevious,
        range,
        selection,
        mark,
        success = false;
    if (!options) {
        options = {};
    }
    debug = options.debug || false;
    try {
        reselectPrevious = toggleSelection();

        range = document.createRange();
        selection = document.getSelection();

        mark = document.createElement("span");
        mark.textContent = text;
        // avoid screen readers from reading out loud the text
        mark.ariaHidden = "true";
        // reset user styles for span element
        mark.style.all = "unset";
        // prevents scrolling to the end of the page
        mark.style.position = "fixed";
        mark.style.top = 0;
        mark.style.clip = "rect(0, 0, 0, 0)";
        // used to preserve spaces and line breaks
        mark.style.whiteSpace = "pre";
        // do not inherit user-select (it may be `none`)
        mark.style.webkitUserSelect = "text";
        mark.style.MozUserSelect = "text";
        mark.style.msUserSelect = "text";
        mark.style.userSelect = "text";
        mark.addEventListener("copy", function (e) {
            e.stopPropagation();
            if (options.format) {
                e.preventDefault();
                if (typeof e.clipboardData === "undefined") {
                    // IE 11
                    debug && console.warn("unable to use e.clipboardData");
                    debug && console.warn("trying IE specific stuff");
                    window.clipboardData.clearData();
                    var format =
                        clipboardToIE11Formatting[options.format] ||
                        clipboardToIE11Formatting["default"];
                    window.clipboardData.setData(format, text);
                } else {
                    // all other browsers
                    e.clipboardData.clearData();
                    e.clipboardData.setData(options.format, text);
                }
            }
            if (options.onCopy) {
                e.preventDefault();
                options.onCopy(e.clipboardData);
            }
        });

        document.body.appendChild(mark);

        range.selectNodeContents(mark);
        selection.addRange(range);

        var successful = document.execCommand("copy");
        if (!successful) {
            throw new Error("copy command was unsuccessful");
        }
        success = true;
    } catch (err) {
        debug && console.error("unable to copy using execCommand: ", err);
        debug && console.warn("trying IE specific stuff");
        try {
            window.clipboardData.setData(options.format || "text", text);
            options.onCopy && options.onCopy(window.clipboardData);
            success = true;
        } catch (err) {
            debug && console.error("unable to copy using clipboardData: ", err);
            debug && console.error("falling back to prompt");
            message = format("message" in options ? options.message : defaultMessage);
            window.prompt(message, text);
        }
    } finally {
        if (selection) {
            if (typeof selection.removeRange == "function") {
                selection.removeRange(range);
            } else {
                selection.removeAllRanges();
            }
        }

        if (mark) {
            document.body.removeChild(mark);
        }
        reselectPrevious();
    }

    return success;
}

const probablySupportsClipboardReadText =
    "clipboard" in navigator && "readText" in navigator.clipboard;

const probablySupportsClipboardWriteText =
    "clipboard" in navigator && "writeText" in navigator.clipboard;

const probablySupportsClipboardBlob =
    "clipboard" in navigator &&
    "write" in navigator.clipboard &&
    "ClipboardItem" in window &&
    "toBlob" in HTMLCanvasElement.prototype;

type ResolutionType<T extends (...args: unknown[]) => unknown> = T extends (
    ...args: unknown[]
) => Promise<infer R>
    ? R
    : unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPromiseLike = (value: any): value is Promise<ResolutionType<typeof value>> => {
    return (
        !!value &&
        typeof value === "object" &&
        "then" in value &&
        "catch" in value &&
        "finally" in value
    );
};

export const copyBlobToClipboard = async (blob: Blob | Promise<Blob>, mimeType?: string) => {
    try {
        // in Safari so far we need to construct the ClipboardItem synchronously
        // (i.e. in the same tick) otherwise browser will complain for lack of
        // user intent. Using a Promise ClipboardItem constructor solves this.
        // https://bugs.webkit.org/show_bug.cgi?id=222262
        //
        // Note that Firefox (and potentially others) seems to support Promise
        // ClipboardItem constructor, but throws on an unrelated MIME type error.
        // So we need to await this and fallback to awaiting the blob if applicable.
        await navigator.clipboard.write([
            new window.ClipboardItem({
                [mimeType ?? "image/png"]: blob,
            }),
        ]);
    } catch (error: unknown) {
        // if we're using a Promise ClipboardItem, let's try constructing
        // with resolution value instead
        if (isPromiseLike(blob)) {
            await navigator.clipboard.write([
                new window.ClipboardItem({
                    [mimeType ?? "image/png"]: await blob,
                }),
            ]);
        } else {
            throw error;
        }
    }
};

export const copyTextToSystemClipboard = async (text: string | null) => {
    let copied = false;
    if (probablySupportsClipboardWriteText) {
        try {
            // NOTE: doesn't work on FF on non-HTTPS domains, or when document
            // not focused
            await navigator.clipboard.writeText(text || "");
            copied = true;
        } catch (error: any) {
            console.error(error);
        }
    }

    // Note that execCommand doesn't allow copying empty strings, so if we're
    // clearing clipboard using this API, we must copy at least an empty char
    if (!copied && !copyTextViaExecCommand(text || " ")) {
        throw new Error("couldn't copy");
    }
};

export const canvasToBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob((blob) => {
                if (!blob) {
                    return reject("Canvas is too big");
                }
                resolve(blob);
            });
        } catch (error: unknown) {
            reject(error);
        }
    });
};

// adapted from https://github.com/zenorocha/clipboard.js/blob/ce79f170aa655c408b6aab33c9472e8e4fa52e19/src/clipboard-action.js#L48
const copyTextViaExecCommand = (text: string) => {
    const isRTL = document.documentElement.getAttribute("dir") === "rtl";

    const textarea = document.createElement("textarea");

    textarea.style.border = "0";
    textarea.style.padding = "0";
    textarea.style.margin = "0";
    textarea.style.position = "absolute";
    textarea.style[isRTL ? "right" : "left"] = "-9999px";
    const yPosition = window.pageYOffset || document.documentElement.scrollTop;
    textarea.style.top = `${yPosition}px`;
    // Prevent zooming on iOS
    textarea.style.fontSize = "12pt";

    textarea.setAttribute("readonly", "");
    textarea.value = text;

    document.body.appendChild(textarea);

    let success = false;

    try {
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        success = document.execCommand("copy");
    } catch (error: any) {
        console.error(error);
    }

    textarea.remove();

    return success;
};

/**
 * Retrieves content from system clipboard (either from ClipboardEvent or
 *  via async clipboard API if supported)
 */
export const getSystemClipboard = async (event: ClipboardEvent | null): Promise<string> => {
    try {
        const text = event
            ? event.clipboardData?.getData("text/plain")
            : probablySupportsClipboardReadText && (await navigator.clipboard.readText());

        return (text || "").trim();
    } catch {
        return "";
    }
};

/**
 * Checks if is a JPEG image blob.
 *
 * @param {Blob} blob A blob.
 * @returns {boolean} A boolean indicating if the blob is a JPEG image or not.
 */
export function isJpegBlob(blob: Blob) {
    return blob.type.includes("jpeg");
}

/**
 * Checks if is a PNG image blob.
 *
 * @param {Blob} blob A blob.
 * @returns {boolean} A boolean indicating if the blob is a PNG image or not.
 */
export function isPngBlob(blob: Blob) {
    return blob.type.includes("png");
}

/**
 * Created an image element for a given image source attribute.
 *
 * @param {string} imageSource The image source attribute.
 * @returns {Promise<HTMLImageElement>} A promise that resolves to an image element. Rejects the promise if cannot create an image element.
 */
export async function createImageElement(imageSource: string): Promise<HTMLImageElement> {
    return new Promise(function (resolve, reject) {
        const imageElement = document.createElement("img");
        imageElement.crossOrigin = "anonymous";
        imageElement.src = imageSource;

        imageElement.onload = function (event) {
            const target = event.target as HTMLImageElement;
            resolve(target);
        };

        imageElement.onabort = reject;
        imageElement.onerror = reject;
    });
}

/**
 * Gets a blob from an image element.
 *
 * @param {HTMLImageElement} imageElement An image element
 * @returns {Promise<Blob>} A Promise that resolves to a image blob. Rejects the promise if cannot get a blob from the image element.
 */
export async function getBlobFromImageElement(imageElement: HTMLImageElement): Promise<Blob> {
    return new Promise(function (resolve, reject) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (context) {
            const { width, height } = imageElement;
            canvas.width = width;
            canvas.height = height;
            context.drawImage(imageElement, 0, 0, width, height);

            canvas.toBlob(
                function (blob) {
                    if (blob) resolve(blob);
                    else reject("Cannot get blob from image element");
                },
                "image/png",
                1
            );
        }
    });
}

/**
 * Converts a JPEG image blob to PNG.
 *
 * @param {Blob} imageBlob JPEG blob that will be converted to PNG.
 * @returns {Promise<Blob>} A Promise that resolves to a PNG image blob. Rejects the promise if cannot create an image element or if cannot get a blob from the image element.
 */
export async function convertBlobToPng(imageBlob: Blob) {
    const imageSource = URL.createObjectURL(imageBlob);
    const imageElement = await createImageElement(imageSource);
    return await getBlobFromImageElement(imageElement);
}

/**
 * Copies a PNG or JPEG image to clipboard.
 *
 * This function downloads the image to copy with it's original dimensions.
 *
 * - If the image is JPEG it will be converted automatically to PNG and then copied.
 * - If the image is not PNG or JPEG an error will be thrown.
 *
 * @param {string} imageSource The image source attribute.
 * @returns {Promise<Blob>} A promise that resolves to a blob. Generally you don't need to use the returned blob for nothing.
 */
async function copyImageToClipboard(imageBlob: Blob) {
    if (isJpegBlob(imageBlob)) {
        const pngBlob = await convertBlobToPng(imageBlob);
        await copyBlobToClipboard(pngBlob);
        return imageBlob;
    } else if (isPngBlob(imageBlob)) {
        await copyBlobToClipboard(imageBlob);
        return imageBlob;
    }

    throw new Error("Cannot copy this type of image to clipboard");
}

/**
 * Checks if can copy images to the clipboard using the Fetch API and the Clipboard API.
 *
 * @returns {Boolean} A boolean indicating if can copy or not.
 */
function canCopyImagesToClipboard() {
    const hasFetch = typeof fetch !== "undefined";
    const hasClipboardItem = typeof ClipboardItem !== "undefined";
    const hasNavigatorClipboardWriteFunction = !!navigator?.clipboard?.write;
    return hasFetch && hasClipboardItem && hasNavigatorClipboardWriteFunction;
}

// /**
//  * Requests the permission to write data on the user's clipboard.
//  * Reasons why you generally don't need to use this function:
//  * - The Permission to write data on the clipboard is automatically granted to pages when they are in the browser active tab.
//  * - If the browser has not implemented the Permissions API yet, this function will return false.
//  */
// export async function requestClipboardWritePermission() {
//     if (!navigator?.permissions?.query) return false;

//     const { state } = await navigator.permissions.query({
//         name: "clipboard-write" as PermissionName,
//     });

//     return state === "granted";
// }
