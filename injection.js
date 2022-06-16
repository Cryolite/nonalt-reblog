// In order to avoid name conflicts, all global variables used in this injected
// script are defined as a property of the object `window.nonaltReblog`.
if ('nonaltReblog' in window === false) {
    // The presence of `window.nonaltReblog` determines whether this script has
    // been already injected into this page or not.
    window.nonaltReblog = {};
}
nonaltReblog.tabId = null;
nonaltReblog.extensionId = null;
nonaltReblog.preflight = false;
nonaltReblog.postUrlPattern = /^(https:\/\/[^\/]+\/post\/(\d+))(?:\/.*)?$/;
nonaltReblog.imageUrlChecks = {};
nonaltReblog.postUrlToImageUrls = {};
nonaltReblog.activeElement = null;

import {
    sleep, fetchImages
} from "chrome-extension://biiglkpcdjpendjobkhgoeflaejipmfg/common.js";

nonaltReblog.sendMessageToExtension = message => {
    const promise = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(nonaltReblog.extensionId, message, result => {
            if (result === undefined) {
                const lastError = JSON.stringify(chrome.runtime.lastError);
                console.error(lastError);
                reject(new Error(lastError));
                return;
            }
            resolve(result);
            return;
        });
    });
    return promise;
}

nonaltReblog.moveToNextPost = async postElement => {
    const nextPostElement = postElement.nextElementSibling;
    if (typeof nextPostElement === 'undefined') {
        const errorMessage = '`postElement.nextElementSibling` is `undefined`.';
        console.error(errorMessage);
        throw new Error(errorMessage);
    }

    if (nextPostElement !== null) {
        if (typeof nextPostElement !== 'object') {
            console.assert(typeof nextPostElement === 'object', typeof nextPostElement);
            throw new Error(`${typeof nextPostElement}: An invalid type.`)
        }
        nextPostElement.focus();
        return nextPostElement;
    }

    {
        const keyboardEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'j',
            code: 'KeyJ'
        });
        postElement.dispatchEvent(keyboardEvent);
    }

    while (true) {
        const nextPostElement = postElement.nextElementSibling;
        if (nextPostElement !== null) {
            if (typeof nextPostElement !== 'object') {
                console.assert(typeof nextPostElement === 'object', typeof nextPostElement);
                throw new Error(`${typeof nextPostElement}: An invalid type.`)
            }
            nextPostElement.focus();
            return nextPostElement;
        }
        await sleep(1000);
    }
}

nonaltReblog.getLeftMostPostUrlInInnerHtml = element => {
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

        const matches = nonaltReblog.postUrlPattern.exec(href);
        if (!Array.isArray(matches)) {
            break matchHrefAgaintPostUrl;
        }

        return matches[1];
    }

    const children = element.children;
    if (typeof children !== 'object') {
        return null;
    }
    for (const child of children) {
        const result = nonaltReblog.getLeftMostPostUrlInInnerHtml(child);
        if (typeof result === 'string') {
            return result;
        }
    }

    return null;
}

nonaltReblog.getHrefsInInnerHtml = element => {
    function impl(element, hrefs) {
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

nonaltReblog.getPostImageUrls = element => {
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

nonaltReblog.matchImages = async (postUrl, postImageUrls, images) => {
    const postImages = await fetchImages(postImageUrls, postUrl);

    const requestBody = {
        sources: postImages,
        targets: images
    }
    const response = await fetch('http://localhost:5000/', {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/html',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });
    if (response.ok !== true) {
        throw new Error(`Failed to connect \`matcher\` (${response.status}).\n${await response.text()}`);
    }

    const matchResults = JSON.parse(await response.text());
    if (Array.isArray(matchResults) !== true) {
        throw new Error(`${typeof matchResults}`);
    }
    if (matchResults.length !== postImageUrls.length) {
        throw new Error(`${matchResults.length} != ${postImageUrls.length}`);
    }

    const matchedImageUrls = [];
    for (let i = 0; i < postImageUrls.length; ++i) {
        const matchResult = matchResults[i];
        if (typeof matchResult.index !== 'number') {
            throw new Error(`${typeof matchResult.index}`);
        }
        if (matchResult.index < 0 || images.length <= matchResult.index) {
            throw new Error(`${matchResult.index}`);
        }
        if (typeof matchResult.score !== 'number') {
            throw new Error(`${typeof matchResult.score}`);
        }
        if (matchResult.score < 0.0 || 1.0 < matchResult.score) {
            throw new Error(`${matchResult.score}`);
        }

        const targetImage = images[matchResult.index];
        const targetUrl = targetImage.url;
        const matchScore = matchResult.score;
        if (matchResult.score < 0.99) {
            console.error(`${postUrl}: Does not match to any image. A candidate is ${targetUrl} (${matchScore}).`);
            return null;
        }
        matchedImageUrls.push(targetUrl);
    }
    return matchedImageUrls;
}

nonaltReblog.initiatePreflight = async () => {
    if (nonaltReblog.activeElement === null) {
        console.error('Press the `J` key (and possibly the `K` key afterwards) to set the starting position of preflight.')
        return;
    }
    let element = nonaltReblog.activeElement;

    const deadline = Date.now() + 6 * 60 * 60 * 1000;
    while (nonaltReblog.preflight && Date.now() <= deadline) {
        const postUrl = nonaltReblog.getLeftMostPostUrlInInnerHtml(element);
        if (postUrl === null) {
            console.info('Removed because any post URL could not be identified.');
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }

        const hrefs = nonaltReblog.getHrefsInInnerHtml(element);
        const innerText = element.innerText;

        {
            const myAccountPattern = /^https:\/\/cryolite\.tumblr\.com/;
            let skip = false;
            for (const href of hrefs) {
                if (href.search(myAccountPattern) !== -1) {
                    console.info(`${postUrl}: Removed because this is my post or reblogged by me.`);
                    const nextElement = await nonaltReblog.moveToNextPost(element);
                    element.remove();
                    element = nextElement;
                    element.focus();
                    skip = true;
                    break;
                }
            }
            if (skip === true) {
                continue;
            }
        }

        const postImageUrls = nonaltReblog.getPostImageUrls(element);

        if (postImageUrls.length === 0) {
            console.warn(`${postUrl}: Removed because any post image URL could not be identified.`);
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }

        const result = await nonaltReblog.sendMessageToExtension({
            type: 'getImages',
            tabId: nonaltReblog.tabId,
            hrefs: hrefs,
            innerText: innerText
        });
        if (result.errorMessage !== null) {
            console.error(result.errorMessage);
            nonaltReblog.preflight = false;
            return;
        }
        const images = result.images;
        if (!Array.isArray(images)) {
            console.assert(Array.isArray(images), typeof images);
            nonaltReblog.preflight = false;
            return;
        }
        for (const image of images) {
            if (typeof image !== 'object') {
                console.assert(typeof image === 'object', typeof image);
                nonaltReblog.preflight = false;
                return;
            }
            if (typeof image.url !== 'string') {
                console.assert(typeof image.url === 'string', typeof image.url);
                nonaltReblog.preflight = false;
                return;
            }
            if (typeof image.mime !== 'string') {
                console.assert(typeof image.mime === 'string', typeof image.mime);
                nonaltReblog.preflight = false;
                return;
            }
            if (typeof image.blob !== 'string') {
                console.assert(typeof image.blob === 'string', typeof image.blob);
                nonaltReblog.preflight = false;
                return;
            }
        }

        if (images.length === 0) {
            console.warn(`${postUrl}: Removed because any image URL could not be identified.`);
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }

        const matchedImageUrls = await nonaltReblog.matchImages(postUrl, postImageUrls, images);
        if (Array.isArray(matchedImageUrls) !== true) {
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }
        if ([...new Set(matchedImageUrls)].length != postImageUrls.length) {
            console.error(`${postUrl}: Multiple post images match to the same target image.`);
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }

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
                    const result = await nonaltReblog.sendMessageToExtension({
                        type: 'findInReblogQueue',
                        key: imageUrl
                    });
                    if (result.errorMessage !== null) {
                        nonaltReblog.preflight = false;
                        console.error(result.errorMessage);
                        throw new Error(result.errorMessage);
                    }
                    if (result.found === true) {
                        console.info(`${imageUrl}: Already queued to be reblogged.`);
                        break checkForDuplication;
                    }
                }

                {
                    const result = await nonaltReblog.sendMessageToExtension({
                        type: 'findInLocalStorage',
                        key: imageUrl
                    });
                    if (result.errorMessage !== null) {
                        nonaltReblog.preflight = false;
                        console.error(result.errorMessage);
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
            console.info(`  ${postUrl}: Removed.`);
            const nextElement = await nonaltReblog.moveToNextPost(element);
            element.remove();
            element = nextElement;
            element.focus();
            continue;
        }
        else {
            console.info(`${postUrl}: ${JSON.stringify(matchedImageUrls)}`);
            nonaltReblog.postUrlToImageUrls[postUrl] = matchedImageUrls;
        }

        element = await nonaltReblog.moveToNextPost(element);
    }

    nonaltReblog.preflight = false;
}

nonaltReblog.queueForReblogging = async event => {
    const target = event.target;
    if (target === null) {
        return;
    }

    const postUrl = nonaltReblog.getLeftMostPostUrlInInnerHtml(target);
    if (typeof postUrl !== 'string') {
        console.warn(`Failed to get the post URL.`);
        return;
    }

    if (postUrl in nonaltReblog.postUrlToImageUrls === false) {
        console.warn(`${postUrl}: Execute preflight first.`);
        return;
    }
    const imageUrls = nonaltReblog.postUrlToImageUrls[postUrl];
    if (imageUrls.length === 0) {
        console.assert(imageUrls.length >= 1);
        return;
    }

    let allFound = true;
    for (const imageUrl of imageUrls) {
        const result = await nonaltReblog.sendMessageToExtension({
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

    nonaltReblog.sendMessageToExtension({
        type: 'queueForReblogging',
        tabId: nonaltReblog.tabId,
        postUrl: postUrl,
        imageUrls: imageUrls
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
        nonaltReblog.initiatePreflight().finally(() => {
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
    if (event.code !== 'KeyR') {
        return;
    }
    if (event.sourceCapabilities === null) {
        return;
    }
    if (nonaltReblog.preflight === true) {
        return;
    }

    nonaltReblog.queueForReblogging(event);
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

    nonaltReblog.sendMessageToExtension({
        type: 'dequeueForReblogging',
        tabId: nonaltReblog.tabId
    });
});
