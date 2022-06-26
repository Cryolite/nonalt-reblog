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
nonaltReblog.imageUrlChecks = {};
nonaltReblog.postUrlToImages = {};

import {
    sleep, getLeftMostPostUrlInInnerHtml, sendMessageToExtension
} from 'chrome-extension://biiglkpcdjpendjobkhgoeflaejipmfg/common.js';

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

async function initiatePreflight() {
    if (nonaltReblog.activeElement === null) {
        console.error('Press the `J` key (and possibly the `K` key afterwards) to set the starting position of preflight.')
        return;
    }
    let postElement = nonaltReblog.activeElement;

    const deadline = Date.now() + 6 * 60 * 60 * 1000;
    while (nonaltReblog.preflight && Date.now() <= deadline) {
        const messages = [];
        const postUrlToElement = {};
        while (postElement.nextElementSibling !== null) {
            const previousPostElement = postElement;
            postElement = postElement.nextElementSibling;
            if (typeof postElement !== 'object') {
                console.assert(typeof postElement === 'object', typeof postElement);
                throw new Error(`${typeof postElement}: An unexpected type.`);
            }
            postElement.focus();

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

            messages.push({
                type: 'preflightOnPost',
                tabId: nonaltReblog.tabId,
                postUrl: postUrl,
                postImageUrls: postImageUrls,
                hrefs: hrefs,
                innerText: innerText
            });
            postUrlToElement[postUrl] = previousPostElement;
        }

        if (messages.length === 0) {
            await sleep(1000);
            continue;
        }

        for (const message of messages) {
            const result = await sendMessageToExtension(message);
            if (result.errorMessage !== null) {
                throw new Error(result.errorMessage);
            }

            const postUrl = result.postUrl;
            if (typeof postUrl !== 'string') {
                throw new Error(`${typeof postUrl}: An invalid type.`);
            }

            const matchedImages = result.matchedImages;
            if (Array.isArray(matchedImages) !== true) {
                const elementToRemove = postUrlToElement[postUrl];
                elementToRemove.remove();
                continue;
            }

            const matchedImageUrls = matchedImages.map(x => x.imageUrl);

            let allDuplicated = true;
            for (const imageUrl of matchedImageUrls) {
                checkForDuplication: {
                    if (imageUrl in nonaltReblog.imageUrlChecks) {
                        if (nonaltReblog.imageUrlChecks[imageUrl] === postUrl) {
                            nonaltReblog.preflight = false;
                            console.assert(nonaltReblog.imageUrlChecks[imageUrl] !== postUrl, postUrl, imageUrl);
                            return;
                        }
                        console.info(`${imageUrl}: Already detected in the dashboard.`);
                        break checkForDuplication;
                    }

                    nonaltReblog.imageUrlChecks[imageUrl] = postUrl;

                    {
                        const result = await sendMessageToExtension({
                            type: 'findInReblogQueue',
                            key: imageUrl
                        });
                        if (result.errorMessage !== null) {
                            nonaltReblog.preflight = false;
                            throw new Error(result.errorMessage);
                        }
                        if (result.found === true) {
                            console.info(`${imageUrl}: Already queued to be reblogged.`);
                            break checkForDuplication;
                        }
                    }

                    {
                        const result = await sendMessageToExtension({
                            type: 'findInLocalStorage',
                            key: imageUrl
                        });
                        if (result.errorMessage !== null) {
                            nonaltReblog.preflight = false;
                            throw new Error(result.errorMessage);
                        }
                        if (result.found === true) {
                            console.info(`${imageUrl}: Already reblogged.`);
                            break checkForDuplication;
                        }
                    }

                    allDuplicated = false;
                    break checkForDuplication;
                }
                if (allDuplicated === false) {
                    break;
                }
            }
            if (allDuplicated === true) {
                console.info(`  => ${postUrl}: Removed.`);
                const elementToRemove = postUrlToElement[postUrl];
                elementToRemove.remove();
                continue;
            }

            console.info(`${postUrl}: ${JSON.stringify(matchedImageUrls)}`);
            nonaltReblog.postUrlToImages[postUrl] = matchedImages.map(x => {
                return {
                    artistUrl: x.artistUrl,
                    imageUrl: x.imageUrl
                };
            });
        }
    }

    nonaltReblog.preflight = false;
}

async function queueForReblogging(event) {
    const target = event.target;
    if (target === null) {
        return;
    }

    const postUrl = getLeftMostPostUrlInInnerHtml(target);
    if (typeof postUrl !== 'string') {
        console.warn(`Failed to get the post URL.`);
        return;
    }

    if (postUrl in nonaltReblog.postUrlToImages === false) {
        console.warn(`${postUrl}: Execute preflight first.`);
        return;
    }
    const images = nonaltReblog.postUrlToImages[postUrl];
    if (images.length === 0) {
        console.assert(images.length >= 1);
        return;
    }

    const imageUrls = images.map(x => x.imageUrl);
    let allFound = true;
    for (const imageUrl of imageUrls) {
        const result = await sendMessageToExtension({
            type: 'findInLocalStorage',
            key: imageUrl
        });
        if (result.errorMessage !== null) {
            console.error(result.errorMessage);
            return;
        }
        const found = result.found;
        if (typeof found !== 'boolean') {
            console.error(`${typeof found}: An invalid type.`);
            return;
        }
        if (found === false) {
            allFound = false;
            break;
        }
    }
    if (allFound === true) {
        if (imageUrls.length === 1) {
            console.info(`${postUrl}: The image has been already reblogged.`);
        }
        else {
            console.info(`${postUrl}: All the images have been already reblogged.`);
        }
        return;
    }

    sendMessageToExtension({
        type: 'queueForReblogging',
        tabId: nonaltReblog.tabId,
        postUrl: postUrl,
        images: images
    });
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
    if (event.sourceCapabilities === null) {
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
    if (event.sourceCapabilities === null) {
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
    if (event.sourceCapabilities === null) {
        return;
    }

    if (nonaltReblog.preflight === false) {
        nonaltReblog.preflight = true;
        const startTime = Math.floor(Date.now() / 1000);
        initiatePreflight().finally(() => {
            nonaltReblog.preflight = false;

            sendMessageToExtension({
                type: 'savePostUrlToImages',
                postUrlToImages: nonaltReblog.postUrlToImages
            });

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
    if (event.code !== 'KeyR') {
        return;
    }
    if (event.sourceCapabilities === null) {
        return;
    }
    if (nonaltReblog.preflight === true) {
        return;
    }

    queueForReblogging(event);
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
    if (event.sourceCapabilities === null) {
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
