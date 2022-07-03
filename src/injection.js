// In order to avoid name conflicts, all global variables used in this injected
// script are defined as a property of the object `window.nonaltReblog`.
if ('nonaltReblog' in window === false) {
    // The presence of `window.nonaltReblog` determines whether this script has
    // been already injected into this page or not.
    window.nonaltReblog = {};
}
nonaltReblog.tabId = null;
nonaltReblog.extensionId = null;

nonaltReblog.activeElement = null;
nonaltReblog.preflight = false;

import {
    sleep, getLeftMostPostUrlInInnerHtml, sendMessageToExtension
} from './common';

function getHrefsInInnerHtml(element) {
    const impl = (element, hrefs) => {
        matchHrefAgaintPostUrl: {
            if (typeof element.nodeName !== 'string') {
                break matchHrefAgaintPostUrl;
            }
            const name = element.nodeName.toUpperCase();
            if (name !== 'A') {
                break matchHrefAgaintPostUrl;
            }

            const href = element.href;
            if (typeof href !== 'string') {
                break matchHrefAgaintPostUrl;
            }

            hrefs.push(href);
            break matchHrefAgaintPostUrl;
        }

        const children = element.children;
        if (typeof children !== 'object') {
            return;
        }
        for (const child of children) {
            impl(child, hrefs);
        }
    }

    const hrefs = [];
    impl(element, hrefs);
    return [...new Set(hrefs)];
}

function getPostImageUrls(element) {
    const srcPattern = /^(https:\/\/64\.media\.tumblr\.com\/[0-9a-z]+\/(?:[0-9a-z]+-[0-9a-z]+\/s\d+x\d+\/[0-9a-z]+|tumblr_[0-9A-Za-z]+_\d+)\.(?:jpg|pnj|gifv))\s+(\d+)w$/;

    const impl = (element, imageUrls) => {
        findImageUrl: {
            if (typeof element.nodeName !== 'string') {
                break findImageUrl;
            }
            const name = element.nodeName.toUpperCase();
            if (name !== 'IMG') {
                break findImageUrl;
            }

            const srcset = element.srcset;
            if (typeof srcset !== 'string') {
                break findImageUrl;
            }

            const imageUrl = (() => {
                const srcs = srcset.split(',');
                let maxWidth = 0;
                let imageUrl = null;
                for (const src of srcs) {
                    const matches = srcPattern.exec(src.trim());
                    if (matches === null) {
                        continue;
                    }
                    const width = parseInt(matches[2], 10);
                    if (width > maxWidth) {
                        imageUrl = matches[1];
                    }
                }
                return imageUrl;
            })();
            if (imageUrl !== null) {
                imageUrls.push(imageUrl);
            }
        }

        const children = element.children;
        if (typeof children !== 'object') {
            return;
        }
        for (const child of children) {
            impl(child, imageUrls);
        }
    };

    const imageUrls = [];
    impl(element, imageUrls);
    return [...new Set(imageUrls)];
}

const POST_IMAGE_URLS = new Set();
const IMAGE_URLS = new Set();
const MESSAGES = [];

async function initiatePreflight() {
    if (nonaltReblog.activeElement === null) {
        console.error('Press the `J` key (and possibly the `K` key afterwards) to set the starting position of preflight.')
        return;
    }
    let postElement = nonaltReblog.activeElement;

    const dequeueMessages = async () => {
        while (MESSAGES.length >= 1) {
            console.info(`Message #${MESSAGES.length}`);

            const message = MESSAGES[0];
            MESSAGES.shift();
            message.imageUrls = [...IMAGE_URLS];
            const result = await sendMessageToExtension(message);
            if ('errorMessage' in result !== true) {
                throw Error(`An unexpected message response: ${JSON.stringify(result)}`);
            }
            if (result.errorMessage !== null) {
                throw Error(result.errorMessage);
            }
            if ('imageUrls' in result !== true) {
                throw Error(`An unexpected message response: ${JSON.stringify(result)}`);
            }
            if (Array.isArray(result.imageUrls) !== true) {
                throw Error(`${typeof result.imageUrls}: An invalid type.`);
            }
            for (const imageUrl of result.imageUrls) {
                IMAGE_URLS.add(imageUrl);
            }
        }
    };

    if (MESSAGES.length >= 1) {
        await dequeueMessages();
        nonaltReblog.preflight = false;
        return;
    }

    let preflightPromise = null;
    const deadline = Date.now() + 1 * 60 * 60 * 1000;
    while (nonaltReblog.preflight && Date.now() <= deadline) {
        while (postElement.nextElementSibling !== null) {
            const previousPostElement = postElement;
            postElement = postElement.nextElementSibling;
            if (typeof postElement !== 'object') {
                console.assert(typeof postElement === 'object', typeof postElement);
                throw new Error(`${typeof postElement}: An unexpected type.`);
            }
            postElement.scrollIntoView();

            const postUrl = getLeftMostPostUrlInInnerHtml(previousPostElement);
            if (postUrl === null) {
                console.info('Removed because any post URL could not be identified.');
                previousPostElement.remove();
                continue;
            }

            const hrefs = getHrefsInInnerHtml(previousPostElement);
            const innerText = previousPostElement.innerText;

            {
                const myAccountPattern = /^https:\/\/cryolite\.tumblr\.com/;
                let skip = false;
                for (const href of hrefs) {
                    if (myAccountPattern.test(href) === true) {
                        skip = true;
                        break;
                    }
                }
                if (skip === true) {
                    console.info(`${postUrl}: Removed because this is my post or reblogged by me.`);
                    previousPostElement.remove();
                    continue;
                }
            }

            const postImageUrls = getPostImageUrls(previousPostElement);
            if (postImageUrls.length === 0) {
                console.warn(`${postUrl}: Removed because any post image URL could not be identified.`);
                previousPostElement.remove();
                continue;
            }

            {
                let allDetected = true;
                for (const postImageUrl of postImageUrls) {
                    if (POST_IMAGE_URLS.has(postImageUrl) !== true) {
                        allDetected = false;
                        break;
                    }
                }
                if (allDetected === true) {
                    console.info(`${postUrl}: Already detected in the dashboard.`);
                    previousPostElement.remove();
                    continue;
                }
            }

            MESSAGES.push({
                type: 'preflightOnPost',
                tabId: nonaltReblog.tabId,
                postUrl: postUrl,
                postImageUrls: postImageUrls,
                hrefs: hrefs,
                innerText: innerText
            });
            previousPostElement.remove();

            for (const postImageUrl of postImageUrls) {
                POST_IMAGE_URLS.add(postImageUrl);
            }
        }

        const sleepDeadline = Date.now() + 1000;
        while (true) {
            if (MESSAGES.length >= 1 && preflightPromise === null) {
                const message = MESSAGES[0];
                MESSAGES.shift();
                message.imageUrls = [...IMAGE_URLS];
                preflightPromise = sendMessageToExtension(message);
            }

            if (Date.now() > sleepDeadline) {
                break;
            }

            const eventMultiplexer = [];
            if (preflightPromise !== null) {
                eventMultiplexer.push(preflightPromise);
            }
            const sleepPromise = sleep(Math.max(sleepDeadline - Date.now(), 0));
            eventMultiplexer.push(sleepPromise);

            const result = await Promise.race(eventMultiplexer);
            if (typeof result === 'object') {
                if ('errorMessage' in result !== true) {
                    throw Error(`An unexpected message response: ${JSON.stringify(result)}`);
                }
                if (result.errorMessage !== null) {
                    throw Error(result.errorMessage);
                }
                if ('imageUrls' in result !== true) {
                    throw Error(`An unexpected message response: ${JSON.stringify(result)}`);
                }
                if (Array.isArray(result.imageUrls) !== true) {
                    throw Error(`${typeof result.imageUrls}: An invalid type.`);
                }
                for (const imageUrl of result.imageUrls) {
                    IMAGE_URLS.add(imageUrl);
                }
                preflightPromise = null;
                continue;
            }
        }
    }
    if (preflightPromise !== null) {
        const result = await preflightPromise;
        if ('errorMessage' in result !== true) {
            throw Error(`An unexpected message response: ${JSON.stringify(result)}`);
        }
        if (result.errorMessage !== null) {
            throw Error(result.errorMessage);
        }
        if ('imageUrls' in result !== true) {
            throw Error(`An unexpected message response: ${JSON.stringify(result)}`);
        }
        if (Array.isArray(result.imageUrls) !== true) {
            throw Error(`${typeof result.imageUrls}: An invalid type.`);
        }
        for (const imageUrl of result.imageUrls) {
            IMAGE_URLS.add(imageUrl);
        }
        preflightPromise = null;
    }

    await dequeueMessages();

    nonaltReblog.preflight = false;
}

document.addEventListener('keydown', event => {
    if (event.shiftKey) {
        return;
    }
    if (event.ctrlKey) {
        return;
    }
    if (event.altKey) {
        return;
    }
    if (event.metaKey) {
        return;
    }
    if (event.code !== 'KeyJ') {
        return;
    }
    if (nonaltReblog.preflight === true) {
        return;
    }
    if (document.activeElement === null) {
        return;
    }

    nonaltReblog.preflight = false;
    nonaltReblog.activeElement = document.activeElement;
});

document.addEventListener('keydown', event => {
    if (event.shiftKey) {
        return;
    }
    if (event.ctrlKey) {
        return;
    }
    if (event.altKey) {
        return;
    }
    if (event.metaKey) {
        return;
    }
    if (event.code !== 'KeyK') {
        return;
    }
    if (nonaltReblog.preflight === true) {
        return;
    }
    if (document.activeElement === null) {
        return;
    }
    if (nonaltReblog.activeElement === null) {
        return;
    }

    nonaltReblog.preflight = false;

    if (document.activeElement == nonaltReblog.activeElement.previousElementSibling) {
        nonaltReblog.activeElement = document.activeElement;
        return;
    }

    if (nonaltReblog.activeElement.previousElementSibling !== null) {
        nonaltReblog.activeElement = nonaltReblog.activeElement.previousElementSibling;
        nonaltReblog.activeElement.focus();
    }
});

document.addEventListener('keydown', async event => {
    if (event.shiftKey) {
        return;
    }
    if (event.ctrlKey) {
        return;
    }
    if (event.altKey) {
        return;
    }
    if (event.metaKey) {
        return;
    }
    if (event.code !== 'KeyP') {
        return;
    }

    if (nonaltReblog.preflight === false) {
        nonaltReblog.preflight = true;
        const startTime = Math.floor(Date.now() / 1000);
        initiatePreflight().finally(() => {
            nonaltReblog.preflight = false;

            let elapsedSeconds = Math.floor(Date.now() / 1000) - startTime;
            const elapsedHours = Math.floor(elapsedSeconds / 3600);
            elapsedSeconds -= elapsedHours * 3600;
            const elapsedMinutes = Math.floor(elapsedSeconds / 60);
            elapsedSeconds -= elapsedMinutes * 60;
            console.info(`Elapsed time: ${elapsedHours}:${elapsedMinutes}:${elapsedSeconds}`);
        });
        return;
    }

    nonaltReblog.preflight = false;
});

document.addEventListener('keydown', async event => {
    if (event.shiftKey) {
        return;
    }
    if (event.ctrlKey) {
        return;
    }
    if (event.altKey) {
        return;
    }
    if (event.metaKey) {
        return;
    }
    if (event.code !== 'KeyQ') {
        return;
    }
    if (nonaltReblog.preflight === true) {
        return;
    }

    sendMessageToExtension({
        type: 'dequeueForReblogging',
        tabId: nonaltReblog.tabId
    });
});
